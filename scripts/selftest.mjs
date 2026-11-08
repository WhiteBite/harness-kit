#!/usr/bin/env node
/** harness-kit self-test: registry validation, sabotage fixtures, forward compatibility, a two-owner coexistence sweep over every mergeable registry row, and docs-table parity gates. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadRegistry, validateRegistry } from '../src/registry.mjs';
import { mergeHooks } from '../src/merge.mjs';
import { mergeMcpServers } from '../src/mcp.mjs';
import { mergeJsoncContainer, parseJsonc } from '../src/jsonc.mjs';
import { mergeTomlTable } from '../src/toml.mjs';
import { collectCommands } from '../src/drift.mjs';

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error && error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const MINE = 'node "/tools/mine/run.js" --mine-flag';
const THEIRS = 'bun "/tools/theirs/cli.ts" pre --harness x';
const isMine = (command) => typeof command === 'string' && command.includes('--mine-flag');

function templateFor(shape, command) {
  switch (shape) {
    case 'nested-hooks':
      return { hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command }] }] } };
    case 'root-events':
      return { PreToolUse: [{ hooks: [{ type: 'command', command }] }] };
    case 'versioned-flat':
      return { version: 1, hooks: { preToolUse: [{ command, timeout: 30 }] } };
    case 'versioned-typed':
      return { version: 1, hooks: { preToolUse: [{ type: 'command', command, timeoutSec: 30 }] } };
    case 'flat-matcher':
      return { hooks: { PreToolUse: [{ matcher: 'bash', command }] } };
    case 'hooks-array':
      return { version: 'v1', hooks: [{ name: 'kit-self-test', trigger: 'PreToolUse', action: { type: 'command', command } }] };
    default:
      throw new Error(`no template builder for shape ${shape}`);
  }
}

function emptyTemplateFor(shape) {
  if (shape === 'root-events') return {};
  if (shape === 'hooks-array') return { hooks: [] };
  return { hooks: {} };
}

const registry = loadRegistry();
const dialects = readFileSync('docs/dialects.md', 'utf8');

check('registry passes structural validation', () => {
  const problems = validateRegistry(registry);
  assert(problems.length === 0, problems.join('; '));
});

check('registry shape and coverage invariants', () => {
  assert(registry.schemaVersion === 1, 'schemaVersion must stay 1');
  assert(/^\d+\.\d+\.\d+$/.test(registry.registryVersion), 'registryVersion must be semver');
  assert(Object.keys(registry.harnesses).length === 29, 'registry row count changed - update this exact invariant when adding or removing a row');
  for (const [id, entry] of Object.entries(registry.harnesses)) {
    const hooks = entry.hooks;
    if (!hooks) continue;
    if (hooks.write === 'marker-block') {
      assert(hooks.markers && hooks.markers.open && hooks.markers.close, `${id}: marker-block requires markers.open/close`);
    }
    if (hooks.write === 'overwrite') {
      assert(String(hooks.config.project).includes('{tool}'), `${id}: overwrite is only safe for tool-owned files ({tool} in path)`);
    }
  }
});

check('sabotage: invalid status is caught', () => {
  const bad = clone(registry);
  bad.harnesses.claude.status = 'yolo';
  const problems = validateRegistry(bad);
  assert(problems.some((problem) => problem.includes('claude: status must be one of')), `expected a status problem, got: ${problems.join('; ')}`);
});

check('sabotage: merge without shape is caught', () => {
  const bad = clone(registry);
  delete bad.harnesses.devin.hooks.shape;
  const problems = validateRegistry(bad);
  assert(problems.some((problem) => problem.includes('devin: hooks.shape is required')), `expected a shape problem, got: ${problems.join('; ')}`);
});

check('sabotage: unknown write mode is caught', () => {
  const bad = clone(registry);
  bad.harnesses.cursor.hooks.write = 'sideways';
  const problems = validateRegistry(bad);
  assert(problems.some((problem) => problem.includes('cursor: hooks.write must be one of')), `expected a write problem, got: ${problems.join('; ')}`);
});

check('sabotage: rule without format is caught', () => {
  const bad = clone(registry);
  delete bad.harnesses.windsurf.rules[0].format;
  const problems = validateRegistry(bad);
  assert(problems.some((problem) => problem.includes('windsurf: rule.format must be one of')), `expected a rule format problem, got: ${problems.join('; ')}`);
});

check('forward compatibility: unknown keys and new harnesses are tolerated', () => {
  const extended = clone(registry);
  extended.harnesses.claude.futureField = { anything: true };
  extended.harnesses.newcomer = { name: 'Newcomer', status: 'experimental' };
  const problems = validateRegistry(extended);
  assert(problems.length === 0, problems.join('; '));
});

check('mcp: every mcp row declares config, format and container', () => {
  let swept = 0;
  for (const [id, entry] of Object.entries(registry.harnesses)) {
    const mcp = entry.mcp;
    if (!mcp) continue;
    assert(mcp.config && typeof mcp.config === 'object', `${id}: mcp.config required`);
    assert(['json', 'jsonc', 'toml'].includes(mcp.format), `${id}: mcp.format invalid`);
    assert(typeof mcp.container === 'string' && mcp.container !== '', `${id}: mcp.container required`);
    if (mcp.format !== 'json') assert(mcp.write === 'print-only' || mcp.write === 'merge-text', `${id}: non-JSON mcp must be print-only or merge-text`);
    if (mcp.write === 'merge') {
      assert(mcp.format === 'json', `${id}: mcp write=merge requires json format`);
      assert(mcp.tokenEnvSyntax, `${id}: mcp write=merge requires real env interpolation`);
    }
    if (mcp.write === 'merge-text') assert(mcp.format === 'jsonc' || mcp.format === 'toml', `${id}: mcp write=merge-text requires jsonc or toml`);
    swept += 1;
  }
  assert(swept === 18, `expected exactly 18 mcp rows, swept ${swept}`);
});

check('sabotage: invalid mcp format is caught', () => {
  const bad = clone(registry);
  bad.harnesses.claude.mcp.format = 'yaml';
  const problems = validateRegistry(bad);
  assert(problems.some((problem) => problem.includes('claude: mcp.format must be one of')), `expected an mcp format problem, got: ${problems.join('; ')}`);
});

check('sabotage: mcp without container is caught', () => {
  const bad = clone(registry);
  delete bad.harnesses.cursor.mcp.container;
  const problems = validateRegistry(bad);
  assert(problems.some((problem) => problem.includes('cursor: mcp.container is required')), `expected a container problem, got: ${problems.join('; ')}`);
});

check('sabotage: an unknown mcp write mode is caught', () => {
  const bad = clone(registry);
  bad.harnesses.claude.mcp.write = 'sideways';
  const problems = validateRegistry(bad);
  assert(problems.some((problem) => problem.includes('claude: mcp.write must be one of')), `expected an mcp write problem, got: ${problems.join('; ')}`);
});

check('sabotage: mcp write=merge with a non-json format is caught', () => {
  const bad = clone(registry);
  bad.harnesses.claude.mcp.format = 'toml';
  const problems = validateRegistry(bad);
  assert(problems.some((problem) => problem.includes('claude: mcp write=merge requires json format')), `expected an mcp merge-format problem, got: ${problems.join('; ')}`);
});

check('mcp coexistence sweep: two owners merge server maps, reinstall byte-identical, uninstall strips only own', () => {
  let swept = 0;
  for (const [id, entry] of Object.entries(registry.harnesses)) {
    const mcp = entry.mcp;
    if (!mcp || mcp.write !== 'merge') continue;
    const container = mcp.container;
    const isA = (name) => name === 'a';
    const templateA = { a: { command: 'npx', args: ['-y', 'a'] } };
    const templateB = { b: { command: 'npx', args: ['-y', 'b'] } };

    const step1 = mergeMcpServers({}, templateA, { container, isMine: isA });
    const step2 = mergeMcpServers(step1, templateB, { container, isMine: () => false });
    assert(step2[container].a, `${id}: own server lost after foreign merge`);
    assert(step2[container].b, `${id}: foreign server missing`);

    const reinstall = mergeMcpServers(step2, templateA, { container, isMine: isA });
    const reinstallAgain = mergeMcpServers(reinstall, templateA, { container, isMine: isA });
    assert(JSON.stringify(reinstallAgain) === JSON.stringify(reinstall), `${id}: reinstall must be byte-identical`);

    const uninstalled = mergeMcpServers(reinstall, {}, { container, isMine: isA });
    assert(!uninstalled[container].a, `${id}: uninstall left own server behind`);
    assert(uninstalled[container].b, `${id}: uninstall removed a foreign server`);
    swept += 1;
  }
  assert(swept === 8, `expected exactly 8 mergeable mcp rows, swept ${swept}`);
});

check('mcp merge-text sweep: two owners splice JSONC/TOML, reinstall stable, uninstall strips only own', () => {
  let swept = 0;
  for (const [id, entry] of Object.entries(registry.harnesses)) {
    const mcp = entry.mcp;
    if (!mcp || mcp.write !== 'merge-text') continue;
    const container = mcp.container;
    const isA = (name) => name === 'a';
    const templateA = { a: { command: 'npx', args: ['-y', 'a'] } };
    const templateB = { b: { command: 'npx', args: ['-y', 'b'] } };
    const merge = mcp.format === 'toml' ? mergeTomlTable : mergeJsoncContainer;
    const empty = mcp.format === 'toml' ? '' : '{}';
    const has = (text, name) => (mcp.format === 'toml'
      ? text.includes(`[${container}.${name}]`)
      : Boolean((parseJsonc(text)[container] || {})[name]));

    const step1 = merge(empty, templateA, { container, isMine: isA });
    const step2 = merge(step1.text, templateB, { container, isMine: () => false });
    assert(has(step2.text, 'a'), `${id}: own server lost after foreign splice`);
    assert(has(step2.text, 'b'), `${id}: foreign server missing`);

    const reinstall = merge(step2.text, templateA, { container, isMine: isA });
    const reinstallAgain = merge(reinstall.text, templateA, { container, isMine: isA });
    assert(reinstallAgain.changed === false && reinstallAgain.text === reinstall.text, `${id}: reinstall must be stable`);

    const uninstalled = merge(reinstall.text, {}, { container, isMine: isA });
    assert(!has(uninstalled.text, 'a'), `${id}: uninstall left own server behind`);
    assert(has(uninstalled.text, 'b'), `${id}: uninstall removed a foreign server`);
    swept += 1;
  }
  assert(swept === 3, `expected exactly 3 merge-text rows, swept ${swept}`);
});

check('provenance: every stable row declares verified{against, at}', () => {
  let swept = 0;
  for (const [id, entry] of Object.entries(registry.harnesses)) {
    if (entry.status !== 'stable') continue;
    assert(entry.verified && entry.verified.against && /^\d{4}-\d{2}-\d{2}$/.test(entry.verified.at), `${id}: stable row must carry verified provenance`);
    swept += 1;
  }
  assert(swept === 11, `expected exactly 11 stable rows, swept ${swept}`);
});

check('docs: the dialects MCP table covers every registry mcp row', () => {
  const listed = new Set([...dialects.matchAll(/^\|\s*([a-z][a-z0-9-]*)\s*\|/gm)].map((match) => match[1]));
  const missing = Object.entries(registry.harnesses).filter(([, entry]) => entry.mcp).map(([id]) => id).filter((id) => !listed.has(id));
  assert(missing.length === 0, `docs/dialects.md MCP table lags the registry: ${missing.join(', ')}`);
});

check('docs: the dialects shape table lists every harness declaring a shape', () => {
  const listed = new Set(
    [...dialects.matchAll(/^\| `([a-z-]+)` \|[^|]+\|[^|]+\|([^|]+)\|/gm)]
      .flatMap((match) => match[2].split(','))
      .map((name) => name.trim()),
  );
  const missing = Object.entries(registry.harnesses)
    .filter(([, entry]) => entry.hooks && entry.hooks.shape)
    .map(([id]) => id)
    .filter((id) => !listed.has(id));
  assert(missing.length === 0, `docs/dialects.md shape table lags the registry: ${missing.join(', ')}`);
});

check('sabotage: a stable row without verified is caught', () => {
  const bad = clone(registry);
  delete bad.harnesses.claude.verified;
  const problems = validateRegistry(bad);
  assert(problems.some((problem) => problem.includes('claude: a stable row requires verified provenance')), `expected a provenance problem, got: ${problems.join('; ')}`);
});

check('sabotage: a malformed verified date is caught', () => {
  const bad = clone(registry);
  bad.harnesses.codex.verified.at = '03-10-2026';
  const problems = validateRegistry(bad);
  assert(problems.some((problem) => problem.includes('codex: verified must be')), `expected a verified problem, got: ${problems.join('; ')}`);
});

check('coexistence sweep: two owners merge, reinstall byte-identical, uninstall strips only own', () => {
  let swept = 0;
  for (const [id, entry] of Object.entries(registry.harnesses)) {
    const hooks = entry.hooks;
    if (!hooks || hooks.write !== 'merge') continue;
    const shape = hooks.shape;
    const step1 = mergeHooks({}, templateFor(shape, MINE), { shape, isMine });
    const step2 = mergeHooks(step1, templateFor(shape, THEIRS), { shape, isMine: () => false });
    const commands = collectCommands(step2, { shape });
    assert(commands.includes(MINE), `${id}: own entry lost after foreign merge`);
    assert(commands.includes(THEIRS), `${id}: foreign entry missing`);

    const reinstall = mergeHooks(step2, templateFor(shape, MINE), { shape, isMine });
    const ownAgain = collectCommands(reinstall, { shape }).filter(isMine);
    assert(ownAgain.length === 1, `${id}: reinstall must not duplicate own entries, got ${ownAgain.length}`);

    const uninstalled = mergeHooks(reinstall, emptyTemplateFor(shape), { shape, isMine });
    const remaining = collectCommands(uninstalled, { shape });
    assert(!remaining.some(isMine), `${id}: uninstall left own entries behind`);
    assert(remaining.includes(THEIRS), `${id}: uninstall removed a foreign entry`);
    swept += 1;
  }
  assert(swept === 10, `expected exactly 10 mergeable hook rows, swept ${swept}`);
});

check('coexistence sweep: a non-array foreign event value survives verbatim', () => {
  let swept = 0;
  for (const [id, entry] of Object.entries(registry.harnesses)) {
    const hooks = entry.hooks;
    if (!hooks || hooks.write !== 'merge' || hooks.shape === 'hooks-array') continue;
    const shape = hooks.shape;
    const template = templateFor(shape, MINE);
    const nested = shape !== 'root-events';
    const event = Object.keys(nested ? template.hooks : template)[0];
    const foreign = { legacy: 'object' };
    const seeded = nested ? { hooks: { [event]: foreign } } : { [event]: foreign };
    const merged = mergeHooks(seeded, template, { shape, isMine });
    const survived = nested ? merged.hooks[event] : merged[event];
    assert(JSON.stringify(survived) === JSON.stringify(foreign), `${id}: non-array foreign event value must survive verbatim`);
    swept += 1;
  }
  assert(swept === 10, `expected exactly 10 event-map merge rows, swept ${swept}`);
});

check('repo hygiene: no drive-letter paths in src, registry, types, scripts, bin, docs', () => {
  // test/ is out of the scan: its fixtures legitimately carry Windows paths for parser coverage
  const DRIVE_PATH = /[A-Za-z]:\\/;
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (DRIVE_PATH.test(readFileSync(full, 'utf8'))) offenders.push(relative('.', full).split('\\').join('/'));
    }
  };
  for (const root of ['src', 'registry', 'types', 'scripts', 'bin', 'docs']) walk(root);
  assert(offenders.length === 0, `machine-local paths leaked: ${offenders.join(', ')}`);
});

console.log(failures === 0 ? `\nself-test: all checks passed` : `\nself-test: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
