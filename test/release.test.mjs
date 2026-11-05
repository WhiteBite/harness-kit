import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeManifest } from '../src/manifest.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

test('manifest.json matches the current tree (run npm run manifest after changing src/registry/types)', () => {
  assert.deepEqual(manifest.files, computeManifest(ROOT), 'manifest.json is stale; run `npm run manifest`');
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
