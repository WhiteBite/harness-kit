import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { clearOwnership, recordOwnership, ownedLocators, entryMatchesHash, readOwnership, sidecarPath } from '../src/ownership.mjs';
import { locatorFor, stripOwned } from '../src/merge.mjs';

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hk-own-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('recordOwnership preserves records for other locators of the same owner/file', () => {
  withTemp((dir) => {
    const config = { hooks: { PreToolUse: [{ command: 'a' }], PostToolUse: [{ command: 'b' }] } };
    recordOwnership(dir, 'me', 'f.json', config, [['hooks', 'PreToolUse', 0]]);
    recordOwnership(dir, 'me', 'f.json', config, [['hooks', 'PostToolUse', 0]]);
    const locators = ownedLocators(dir, 'me', 'f.json').map((entry) => entry.locator.join('.'));
    assert.deepEqual(locators.sort(), ['hooks.PostToolUse.0', 'hooks.PreToolUse.0']);
  });
});

test('recordOwnership re-recording a locator replaces its hash', () => {
  withTemp((dir) => {
    recordOwnership(dir, 'me', 'f.json', { a: 1 }, [['a']]);
    recordOwnership(dir, 'me', 'f.json', { a: 2 }, [['a']]);
    const entries = ownedLocators(dir, 'me', 'f.json');
    assert.equal(entries.length, 1);
    assert.ok(entryMatchesHash({ a: 2 }, entries[0]));
    assert.ok(!entryMatchesHash({ a: 1 }, entries[0]));
  });
});

test('readOwnership ignores malformed sidecar entries instead of crashing', () => {
  withTemp((dir) => {
    mkdirSync(join(dir, '.harness-kit'), { recursive: true });
    writeFileSync(
      sidecarPath(dir),
      JSON.stringify({ version: 1, entries: [{ owner: 'me' }, { owner: 'me', file: 'f', locator: ['a'], sha256: 'x' }] }),
    );
    assert.equal(readOwnership(dir).entries.length, 1);
  });
});

test('entryMatchesHash returns false for a record with a non-array locator', () => {
  assert.equal(entryMatchesHash({ a: 1 }, { owner: 'me', file: 'f', locator: null, sha256: 'x' }), false);
});

test('clearOwnership removes the owner records and spares other owners', () => {
  withTemp((dir) => {
    recordOwnership(dir, 'me', 'f.json', { a: 1 }, [['a']]);
    recordOwnership(dir, 'them', 'f.json', { b: 1 }, [['b']]);
    recordOwnership(dir, 'me', 'other.json', { a: 1 }, [['a']]);
    clearOwnership(dir, 'me', 'f.json');
    const mine = ownedLocators(dir, 'me');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].file, 'other.json');
    assert.equal(ownedLocators(dir, 'them').length, 1);
    clearOwnership(dir, 'me');
    assert.deepEqual(ownedLocators(dir, 'me'), []);
    assert.equal(ownedLocators(dir, 'them').length, 1, 'other owners survive a full clear');
  });
});

test('stripOwned removes hash-verified entries and never deletes a shifted or foreign entry', () => {
  withTemp((dir) => {
    const config = { hooks: { PreToolUse: [{ command: 'mine --x' }, { command: 'foreign' }] } };
    recordOwnership(dir, 'me', 'hooks.json', config, [['hooks', 'PreToolUse', 0]]);

    const exact = stripOwned(config, { records: ownedLocators(dir, 'me', 'hooks.json') });
    assert.equal(exact.removed, 1);
    assert.deepEqual(exact.config.hooks.PreToolUse, [{ command: 'foreign' }]);
    assert.equal(config.hooks.PreToolUse.length, 2, 'the input config must stay untouched');

    const shifted = { hooks: { PreToolUse: [{ command: 'foreign' }, { command: 'mine --x' }] } };
    const isMine = (command) => typeof command === 'string' && command.startsWith('mine');
    const shiftResult = stripOwned(shifted, { records: ownedLocators(dir, 'me', 'hooks.json'), isMine });
    assert.equal(shiftResult.removed, 0, 'a hash mismatch alone must never delete');
    assert.deepEqual(shiftResult.config.hooks.PreToolUse, [{ command: 'foreign' }, { command: 'mine --x' }]);

    const drifted = { hooks: { PreToolUse: [{ command: 'mine --changed' }] } };
    const driftResult = stripOwned(drifted, { records: ownedLocators(dir, 'me', 'hooks.json'), isMine });
    assert.equal(driftResult.removed, 1, 'the substring fallback confirms an edited-but-ours entry');
    assert.deepEqual(driftResult.config.hooks, {});
  });
});

test('locatorFor builds the positional locator for each container kind', () => {
  assert.deepEqual(locatorFor('nested-hooks', 'PreToolUse', 2), ['hooks', 'PreToolUse', 2]);
  assert.deepEqual(locatorFor('versioned-typed', 'preToolUse', 1), ['hooks', 'preToolUse', 1]);
  assert.deepEqual(locatorFor('root-events', 'PreToolUse', 0), ['PreToolUse', 0]);
  assert.deepEqual(locatorFor('hooks-array', null, 3), ['hooks', 3]);
  assert.throws(() => locatorFor('nested-hooks', null, 0), /event/);
  assert.throws(() => locatorFor('nested-hooks', 'PreToolUse', -1), /index/);
});
