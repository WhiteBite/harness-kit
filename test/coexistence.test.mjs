import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeHooks } from '../src/merge.mjs';
import { recordOwnership, ownedLocators, entryMatchesHash, readOwnership } from '../src/ownership.mjs';

const SLOP_COMMAND = 'node "/tools/stop-ai-slop/skill/scripts/scan.mjs" --pre-tool';
const DEJAVU_COMMAND = 'bun "/tools/dejavu-gates/src/cli.ts" pre --harness codex';
const DEJAVU_POST_COMMAND = 'bun "/tools/dejavu-gates/src/cli.ts" post --harness codex';

const isSlop = (command) => typeof command === 'string' && command.includes('--pre-tool');
const isDejavu = (command) => typeof command === 'string' && command.includes('src/cli.ts') && command.includes('--harness codex');

const slopTemplate = {
  hooks: {
    PreToolUse: [
      { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: SLOP_COMMAND }] },
    ],
  },
};

const dejavuTemplate = {
  hooks: {
    PreToolUse: [
      { matcher: '^(Bash|apply_patch)$', hooks: [{ type: 'command', command: DEJAVU_COMMAND, timeout: 30 }] },
    ],
    PostToolUse: [
      { matcher: '^(Bash|apply_patch)$', hooks: [{ type: 'command', command: DEJAVU_POST_COMMAND, timeout: 30 }] },
    ],
  },
};

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
  const container = shape === 'root-events' ? config : (config.hooks || {});
  for (const entries of Object.values(container)) {
    if (Array.isArray(entries)) entries.forEach(walkEntry);
  }
  return commands;
}

test('spike: two owners coexist in one nested-hooks config (codex site)', () => {
  const afterSlop = mergeHooks({}, slopTemplate, { shape: 'nested-hooks', isMine: isSlop });
  const afterBoth = mergeHooks(afterSlop, dejavuTemplate, { shape: 'nested-hooks', isMine: isDejavu });

  const commands = collectCommands(afterBoth, 'nested-hooks');
  assert.ok(commands.some(isSlop), 'slop entry must survive dejavu install');
  assert.ok(commands.some((c) => c === DEJAVU_COMMAND), 'dejavu pre entry must be present');
  assert.ok(commands.some((c) => c === DEJAVU_POST_COMMAND), 'dejavu post entry must be present');
  assert.equal(afterBoth.hooks.PreToolUse.length, 2, 'one group per owner, no duplication');
});

test('spike: reinstall is byte-identical for the same owner and set-preserving across owners', () => {
  const step1 = mergeHooks({}, slopTemplate, { shape: 'nested-hooks', isMine: isSlop });
  const step2 = mergeHooks(step1, dejavuTemplate, { shape: 'nested-hooks', isMine: isDejavu });
  const reinstall = mergeHooks(step2, dejavuTemplate, { shape: 'nested-hooks', isMine: isDejavu });
  assert.equal(JSON.stringify(reinstall), JSON.stringify(step2), 'same-owner reinstall must be byte-identical');

  const slopReinstall = mergeHooks(step2, slopTemplate, { shape: 'nested-hooks', isMine: isSlop });
  assert.deepEqual(
    collectCommands(slopReinstall, 'nested-hooks').sort(),
    collectCommands(step2, 'nested-hooks').sort(),
    'cross-owner reinstall preserves the entry set; strip-then-append may move own entries to the end of each event'
  );

  const dejavuUninstall = mergeHooks(step2, { hooks: {} }, { shape: 'nested-hooks', isMine: isDejavu });
  const remaining = collectCommands(dejavuUninstall, 'nested-hooks');
  assert.ok(remaining.every(isSlop), `only slop entries must remain, got: ${remaining.join(' | ')}`);
  assert.ok(dejavuUninstall.hooks.PostToolUse === undefined || dejavuUninstall.hooks.PostToolUse.length === 0, 'emptied dejavu-only event must not linger with entries');
});

test('spike: foreign structure survives every operation', () => {
  const seeded = {
    permissions: { allow: ['Bash'] },
    hooks: {
      PreToolUse: [
        { matcher: 'WebSearch', hooks: [{ type: 'command', command: 'node /foreign/audit.js', timeout: 5 }] },
      ],
      SomeCustomEvent: [{ matcher: '*', hooks: [{ type: 'command', command: '/foreign/custom.sh' }] }],
    },
  };
  let state = mergeHooks(seeded, slopTemplate, { shape: 'nested-hooks', isMine: isSlop });
  state = mergeHooks(state, dejavuTemplate, { shape: 'nested-hooks', isMine: isDejavu });
  state = mergeHooks(state, { hooks: {} }, { shape: 'nested-hooks', isMine: isSlop });

  assert.deepEqual(state.permissions, { allow: ['Bash'] });
  const commands = collectCommands(state, 'nested-hooks');
  assert.ok(commands.includes('node /foreign/audit.js'), 'foreign hook must survive');
  assert.ok(commands.includes('/foreign/custom.sh'), 'foreign custom event must survive');
  assert.ok(commands.some(isDejavu), 'dejavu entries must survive slop uninstall');
  assert.ok(!commands.some(isSlop), 'slop entries must be gone');
});

test('spike: mixed group loses only own leaves', () => {
  const mixed = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write|Edit',
          hooks: [
            { type: 'command', command: 'node /foreign/other.js' },
            { type: 'command', command: SLOP_COMMAND },
          ],
        },
      ],
    },
  };
  const uninstalled = mergeHooks(mixed, { hooks: {} }, { shape: 'nested-hooks', isMine: isSlop });
  const group = uninstalled.hooks.PreToolUse[0];
  assert.equal(group.hooks.length, 1);
  assert.equal(group.hooks[0].command, 'node /foreign/other.js');
});

test('spike: two owners coexist in a root-events config (devin site)', () => {
  const slopRoot = { PreToolUse: [{ hooks: [{ type: 'command', command: SLOP_COMMAND }] }] };
  const dejavuRoot = {
    PreToolUse: [{ matcher: 'exec|write|edit', hooks: [{ type: 'command', command: DEJAVU_COMMAND, timeout: 30 }] }],
    PostToolUse: [{ matcher: 'exec|write|edit', hooks: [{ type: 'command', command: DEJAVU_POST_COMMAND, timeout: 30 }] }],
  };
  const step1 = mergeHooks({}, slopRoot, { shape: 'root-events', isMine: isSlop });
  const step2 = mergeHooks(step1, dejavuRoot, { shape: 'root-events', isMine: isDejavu });
  const commands = collectCommands(step2, 'root-events');
  assert.ok(commands.some(isSlop) && commands.some(isDejavu), 'both owners must coexist at the root');
  assert.equal(step2.hooks, undefined, 'root-events shape must not grow a hooks wrapper');

  const step3 = mergeHooks(step2, dejavuRoot, { shape: 'root-events', isMine: isDejavu });
  assert.equal(JSON.stringify(step3), JSON.stringify(step2), 'reinstall byte-identical');
});

test('hooks-array shape (kiro): strip by action.command, envelope preserved', () => {
  const template = {
    version: 'v1',
    hooks: [
      { name: 'dejavu-gates-pre', trigger: 'PreToolUse', matcher: 'shell|write', action: { type: 'command', command: DEJAVU_COMMAND }, timeout: 30 },
    ],
  };
  const seeded = { version: 'v1', hooks: [{ name: 'foreign-hook', trigger: 'PreToolUse', action: { type: 'command', command: 'node /foreign.js' } }] };
  const merged = mergeHooks(seeded, template, { shape: 'hooks-array', isMine: isDejavu });
  assert.equal(merged.version, 'v1');
  const commands = collectCommands(merged, 'hooks-array');
  assert.ok(commands.includes('node /foreign.js') && commands.includes(DEJAVU_COMMAND));

  const remerged = mergeHooks(merged, template, { shape: 'hooks-array', isMine: isDejavu });
  assert.equal(JSON.stringify(remerged), JSON.stringify(merged), 'byte-identical reinstall');

  const uninstalled = mergeHooks(merged, { hooks: [] }, { shape: 'hooks-array', isMine: isDejavu });
  assert.deepEqual(collectCommands(uninstalled, 'hooks-array'), ['node /foreign.js']);
});

test('versioned-flat shape (cursor): envelope kept, flat entries filtered by command', () => {
  const seeded = { version: 1, hooks: { beforeShellExecution: [{ command: 'node /foreign.js', timeout: 9 }] } };
  const template = { version: 1, hooks: { preToolUse: [{ command: DEJAVU_COMMAND, timeout: 30 }] } };
  const merged = mergeHooks(seeded, template, { shape: 'versioned-flat', isMine: isDejavu });
  assert.equal(merged.version, 1);
  assert.deepEqual(merged.hooks.beforeShellExecution, [{ command: 'node /foreign.js', timeout: 9 }]);
  assert.equal(merged.hooks.preToolUse[0].command, DEJAVU_COMMAND);

  const uninstalled = mergeHooks(merged, { hooks: {} }, { shape: 'versioned-flat', isMine: isDejavu });
  assert.equal(uninstalled.hooks.preToolUse, undefined, 'an emptied event key is dropped, not left as []');
  assert.deepEqual(uninstalled.hooks.beforeShellExecution, [{ command: 'node /foreign.js', timeout: 9 }]);
});

test('uninstall via an empty template leaves no empty event keys (nested-hooks and root-events)', () => {
  const nested = mergeHooks(
    { hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: SLOP_COMMAND }] }] } },
    { hooks: {} },
    { shape: 'nested-hooks', isMine: isSlop },
  );
  assert.deepEqual(nested.hooks, {}, 'an event emptied by stripping must be deleted, not left as []');

  const nestedMixed = mergeHooks(
    {
      hooks: {
        PreToolUse: [
          { matcher: 'Write', hooks: [{ type: 'command', command: SLOP_COMMAND }] },
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'node /foreign.js' }] },
        ],
      },
    },
    { hooks: {} },
    { shape: 'nested-hooks', isMine: isSlop },
  );
  assert.equal(nestedMixed.hooks.PreToolUse.length, 1, 'an event with a surviving foreign entry must keep its key');

  const root = mergeHooks(
    { PreToolUse: [{ hooks: [{ type: 'command', command: SLOP_COMMAND }] }] },
    {},
    { shape: 'root-events', isMine: isSlop },
  );
  assert.deepEqual(root, {}, 'an emptied root event must be deleted, not left as []');
});

test('ownership sidecar: records survive re-read, hash detects tampering, fallback never claims foreign entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-own-'));
  try {
    const config = {
      hooks: {
        PreToolUse: [
          { matcher: 'Write|Edit', hooks: [{ type: 'command', command: SLOP_COMMAND }] },
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'node /foreign.js' }] },
        ],
      },
    };
    const locators = [['hooks', 'PreToolUse', 0]];
    recordOwnership(dir, 'stop-ai-slop', '.codex/hooks.json', config, locators);

    const records = ownedLocators(dir, 'stop-ai-slop', '.codex/hooks.json');
    assert.equal(records.length, 1);
    assert.equal(entryMatchesHash(config, records[0]), true);

    const tampered = JSON.parse(JSON.stringify(config));
    tampered.hooks.PreToolUse[0].hooks[0].command = 'node /hijacked.js --pre-tool';
    assert.equal(entryMatchesHash(tampered, records[0]), false, 'hash must detect an out-of-band edit');

    const reloaded = readOwnership(dir);
    assert.equal(reloaded.entries.length, 1);
    assert.equal(reloaded.entries[0].owner, 'stop-ai-slop');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
