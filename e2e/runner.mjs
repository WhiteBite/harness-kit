/** Conformance runner: drives a harness headless against the mock model and classifies the outcome. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, harness } from '../src/index.mjs';
import { startMock } from './mock-model.mjs';
import { classify, readQuarantine, activeQuarantine, expiredQuarantine, overBudget } from './taxonomy.mjs';

const KIT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OPS_PATH = join(KIT_ROOT, 'e2e', 'harnesses.json');
const QUARANTINE_PATH = join(KIT_ROOT, 'e2e', 'quarantine.json');

/** Loads the volatile per-harness ops config (version pins, CI flags, tool vocabulary). */
export function loadOpsConfig(path = OPS_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Loads a consumer contract file, accepting JSON or a minimal YAML subset. */
export function loadConsumer(path) {
  return parseConsumer(readFileSync(path, 'utf8'));
}

/** Substitutes {{NAME}} placeholders from a vars map, leaving unknown names intact. */
export function substitute(template, vars) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match));
}

/** Compiles an intent-bearing scenario into the mock's concrete tool-call shape via a vocabulary. */
export function compileScenario(scenario, vocabulary, model) {
  const turns = (scenario.turns || []).map((turn) => {
    const compiled = {};
    if (Array.isArray(turn.toolCalls)) compiled.toolCalls = turn.toolCalls.map((call) => compileToolCall(call, vocabulary));
    if (typeof turn.text === 'string') compiled.text = turn.text;
    return compiled;
  });
  return { id: scenario.id, model, turns };
}

/** Maps a classified result to a process exit code along the action axis. */
export function exitCodeFor(result) {
  if (result.hardFail) return 2;
  if (result.action === 'block') return 1;
  return 0;
}

/** Runs one conformance pass and returns the classified result object. */
export async function runConformance(options) {
  const startedAt = new Date().toISOString();
  const harnessId = options.harnessId;
  const registry = loadRegistry();
  const row = harness(registry, harnessId);
  const ops = loadOpsConfig(options.opsPath);
  const opsRow = ops.harnesses[harnessId];
  if (!opsRow) throw new Error(`no ops config for harness "${harnessId}"`);
  if (opsRow.status === 'unverified') throw new Error(`harness "${harnessId}" is unverified: ${opsRow.note || 'no ops data'}`);
  const headless = row.headless;
  if (!headless) throw new Error(`harness "${harnessId}" has no headless block in the registry`);

  const consumer = loadConsumer(options.consumerPath);
  const scenario = JSON.parse(readFileSync(options.scenarioPath, 'utf8'));
  const model = headless.provider.model;
  const wire = headless.provider.wire;
  const compiled = compileScenario(scenario, opsRow.toolVocabulary, model);
  const lane = options.lane || 'pinned';
  const version = lane === 'pinned' ? opsRow.versionPin : 'latest';
  const dryRun = Boolean(options.dryRun);
  const now = options.now || new Date();

  const workspace = mkdtempSync(join(tmpdir(), `hk-e2e-${harnessId}-`));
  const home = join(workspace, 'home');
  mkdirSync(home, { recursive: true });
  const tracePath = join(workspace, 'mock-trace.jsonl');
  const selfTestTrace = join(workspace, 'mock-selftest.jsonl');

  let mock = null;
  let result;
  try {
    const selfTest = await mockSelfTest({ scenario: compiled, dialect: wire, tracePath: selfTestTrace });
    const evidence = {
      mockSelfTestPassed: selfTest.passed,
      installExit: null,
      harnessBootOk: null,
      integrationLoaded: null,
      hookFired: null,
      behaviorOk: null,
      infraOk: true,
      harnessExit: null,
    };
    let launch = null;
    let artifacts = {};
    let trace = [];
    const mockInfo = { selfTestPassed: selfTest.passed, selfTestError: selfTest.error, port: null, url: null };

    if (selfTest.passed) {
      mock = await startMock({ scenario: compiled, tracePath, dialect: wire, port: 0 });
      const mockUrl = `http://127.0.0.1:${mock.port}${opsRow.mockBasePath || ''}`;
      mockInfo.port = mock.port;
      mockInfo.url = mockUrl;

      const vars = { HARNESS: harnessId, WORKSPACE: workspace, MOCK_URL: mockUrl, MODEL: model };
      const env = buildEnv({ opsRow, home, headless, mockUrl, workspace });

      const install = await runShell(substitute(consumer.install, vars), { cwd: workspace, env });
      evidence.installExit = install.spawned ? install.exit : 1;

      const flags = [...(opsRow.ciFlags || []), ...(consumer.flags || [])];
      const forbidden = flags.filter((flag) => (opsRow.forbiddenFlags || []).includes(flag));
      launch = buildLaunch({ headless, flags, prompt: scenario.prompt, workspace, runOverride: options.runOverride });

      if (dryRun) {
        evidence.harnessBootOk = true;
        evidence.harnessExit = 0;
      } else {
        const run = await runArgv(launch.file, launch.args, { cwd: workspace, env, stdin: launch.stdin });
        evidence.harnessBootOk = run.spawned;
        evidence.harnessExit = run.spawned ? run.exit : null;
        if (!run.spawned) evidence.infraOk = false;
      }

      evidence.integrationLoaded = detectIntegration(consumer, workspace);
      if (forbidden.length > 0) evidence.hookFired = false;
      else if (dryRun) evidence.hookFired = true;
      else evidence.hookFired = detectHook(consumer, workspace, tracePath);

      const assert = await runShell(substitute(consumer.assert, vars), { cwd: workspace, env });
      evidence.behaviorOk = assert.spawned && assert.exit === 0;

      artifacts = collectArtifacts(consumer.artifacts, workspace);
      trace = readTrace(tracePath);
    }

    const classified = classify(evidence);
    const quarantine = readQuarantine(options.quarantinePath || QUARANTINE_PATH);
    const expired = expiredQuarantine(quarantine.entries, now);
    const activeAll = quarantine.entries.filter((entry) => !expired.includes(entry));
    const active = activeQuarantine(quarantine.entries, now, harnessId, version);
    let hardFail = false;
    let hardFailReason = null;
    if (expired.length > 0) {
      hardFail = true;
      hardFailReason = 'expired-quarantine';
    } else if (overBudget(activeAll, quarantine.budget)) {
      hardFail = true;
      hardFailReason = 'quarantine-over-budget';
    }
    const quarantined = classified.outcome === 'harness-broken' && active.length > 0;

    result = {
      harness: harnessId,
      scenario: scenario.id,
      lane,
      version,
      dryRun,
      outcome: classified.outcome,
      attribution: classified.attribution,
      action: classified.action,
      status: quarantined ? 'untested' : classified.outcome,
      quarantined,
      hardFail,
      hardFailReason,
      evidence,
      launch: launch ? { file: launch.file, args: launch.args, promptDelivery: headless.promptDelivery } : null,
      artifacts,
      trace,
      mock: mockInfo,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    if (mock) await mock.close();
    if (!options.keepWorkspace) rmSync(workspace, { recursive: true, force: true });
  }

  if (options.outDir) writeResult(options.outDir, result);
  return result;
}

function compileToolCall(call, vocabulary) {
  const binding = vocabulary && vocabulary[call.intent];
  if (!binding) throw new Error(`no tool vocabulary for intent "${call.intent}"`);
  const args = {};
  for (const [key, template] of Object.entries(binding.arguments)) {
    args[key] = typeof template === 'string' ? substitute(template, call.arguments) : template;
  }
  return { name: binding.name, arguments: args };
}

async function mockSelfTest({ scenario, dialect, tracePath }) {
  try {
    const probe = await startMock({ scenario, tracePath, dialect, port: 0 });
    await probe.close();
    return { passed: true, error: null };
  } catch (error) {
    return { passed: false, error: error.message };
  }
}

function buildEnv({ opsRow, home, headless, mockUrl, workspace }) {
  const env = {
    ...process.env,
    ...(opsRow.ciEnv || {}),
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
  };
  const override = headless.provider.override;
  if (override.kind === 'env') env[override.key] = mockUrl;
  else if (override.kind === 'config' && opsRow.providerConfigPath) {
    writeProviderConfig(join(workspace, opsRow.providerConfigPath), override.key, mockUrl, opsRow.providerId);
  }
  const auth = headless.provider.auth;
  if (auth.kind === 'env') env[auth.key] = 'mock-key';
  return env;
}

function writeProviderConfig(path, dottedKey, value, providerId) {
  const key = providerId ? dottedKey.replace('<id>', providerId) : dottedKey;
  const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const parts = key.split('.');
  let cursor = config;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (typeof cursor[parts[index]] !== 'object' || cursor[parts[index]] === null) cursor[parts[index]] = {};
    cursor = cursor[parts[index]];
  }
  cursor[parts[parts.length - 1]] = value;
  writeFileSync(path, JSON.stringify(config, null, 2));
}

function buildLaunch({ headless, flags, prompt, workspace, runOverride }) {
  const args = [...flags];
  let stdin = null;
  if (headless.promptDelivery === 'arg') {
    args.push(headless.promptFlag, prompt);
  } else if (headless.promptDelivery === 'stdin') {
    args.push(headless.promptFlag);
    stdin = prompt;
  } else if (headless.promptDelivery === 'file') {
    const promptFile = join(workspace, 'prompt.txt');
    writeFileSync(promptFile, prompt);
    args.push(headless.promptFlag, promptFile);
  } else {
    throw new Error(`unknown promptDelivery ${JSON.stringify(headless.promptDelivery)}`);
  }
  return { file: runOverride || headless.run, args, stdin };
}

function detectIntegration(consumer, workspace) {
  const hint = consumer.detect && consumer.detect.integration;
  if (hint && hint.file) return existsSync(join(workspace, hint.file));
  return (consumer.artifacts || []).every((rel) => existsSync(join(workspace, rel)));
}

function detectHook(consumer, workspace, tracePath) {
  const hint = consumer.detect && consumer.detect.hook;
  if (hint && hint.traceContains) {
    if (!existsSync(tracePath)) return false;
    return readFileSync(tracePath, 'utf8').includes(hint.traceContains);
  }
  if (hint && hint.file) return existsSync(join(workspace, hint.file));
  return readTrace(tracePath).some((line) => line.classified === 'scenario');
}

function collectArtifacts(artifacts, workspace) {
  const out = {};
  for (const rel of artifacts || []) {
    const path = join(workspace, rel);
    out[rel] = existsSync(path) ? readFileSync(path, 'utf8') : null;
  }
  return out;
}

function readTrace(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function runShell(command, { cwd, env }) {
  return new Promise((resolveRun) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolveRun({ spawned: false, exit: null, stdout, stderr, error: error.message }));
    child.on('close', (code) => resolveRun({ spawned: true, exit: code, stdout, stderr, error: null }));
  });
}

function runArgv(file, args, { cwd, env, stdin }) {
  return new Promise((resolveRun) => {
    const child = spawn(file, args, { cwd, env, stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    if (stdin !== null) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
    child.on('error', (error) => resolveRun({ spawned: false, exit: null, stdout, stderr, error: error.message }));
    child.on('close', (code) => resolveRun({ spawned: true, exit: code, stdout, stderr, error: null }));
  });
}

function writeResult(outDir, result) {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${result.harness}-${result.scenario}.json`);
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  return path;
}

function parseConsumer(text) {
  if (text.trimStart().startsWith('{')) return JSON.parse(text);
  return parseYaml(text);
}

function parseYaml(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const stripped = raw.replace(/\s+#.*$/, '');
    if (stripped.trim() === '') continue;
    lines.push({ indent: stripped.length - stripped.trimStart().length, content: stripped.trim() });
  }
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (let index = 0; index < lines.length; index += 1) {
    const { indent, content } = lines[index];
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;
    if (content.startsWith('- ')) {
      if (!Array.isArray(parent)) throw new Error(`unexpected sequence item at indent ${indent}`);
      const item = content.slice(2).trim();
      const colon = item.indexOf(':');
      if (colon !== -1 && !item.startsWith('"') && !item.startsWith("'")) {
        const obj = {};
        obj[item.slice(0, colon).trim()] = scalar(item.slice(colon + 1).trim());
        parent.push(obj);
        stack.push({ indent, value: obj });
      } else {
        parent.push(scalar(item));
      }
      continue;
    }
    const colon = content.indexOf(':');
    if (colon === -1) throw new Error(`invalid YAML line: ${content}`);
    const key = content.slice(0, colon).trim();
    const rest = content.slice(colon + 1).trim();
    if (rest === '') {
      const next = lines[index + 1];
      const isSequence = next && next.indent > indent && next.content.startsWith('- ');
      const child = isSequence ? [] : {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = scalar(rest);
    }
  }
  return root;
}

function scalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function parseArgs(argv) {
  const options = { harnessId: null, scenarioPath: null, consumerPath: null, lane: 'pinned', dryRun: false, outDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--harness') { index += 1; options.harnessId = argv[index]; continue; }
    if (arg === '--scenario') { index += 1; options.scenarioPath = argv[index]; continue; }
    if (arg === '--consumer') { index += 1; options.consumerPath = argv[index]; continue; }
    if (arg === '--lane') { index += 1; options.lane = argv[index]; continue; }
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--out') { index += 1; options.outDir = argv[index]; continue; }
    throw new Error(`unknown argument ${JSON.stringify(arg)}`);
  }
  if (!options.harnessId) throw new Error('--harness is required');
  if (!options.scenarioPath) throw new Error('--scenario is required');
  if (!options.consumerPath) throw new Error('--consumer is required');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runConformance(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCodeFor(result);
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`runner: ${error.message}\n`);
    process.exit(1);
  });
}
