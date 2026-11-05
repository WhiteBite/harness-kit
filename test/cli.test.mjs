import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BIN = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'harness-kit.mjs');

function run(args) {
  return execFileSync('node', [BIN, ...args], { encoding: 'utf8' });
}

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hk-cli-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('versions prints kit and registry versions', () => {
  const out = run(['versions']);
  assert.match(out, /@whitebite\/harness-kit \d+\.\d+\.\d+/);
  assert.match(out, /registry \d+\.\d+\.\d+ \(schemaVersion 1\)/);
});

test('vendor writes a kit copy that check verifies; tampering fails check', () => {
  withTemp((dir) => {
    const target = join(dir, 'vendor', 'harness-kit');
    run(['vendor', target]);
    assert.match(run(['check', target]), /files match manifest/);
    const victim = join(target, 'registry', 'harnesses.json');
    writeFileSync(victim, `${readFileSync(victim, 'utf8')}\n`);
    assert.throws(() => run(['check', target]), /drifted/);
  });
});

test('vendor refuses to overwrite a non-kit directory', () => {
  withTemp((dir) => {
    writeFileSync(join(dir, 'keep.txt'), 'x');
    assert.throws(() => run(['vendor', dir]), /refusing to overwrite/);
  });
});

test('unknown command exits non-zero', () => {
  assert.throws(() => run(['frobnicate']));
});
