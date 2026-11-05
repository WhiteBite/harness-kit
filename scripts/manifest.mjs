#!/usr/bin/env node
/** Emits manifest.json: EOL-normalized sha256 of every vendored file. Deterministic - the same tree always produces the same manifest, so consumer sync-checks stay stable. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeManifest } from '../src/manifest.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(ROOT, 'registry', 'harnesses.json'), 'utf8'));

const files = computeManifest(ROOT);
const manifest = {
  kit: pkg.name,
  kitVersion: pkg.version,
  registryVersion: registry.registryVersion,
  files,
};
writeFileSync(join(ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`manifest.json: ${Object.keys(files).length} files, kit ${manifest.kitVersion}, registry ${manifest.registryVersion}`);
