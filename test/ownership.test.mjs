import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { recordOwnership, ownedLocators, entryMatchesHash, readOwnership, sidecarPath } from '../src/ownership.mjs';

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
