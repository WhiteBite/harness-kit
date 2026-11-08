import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applySync, cmdBump, cmdRelease, nextVersion, surfaceProblems, tagProblem } from '../scripts/version.mjs';

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

test('a registryVersion drift is reported and repaired in place', () => {
  const root = fixture();
  try {
    applySync(root);
    const registryPath = join(root, 'registry', 'harnesses.json');
    const original = readFileSync(registryPath, 'utf8');
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    const tampered = original.replace(`"registryVersion": "${version}"`, '"registryVersion": "9.9.9"');
    assert.notEqual(tampered, original, 'the fixture registry must carry the package version');
    writeFileSync(registryPath, tampered, 'utf8');
    assert.match(surfaceProblems(root).join('\n'), /registry registryVersion 9\.9\.9 != package/);
    assert.ok(applySync(root).includes('registry/harnesses.json'));
    assert.equal(readFileSync(registryPath, 'utf8'), original, 'only the registryVersion line may change');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a jsonld softwareVersion drift is repaired in place', () => {
  const root = fixture();
  try {
    applySync(root);
    const jsonldPath = join(root, 'docs', 'jsonld.jsonld');
    const original = readFileSync(jsonldPath, 'utf8');
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    const tampered = original.replace(`"softwareVersion": "${version}"`, '"softwareVersion": "9.9.9"');
    assert.notEqual(tampered, original, 'the fixture jsonld must carry the package version');
    writeFileSync(jsonldPath, tampered, 'utf8');
    assert.match(surfaceProblems(root).join('\n'), /jsonld softwareVersion 9\.9\.9 != package/);
    assert.ok(applySync(root).includes('docs/jsonld.jsonld'));
    assert.equal(readFileSync(jsonldPath, 'utf8'), original, 'only the softwareVersion line may change');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bumping to the current version is a no-op, not an error', () => {
  const root = fixture();
  try {
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    assert.equal(cmdBump(root, version), 0);
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, version);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function gitFixture() {
  const root = fixture();
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('config', 'core.hooksPath', '.no-hooks');
  git('add', '-A');
  git('commit', '-qm', 'base');
  return { root, git };
}

test('release commits every release surface, including the registry', () => {
  const { root, git } = gitFixture();
  try {
    cmdRelease(root, '9.9.9', { push: false });
    const committed = git('show', '--name-only', '--format=', 'HEAD').trim().split(/\r?\n/);
    for (const surface of ['package.json', 'CITATION.cff', 'docs/jsonld.jsonld', 'registry/harnesses.json', 'manifest.json', 'CHANGELOG.md']) {
      assert.ok(committed.includes(surface), `release commit must include ${surface}`);
    }
    assert.equal(git('status', '--porcelain').trim(), '', 'release must leave a clean tree');
    assert.match(git('tag', '--list'), /v9\.9\.9/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release refuses to run with uncommitted vendored files', () => {
  const { root } = gitFixture();
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'scratch.mjs'), 'export const scratch = 1;\n', 'utf8');
    assert.throws(() => cmdRelease(root, '9.9.9', { push: false }), /uncommitted vendored files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
