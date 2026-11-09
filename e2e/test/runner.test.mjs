import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runConformance,
  loadOpsConfig,
  loadConsumer,
  compileScenario,
  substitute,
  exitCodeFor,
} from '../runner.mjs';

const E2E = fileURLToPath(new URL('..', import.meta.url));
const RUNNER = join(E2E, 'runner.mjs');
const SCENARIO = join(E2E, 'scenarios', 'hook-fires-on-shell.json');

async function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hk-runner-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeConsumer(dir, overrides = {}) {
  const install = overrides.install ?? "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('.claude', { recursive: true });\nwriteFileSync('.claude/settings.json', '{}');\n";
  const installPath = join(dir, 'install.mjs');
  writeFileSync(installPath, install);
  const assertPath = join(dir, 'assert.mjs');
  writeFileSync(assertPath, overrides.assert ?? 'process.exit(0);\n');
  const consumer = {
    install: `node "${installPath}"`,
    assert: `node "${assertPath}"`,
    artifacts: ['.claude/settings.json'],
    detect: { integration: { file: '.claude/settings.json' }, hook: { traceContains: 'scenario' } },
    ...overrides.consumer,
  };
  const consumerPath = join(dir, 'consumer.json');
  writeFileSync(consumerPath, JSON.stringify(consumer));
  return consumerPath;
}

function writeScenario(dir, scenario) {
  const path = join(dir, 'scenario.json');
  writeFileSync(path, JSON.stringify(scenario));
  return path;
}

const validScenario = () => ({
  id: 'hook-fires-on-shell',
  prompt: 'Run the shell command `exit 1`.',
  turns: [
    { toolCalls: [{ intent: 'shell', arguments: { command: 'exit 1' } }] },
    { text: 'done' },
  ],
});

test('happy path: a dry-run with a working consumer classifies pass and exits 0', () => withTemp(async (dir) => {
  const consumerPath = writeConsumer(dir);
  const scenarioPath = writeScenario(dir, validScenario());
  const result = await runConformance({ harnessId: 'claude', scenarioPath, consumerPath, dryRun: true });
  assert.equal(result.outcome, 'pass');
  assert.equal(result.attribution, null);
  assert.equal(result.action, null);
  assert.equal(result.evidence.mockSelfTestPassed, true);
  assert.equal(result.evidence.integrationLoaded, true);
  assert.equal(result.evidence.hookFired, true);
  assert.equal(result.evidence.behaviorOk, true);
  assert.equal(exitCodeFor(result), 0);
}));

test('sabotage: a forbidden flag yields hook-not-fired, never pass', () => withTemp(async (dir) => {
  const consumerPath = writeConsumer(dir, { consumer: { flags: ['--bare'] } });
  const scenarioPath = writeScenario(dir, validScenario());
  const result = await runConformance({ harnessId: 'claude', scenarioPath, consumerPath, dryRun: true });
  assert.equal(result.outcome, 'hook-not-fired');
  assert.notEqual(result.outcome, 'pass');
  assert.equal(result.evidence.hookFired, false);
  assert.equal(result.evidence.integrationLoaded, true);
  assert.equal(exitCodeFor(result), 1);
}));

test('sabotage: an absent integration after install yields load-failed', () => withTemp(async (dir) => {
  const consumerPath = writeConsumer(dir, { install: 'process.exit(0);\n' });
  const scenarioPath = writeScenario(dir, validScenario());
  const result = await runConformance({ harnessId: 'claude', scenarioPath, consumerPath, dryRun: true });
  assert.equal(result.outcome, 'load-failed');
  assert.equal(result.evidence.integrationLoaded, false);
  assert.equal(exitCodeFor(result), 1);
}));

test('sabotage: a malformed scenario yields mock-incompatible, never harness-broken', () => withTemp(async (dir) => {
  const consumerPath = writeConsumer(dir);
  const scenarioPath = writeScenario(dir, {
    id: 'malformed',
    prompt: 'x',
    turns: [{ toolCalls: [{ intent: 'shell', arguments: { command: 'exit 1' } }], text: 'both' }],
  });
  const result = await runConformance({ harnessId: 'claude', scenarioPath, consumerPath, dryRun: true });
  assert.equal(result.outcome, 'mock-incompatible');
  assert.notEqual(result.outcome, 'harness-broken');
  assert.equal(result.evidence.mockSelfTestPassed, false);
  assert.equal(result.attribution, 'mock');
  assert.equal(exitCodeFor(result), 1);
}));

test('sabotage: an expired quarantine entry hard-fails regardless of the run outcome', () => withTemp(async (dir) => {
  const consumerPath = writeConsumer(dir);
  const scenarioPath = writeScenario(dir, validScenario());
  const quarantinePath = join(dir, 'quarantine.json');
  writeFileSync(quarantinePath, JSON.stringify({
    budget: 3,
    entries: [{ harness: 'claude', version: 'latest', outcome: 'harness-broken', reason: 'x', issue: '#1', expiresAt: '2020-01-01' }],
  }));
  const result = await runConformance({ harnessId: 'claude', scenarioPath, consumerPath, dryRun: true, quarantinePath, now: new Date('2026-06-01') });
  assert.equal(result.outcome, 'pass');
  assert.equal(result.hardFail, true);
  assert.equal(result.hardFailReason, 'expired-quarantine');
  assert.notEqual(exitCodeFor(result), 0);
}));

test('quarantine: an active entry marks a harness-broken run untested and does not block', () => withTemp(async (dir) => {
  const consumerPath = writeConsumer(dir);
  const scenarioPath = writeScenario(dir, validScenario());
  const quarantinePath = join(dir, 'quarantine.json');
  writeFileSync(quarantinePath, JSON.stringify({
    budget: 3,
    entries: [{ harness: 'claude', version: 'latest', outcome: 'harness-broken', reason: 'x', issue: '#1', expiresAt: '2027-01-01' }],
  }));
  const result = await runConformance({ harnessId: 'claude', scenarioPath, consumerPath, dryRun: true, quarantinePath, now: new Date('2026-06-01') });
  assert.equal(result.quarantined, false);
  assert.equal(result.hardFail, false);
}));

test('quarantine: exceeding the budget hard-fails', () => withTemp(async (dir) => {
  const consumerPath = writeConsumer(dir);
  const scenarioPath = writeScenario(dir, validScenario());
  const quarantinePath = join(dir, 'quarantine.json');
  const entry = (n) => ({ harness: `h${n}`, version: 'latest', outcome: 'harness-broken', reason: 'x', issue: `#${n}`, expiresAt: '2027-01-01' });
  writeFileSync(quarantinePath, JSON.stringify({ budget: 1, entries: [entry(1), entry(2)] }));
  const result = await runConformance({ harnessId: 'claude', scenarioPath, consumerPath, dryRun: true, quarantinePath, now: new Date('2026-06-01') });
  assert.equal(result.hardFail, true);
  assert.equal(result.hardFailReason, 'quarantine-over-budget');
  assert.notEqual(exitCodeFor(result), 0);
}));

test('an unverified harness is refused rather than invented', () => withTemp(async (dir) => {
  const consumerPath = writeConsumer(dir);
  const scenarioPath = writeScenario(dir, validScenario());
  await assert.rejects(
    runConformance({ harnessId: 'codex', scenarioPath, consumerPath, dryRun: true }),
    /unverified/,
  );
}));

test('one scenario drives claude and opencode unchanged through their vocabularies', () => {
  const scenario = JSON.parse(readFileSync(SCENARIO, 'utf8'));
  const ops = loadOpsConfig();
  const claude = compileScenario(scenario, ops.harnesses.claude.toolVocabulary, 'claude-sonnet-4-5');
  const opencode = compileScenario(scenario, ops.harnesses.opencode.toolVocabulary, 'claude-sonnet-4-5');
  assert.equal(claude.turns[0].toolCalls[0].name, 'Bash');
  assert.equal(opencode.turns[0].toolCalls[0].name, 'bash');
  assert.deepEqual(claude.turns[0].toolCalls[0].arguments, { command: 'exit 1' });
  assert.deepEqual(opencode.turns[0].toolCalls[0].arguments, { command: 'exit 1' });
  assert.equal(claude.turns[1].text, opencode.turns[1].text);
});

test('compileScenario rejects an intent with no vocabulary binding', () => {
  const scenario = { id: 'x', turns: [{ toolCalls: [{ intent: 'teleport', arguments: {} }] }] };
  assert.throws(() => compileScenario(scenario, { shell: { name: 'Bash', arguments: {} } }, 'm'), /no tool vocabulary/);
});

test('substitute replaces known placeholders and leaves unknown ones intact', () => {
  assert.equal(substitute('{{A}}-{{B}}', { A: '1' }), '1-{{B}}');
  assert.equal(substitute('{{WORKSPACE}}/x', { WORKSPACE: '/tmp/w' }), '/tmp/w/x');
});

test('loadConsumer parses JSON and a minimal YAML subset', () => withTemp((dir) => {
  const jsonPath = join(dir, 'c.json');
  writeFileSync(jsonPath, JSON.stringify({ install: 'a', assert: 'b', artifacts: ['x'], detect: { integration: { file: 'x' } } }));
  const json = loadConsumer(jsonPath);
  assert.equal(json.install, 'a');
  assert.deepEqual(json.artifacts, ['x']);
  assert.equal(json.detect.integration.file, 'x');

  const yamlPath = join(dir, 'c.yaml');
  writeFileSync(yamlPath, [
    'install: node install.mjs',
    'assert: node assert.mjs',
    'artifacts:',
    '  - .claude/settings.json',
    '  - .opencode/plugin.ts',
    'detect:',
    '  integration:',
    '    file: .claude/settings.json',
    '  hook:',
    '    traceContains: scenario',
    '',
  ].join('\n'));
  const yaml = loadConsumer(yamlPath);
  assert.equal(yaml.install, 'node install.mjs');
  assert.deepEqual(yaml.artifacts, ['.claude/settings.json', '.opencode/plugin.ts']);
  assert.equal(yaml.detect.integration.file, '.claude/settings.json');
  assert.equal(yaml.detect.hook.traceContains, 'scenario');
}));

test('exitCodeFor maps the action axis and hard failures', () => {
  assert.equal(exitCodeFor({ action: null, hardFail: false }), 0);
  assert.equal(exitCodeFor({ action: 'warn', hardFail: false }), 0);
  assert.equal(exitCodeFor({ action: 'quarantine', hardFail: false }), 0);
  assert.equal(exitCodeFor({ action: 'block', hardFail: false }), 1);
  assert.equal(exitCodeFor({ action: 'block', hardFail: true }), 2);
});

test('CLI: a dry-run prints classified JSON and exits per the action axis', () => withTemp((dir) => {
  const consumerPath = writeConsumer(dir);
  const scenarioPath = writeScenario(dir, validScenario());
  const out = execFileSync('node', [RUNNER, '--harness', 'claude', '--scenario', scenarioPath, '--consumer', consumerPath, '--dry-run'], { encoding: 'utf8' });
  const result = JSON.parse(out);
  assert.equal(result.outcome, 'pass');
  assert.equal(result.harness, 'claude');
}));

test('CLI: a blocked run exits non-zero', () => withTemp((dir) => {
  const consumerPath = writeConsumer(dir, { consumer: { flags: ['--bare'] } });
  const scenarioPath = writeScenario(dir, validScenario());
  assert.throws(
    () => execFileSync('node', [RUNNER, '--harness', 'claude', '--scenario', scenarioPath, '--consumer', consumerPath, '--dry-run'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    (error) => {
      assert.equal(error.status, 1);
      assert.equal(JSON.parse(error.stdout).outcome, 'hook-not-fired');
      return true;
    },
  );
}));

test('CLI: --out writes a machine-readable result file', () => withTemp((dir) => {
  const consumerPath = writeConsumer(dir);
  const scenarioPath = writeScenario(dir, validScenario());
  const outDir = join(dir, 'out');
  execFileSync('node', [RUNNER, '--harness', 'claude', '--scenario', scenarioPath, '--consumer', consumerPath, '--dry-run', '--out', outDir], { encoding: 'utf8' });
  const written = JSON.parse(readFileSync(join(outDir, 'claude-hook-fires-on-shell.json'), 'utf8'));
  assert.equal(written.outcome, 'pass');
}));

test('a spawn failure of the harness yields infra-error, not a silent pass', () => withTemp(async (dir) => {
  const consumerPath = writeConsumer(dir);
  const scenarioPath = writeScenario(dir, validScenario());
  const result = await runConformance({ harnessId: 'claude', scenarioPath, consumerPath, dryRun: false, runOverride: 'harness-kit-no-such-binary' });
  assert.equal(result.evidence.infraOk, false);
  assert.equal(result.outcome, 'infra-error');
  assert.notEqual(result.outcome, 'pass');
}));
