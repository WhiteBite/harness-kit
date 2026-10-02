#!/usr/bin/env node
/** harness-kit self-test: registry validation, sabotage fixtures, forward compatibility, and a two-owner coexistence sweep over every mergeable registry row. */
import { loadRegistry, validateRegistry } from '../src/registry.mjs';
import { mergeHooks } from '../src/merge.mjs';

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

function collectCommands(config, shape) {
  const commands = [];
  const walkEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (typeof entry.command === 'string') commands.push(entry.command);
    if (entry.action && typeof entry.action.command === 'string') commands.push(entry.action.command);
    if (Array.isArray(entry.hooks)) entry.hooks.forEach(walkEntry);
  };
  if (shape === 'hooks-array') {
    (Array.isArray(config.hooks) ? config.hooks : []).forEach(walkEntry);
    return commands;
  }
  const container = shape === 'root-events' ? config : config.hooks || {};
  for (const entries of Object.values(container)) {
    if (Array.isArray(entries)) entries.forEach(walkEntry);
  }
  return commands;
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
    const commands = collectCommands(step2, shape);
    assert(commands.includes(MINE), `${id}: own entry lost after foreign merge`);
    assert(commands.includes(THEIRS), `${id}: foreign entry missing`);

    const reinstall = mergeHooks(step2, templateFor(shape, MINE), { shape, isMine });
    const ownAgain = collectCommands(reinstall, shape).filter(isMine);
    assert(ownAgain.length === 1, `${id}: reinstall must not duplicate own entries, got ${ownAgain.length}`);

    const uninstalled = mergeHooks(reinstall, emptyTemplateFor(shape), { shape, isMine });
    const remaining = collectCommands(uninstalled, shape);
    assert(!remaining.some(isMine), `${id}: uninstall left own entries behind`);
    assert(remaining.includes(THEIRS), `${id}: uninstall removed a foreign entry`);
    swept += 1;
  }
  assert(swept >= 5, `expected at least 5 mergeable harness rows, swept ${swept}`);
});

console.log(failures === 0 ? `\nself-test: all checks passed` : `\nself-test: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
