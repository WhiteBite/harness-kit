import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applySync, nextVersion, surfaceProblems, tagProblem } from '../scripts/version.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hk-version-'));
  for (const rel of ['package.json', 'CITATION.cff', 'CHANGELOG.md', 'registry/harnesses.json']) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    cpSync(join(ROOT, rel), join(root, rel));
  }
  mkdirSync(join(root, 'docs'), { recursive: true });
  cpSync(join(ROOT, 'docs', 'jsonld.jsonld'), join(root, 'docs', 'jsonld.jsonld'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const registry = JSON.parse(readFileSync(join(root, 'registry', 'harnesses.json'), 'utf8'));
  const manifest = { kit: pkg.name, kitVersion: '0.0.0', registryVersion: registry.registryVersion, files: {} };
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return root;
}

test('nextVersion bumps each level and accepts an explicit version', () => {
  assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(nextVersion('1.2.3', '9.9.9'), '9.9.9');
  assert.throws(() => nextVersion('1.2.3', 'nope'));
});

test('tagProblem flags a version without a matching tag', () => {
  assert.match(tagProblem('0.9.0', []), /no git tag v0\.9\.0/);
  assert.equal(tagProblem('0.9.0', ['v0.9.0']), null);
});

test('surfaceProblems catches drift and applySync repairs it', () => {
  const root = fixture();
  try {
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    assert.ok(surfaceProblems(root).length > 0, 'a stale manifest must be reported');
    assert.ok(applySync(root).includes('manifest.json'));
    assert.deepEqual(surfaceProblems(root), []);
    assert.deepEqual(applySync(root), [], 'applySync must be idempotent');
    assert.equal(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).kitVersion, version);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('surfaceProblems detects a hand-edited CITATION after sync', () => {
  const root = fixture();
  try {
    applySync(root);
    const citation = readFileSync(join(root, 'CITATION.cff'), 'utf8');
    writeFileSync(join(root, 'CITATION.cff'), citation.replace(/^version:.*$/m, 'version: "0.0.1"'), 'utf8');
    assert.match(surfaceProblems(root).join('\n'), /CITATION\.cff version 0\.0\.1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
