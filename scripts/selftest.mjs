#!/usr/bin/env node
/** harness-kit self-test: registry validation, sabotage fixtures, forward compatibility, and a two-owner coexistence sweep over every mergeable registry row. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, validateRegistry } from '../src/registry.mjs';
import { mergeHooks } from '../src/merge.mjs';
import { writeMarkerBlock } from '../src/marker.mjs';
import { checkDrift, collectCommands, extractCliPath } from '../src/drift.mjs';
import { checkInstall } from '../src/doctor.mjs';

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

check('registry passes structural validation', () => {
  const problems = validateRegistry(registry);
  assert(problems.length === 0, problems.join('; '));
});

check('registry shape and coverage invariants', () => {
  assert(registry.schemaVersion === 1, 'schemaVersion must stay 1');
  assert(/^\d+\.\d+\.\d+$/.test(registry.registryVersion), 'registryVersion must be semver');
  assert(Object.keys(registry.harnesses).length >= 10, 'registry lost harness rows');
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
  assert(validateRegistry(bad).length > 0, 'invalid status must be rejected');
});

check('sabotage: merge without shape is caught', () => {
  const bad = clone(registry);
  delete bad.harnesses.devin.hooks.shape;
  assert(validateRegistry(bad).length > 0, 'write=merge without shape must be rejected');
});

check('sabotage: unknown write mode is caught', () => {
  const bad = clone(registry);
  bad.harnesses.cursor.hooks.write = 'sideways';
  assert(validateRegistry(bad).length > 0, 'unknown write mode must be rejected');
});

check('sabotage: rule without format is caught', () => {
  const bad = clone(registry);
  delete bad.harnesses.windsurf.rules[0].format;
  assert(validateRegistry(bad).length > 0, 'rule without format must be rejected');
});

check('forward compatibility: unknown keys and new harnesses are tolerated', () => {
  const extended = clone(registry);
  extended.harnesses.claude.futureField = { anything: true };
  extended.harnesses.newcomer = { name: 'Newcomer', status: 'experimental' };
  const problems = validateRegistry(extended);
  assert(problems.length === 0, problems.join('; '));
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
  assert(swept >= 5, `expected at least 5 mergeable harness rows, swept ${swept}`);
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
  assert(swept >= 5, `expected at least 5 event-map merge rows, swept ${swept}`);
});

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hk-selftest-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

check('sabotage: marker writer rejects a variant without its discriminator', () => {
  withTemp((dir) => {
    let message = null;
    try {
      writeMarkerBlock(join(dir, 'x'), '# >>> id >>>\n', { variant: 'shell-block' });
    } catch (error) {
      message = error && error.message;
    }
    assert(message !== null && /id/.test(message), 'shell-block without id must be rejected');
  });
});

check('sabotage: marker writer rejects an unknown variant', () => {
  withTemp((dir) => {
    let message = null;
    try {
      writeMarkerBlock(join(dir, 'x'), 'x', { variant: 'sideways' });
    } catch (error) {
      message = error && error.message;
    }
    assert(message !== null && /variant/.test(message), 'unknown marker variant must be rejected');
  });
});

check('drift: collectCommands and extractCliPath read every merge shape', () => {
  assert(collectCommands({ hooks: { PreToolUse: [{ command: MINE }] } }, { shape: 'nested-hooks' }).includes(MINE), 'nested leaf command must be collected');
  assert(collectCommands({ PreToolUse: [{ hooks: [{ command: MINE }] }] }, { shape: 'root-events' }).includes(MINE), 'root-events command must be collected');
  assert(extractCliPath('bun "/x/src/cli.ts" pre') === '/x/src/cli.ts', 'extractCliPath must parse a quoted .ts token');
});

check('sabotage: drift statuses stay inside the vocabulary', () => {
  const vocabulary = new Set(['broken', 'missing', 'stale', 'ok']);
  const identify = (command) => typeof command === 'string' && command.includes('--harness x');
  const configFor = (command) => ({ hooks: { PreToolUse: [{ hooks: [{ command }] }] } });
  const scenarios = [
    checkDrift({ parseError: true }, { shape: 'nested-hooks', identify, pathExists: () => true }),
    checkDrift({ config: configFor('node /foreign.js') }, { shape: 'nested-hooks', identify, pathExists: () => true }),
    checkDrift({ config: configFor('bun "/gone/cli.ts" pre --harness x') }, { shape: 'nested-hooks', identify, pathExists: () => false }),
    checkDrift({ config: configFor('bun "/here/cli.ts" pre --harness x') }, { shape: 'nested-hooks', identify, pathExists: () => true }),
  ];
  for (const result of scenarios) assert(vocabulary.has(result.status), `unexpected drift status ${JSON.stringify(result.status)}`);
  assert(scenarios.map((result) => result.status).sort().join(',') === 'broken,missing,ok,stale', 'all four drift statuses must be produced');
});

check('sabotage: checkInstall statuses stay inside the drift vocabulary', () => {
  withTemp((dir) => {
    const vocabulary = new Set(['broken', 'missing', 'stale', 'ok']);
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: MINE }, { command: THEIRS }] }] } }));
    const surfaces = [
      { id: 'unknown-kind', kind: 'surprise', path: 'x' },
      { id: 'absent', kind: 'hook-config', path: 'absent.json', shape: 'nested-hooks', identify: () => true },
      { id: 'mine', kind: 'hook-config', path: 'hooks.json', shape: 'nested-hooks', identify: isMine },
      { id: 'theirs', kind: 'hook-config', path: 'hooks.json', shape: 'nested-hooks', identify: (command) => typeof command === 'string' && command.includes('--harness x') },
    ];
    const findings = checkInstall(dir, { surfaces, pathExists: () => true });
    for (const result of findings) assert(vocabulary.has(result.status), `unexpected checkInstall status ${JSON.stringify(result.status)}`);
    assert(findings.map((result) => result.status).join(',') === 'broken,missing,stale,ok', `expected the full vocabulary in order, got ${findings.map((result) => result.status).join(',')}`);
  });
});

console.log(failures === 0 ? `\nself-test: all checks passed` : `\nself-test: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
