import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeManifest } from '../src/manifest.mjs';
import { surfaceProblems } from '../scripts/version.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

test('manifest.json matches the current tree (run npm run manifest after changing src/registry/types)', () => {
  assert.deepEqual(manifest.files, computeManifest(ROOT), 'manifest.json is stale; run `npm run manifest`');
});

test('every version surface agrees (run npm run version:sync)', () => {
  assert.deepEqual(surfaceProblems(ROOT), []);
});

test('the published tarball ships manifest.json, CHANGELOG.md and docs/', () => {
  for (const required of ['manifest.json', 'CHANGELOG.md', 'docs']) {
    assert.ok(pkg.files.includes(required), `package.json files must include ${required}`);
  }
});
