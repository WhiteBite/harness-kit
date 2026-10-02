import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCliPath, collectCommands, checkDrift } from '../src/drift.mjs';

const DEJAVU = 'bun "/tools/dejavu-gates/src/cli.ts" pre --harness codex';
const tolerant = (command) => typeof command === 'string' && command.includes('bun ') && command.includes('--harness codex') && command.includes('.ts');
const strict = (command) => typeof command === 'string' && command.includes('src/cli.ts') && command.includes('--harness codex');

test('extractCliPath: quoted .ts wins, bare .ts falls back, non-ts and non-strings are null', () => {
  assert.equal(extractCliPath(DEJAVU), '/tools/dejavu-gates/src/cli.ts');
  assert.equal(extractCliPath('bun /tools/x/src/cli.ts pre'), '/tools/x/src/cli.ts');
  assert.equal(extractCliPath('bun "C:\\tools\\dejavu-gates\\src\\cli.ts" pre'), 'C:\\tools\\dejavu-gates\\src\\cli.ts');
  assert.equal(extractCliPath('bun "/a/foo.mjs" /b/cli.ts pre'), '/b/cli.ts');
  assert.equal(extractCliPath('node /foreign/audit.js'), null);
  assert.equal(extractCliPath(42), null);
  assert.equal(extractCliPath(null), null);
});

test('collectCommands: reads every supported merge shape', () => {
  assert.deepEqual(
    collectCommands({ hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'a' }] }, { command: 'b' }] } }, { shape: 'nested-hooks' }),
    ['a', 'b'],
  );
  assert.deepEqual(collectCommands({ PreToolUse: [{ hooks: [{ command: 'c' }] }] }, { shape: 'root-events' }), ['c']);
  assert.deepEqual(collectCommands({ hooks: { preToolUse: [{ command: 'd' }] } }, { shape: 'versioned-flat' }), ['d']);
  assert.deepEqual(collectCommands({ hooks: { preToolUse: [{ type: 'command', command: 'e' }] } }, { shape: 'versioned-typed' }), ['e']);
  assert.deepEqual(collectCommands({ hooks: { PreToolUse: [{ matcher: 'bash', command: 'f' }] } }, { shape: 'flat-matcher' }), ['f']);
  assert.deepEqual(
    collectCommands({ hooks: [{ trigger: 'PreToolUse', action: { type: 'command', command: 'g' } }] }, { shape: 'hooks-array' }),
    ['g'],
  );
  assert.deepEqual(collectCommands({ hooks: [] }, { shape: 'hooks-array' }), []);
});

test('checkDrift: a parse error is broken', () => {
  assert.deepEqual(checkDrift({ parseError: true }, { shape: 'nested-hooks', identify: tolerant, pathExists: () => true }), {
    status: 'broken',
    detail: null,
  });
});

test('checkDrift: no identify match is missing', () => {
  const config = { hooks: { PreToolUse: [{ hooks: [{ command: 'node /foreign.js' }] }] } };
  assert.deepEqual(checkDrift({ config }, { shape: 'nested-hooks', identify: tolerant, pathExists: () => true }), {
    status: 'missing',
    detail: null,
  });
});

test('checkDrift: a rotted or unparseable cli path is stale', () => {
  const config = { hooks: { PreToolUse: [{ hooks: [{ command: DEJAVU }] }] } };
  assert.deepEqual(checkDrift({ config }, { shape: 'nested-hooks', identify: tolerant, pathExists: () => false }), {
    status: 'stale',
    detail: '/tools/dejavu-gates/src/cli.ts',
  });

  const unparseable = { hooks: { PreToolUse: [{ hooks: [{ command: 'bun --harness codex now' }] }] } };
  const loose = (command) => typeof command === 'string' && command.includes('--harness codex');
  assert.deepEqual(checkDrift({ config: unparseable }, { shape: 'nested-hooks', identify: loose, pathExists: () => true }), {
    status: 'stale',
    detail: null,
  });
});

test('checkDrift: a present cli path is ok', () => {
  const config = { hooks: { PreToolUse: [{ hooks: [{ command: DEJAVU }] }] } };
  assert.deepEqual(checkDrift({ config }, { shape: 'nested-hooks', identify: tolerant, pathExists: () => true }), {
    status: 'ok',
    detail: null,
  });
});

test('checkDrift: the tolerant predicate survives a corrupted path where the strict one reports missing', () => {
  const corrupted = { hooks: { PreToolUse: [{ hooks: [{ command: 'bun "/tools/gone/CORRUPTED.ts" pre --harness codex' }] }] } };
  assert.deepEqual(checkDrift({ config: corrupted }, { shape: 'nested-hooks', identify: tolerant, pathExists: () => false }), {
    status: 'stale',
    detail: '/tools/gone/CORRUPTED.ts',
  });
  assert.deepEqual(checkDrift({ config: corrupted }, { shape: 'nested-hooks', identify: strict, pathExists: () => false }), {
    status: 'missing',
    detail: null,
  });
});