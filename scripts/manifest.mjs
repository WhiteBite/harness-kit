#!/usr/bin/env node
/** Emits manifest.json: EOL-normalized sha256 of every vendored file. Deterministic - the same tree always produces the same manifest, so consumer sync-checks stay stable. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
const target = join(ROOT, 'manifest.json');

if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== serialized) {
    console.error(`manifest.json is stale: run "npm run manifest" (${Object.keys(files).length} files, kit ${manifest.kitVersion})`);
    process.exit(1);
  }
  console.log(`manifest.json is current: ${Object.keys(files).length} files, kit ${manifest.kitVersion}, registry ${manifest.registryVersion}`);
} else {
  writeFileSync(target, serialized, 'utf8');
  console.log(`manifest.json: ${Object.keys(files).length} files, kit ${manifest.kitVersion}, registry ${manifest.registryVersion}`);
}
