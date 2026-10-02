#!/usr/bin/env node
/** Emits manifest.json: EOL-normalized sha256 of every vendored file. Deterministic - the same tree always produces the same manifest, so consumer sync-checks stay stable. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(ROOT, 'registry', 'harnesses.json'), 'utf8'));

const VENDORED_DIRS = ['src', 'registry', 'types'];

function walk(dir, out) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = {};
for (const dir of VENDORED_DIRS) {
  let entries = [];
  try {
    entries = walk(join(ROOT, dir), []);
  } catch {
    continue;
  }
  for (const file of entries) {
    const content = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    files[relative(ROOT, file).split('\\').join('/')] = createHash('sha256').update(content).digest('hex');
  }
}

const manifest = {
  kit: pkg.name,
  kitVersion: pkg.version,
  registryVersion: registry.registryVersion,
  files,
};
writeFileSync(join(ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`manifest.json: ${Object.keys(files).length} files, kit ${manifest.kitVersion}, registry ${manifest.registryVersion}`);
