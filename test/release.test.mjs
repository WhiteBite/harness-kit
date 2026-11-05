import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const VENDORED_DIRS = ['src', 'registry', 'types'];
const normalize = (text) => text.replace(/\r\n/g, '\n');

function walk(dir, out) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function computedHashes() {
  const files = {};
  for (const dir of VENDORED_DIRS) {
    for (const file of walk(join(ROOT, dir), [])) {
      const rel = relative(ROOT, file).split('\\').join('/');
      files[rel] = createHash('sha256').update(normalize(readFileSync(file, 'utf8'))).digest('hex');
    }
  }
  return files;
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

test('manifest.json matches the current tree (run npm run manifest after changing src/registry/types)', () => {
  assert.deepEqual(manifest.files, computedHashes(), 'manifest.json is stale; run `npm run manifest`');
});

test('every version surface agrees', () => {
  const citation = readFileSync(join(ROOT, 'CITATION.cff'), 'utf8').match(/^version:\s*"?([^"\n]+)"?/m)[1].trim();
  const jsonld = JSON.parse(readFileSync(join(ROOT, 'docs', 'jsonld.jsonld'), 'utf8')).softwareVersion;
  const registry = JSON.parse(readFileSync(join(ROOT, 'registry', 'harnesses.json'), 'utf8'));
  assert.equal(manifest.kitVersion, pkg.version, 'manifest kitVersion != package version');
  assert.equal(citation, pkg.version, 'CITATION.cff version != package version');
  assert.equal(jsonld, pkg.version, 'jsonld softwareVersion != package version');
  assert.equal(manifest.registryVersion, registry.registryVersion, 'manifest registryVersion != registry');
});

test('the published tarball ships manifest.json, CHANGELOG.md and docs/', () => {
  for (const required of ['manifest.json', 'CHANGELOG.md', 'docs']) {
    assert.ok(pkg.files.includes(required), `package.json files must include ${required}`);
  }
});
