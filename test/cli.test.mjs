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

test('vendor writes a lock, check validates it and diff reports changes', () => {
  withTemp((dir) => {
    const target = join(dir, 'vendor', 'harness-kit');
    run(['vendor', target]);
    const lock = JSON.parse(readFileSync(join(target, 'harness-kit.lock'), 'utf8'));
    assert.equal(lock.lockVersion, 1);
    assert.equal(typeof lock.files['registry/harnesses.json'], 'string');
    assert.match(run(['diff', target]), /no file differences/);
    const manifestPath = join(target, 'manifest.json');
    const vendored = JSON.parse(readFileSync(manifestPath, 'utf8'));
    vendored.files['src/index.mjs'] = '0'.repeat(64);
    writeFileSync(manifestPath, `${JSON.stringify(vendored, null, 2)}\n`);
    assert.match(run(['diff', target]), /~ src\/index\.mjs/);
  });
});

test('check is green on a deliberate pin but --strict fails when the pin is behind', () => {
  withTemp((dir) => {
    const target = join(dir, 'vendor', 'harness-kit');
    run(['vendor', target]);
    for (const name of ['manifest.json', 'harness-kit.lock']) {
      const path = join(target, name);
      const data = JSON.parse(readFileSync(path, 'utf8'));
      data.kitVersion = '0.0.1';
      writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
    }
    assert.match(run(['check', target]), /files match manifest/);
    assert.throws(() => run(['check', target, '--strict']), /behind/);
  });
});

test('check rejects a lock that disagrees with the manifest', () => {
  withTemp((dir) => {
    const target = join(dir, 'vendor', 'harness-kit');
    run(['vendor', target]);
    const lockPath = join(target, 'harness-kit.lock');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.registryVersion = '9.9.9';
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    assert.throws(() => run(['check', target]), /disagrees/);
  });
});

test('update re-vendors a tampered copy', () => {
  withTemp((dir) => {
    const target = join(dir, 'vendor', 'harness-kit');
    run(['vendor', target]);
    writeFileSync(join(target, 'src', 'index.mjs'), 'tampered\n');
    run(['update', target]);
    assert.match(run(['check', target]), /files match manifest/);
  });
});
