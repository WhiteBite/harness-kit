#!/usr/bin/env node
/** harness-kit CLI: pin, verify and re-vendor a kit copy without any dependency. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ITEMS = ['src', 'registry', 'types'];
const MANIFEST = 'manifest.json';
const DEFAULT_DIR = 'vendor/harness-kit';

function normalize(text) {
  return text.replace(/\r\n/g, '\n');
}

function hashFile(path) {
  return createHash('sha256').update(normalize(readFileSync(path, 'utf8'))).digest('hex');
}

function readManifest(dir) {
  const path = join(dir, MANIFEST);
  if (!existsSync(path)) throw new Error(`no ${MANIFEST} in ${dir}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function cmdVersions() {
  const pkg = JSON.parse(readFileSync(join(KIT_ROOT, 'package.json'), 'utf8'));
  const registry = JSON.parse(readFileSync(join(KIT_ROOT, 'registry', 'harnesses.json'), 'utf8'));
  console.log(`${pkg.name} ${pkg.version}`);
  console.log(`registry ${registry.registryVersion} (schemaVersion ${registry.schemaVersion})`);
  return 0;
}

function cmdCheck(dir) {
  const target = resolve(dir);
  const manifest = readManifest(target);
  const problems = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const file = join(target, rel);
    if (!existsSync(file)) problems.push(`missing ${rel}`);
    else if (hashFile(file) !== expected) problems.push(`drifted ${rel}`);
  }
  if (problems.length > 0) {
    console.error(`harness-kit check: ${problems.length} problem(s) in ${target}`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }
  const count = Object.keys(manifest.files).length;
  console.log(`harness-kit check: ${count} files match manifest (kit ${manifest.kitVersion}, registry ${manifest.registryVersion})`);
  return 0;
}

function cmdVendor(dir) {
  const target = resolve(dir);
  if (existsSync(target) && !existsSync(join(target, MANIFEST))) {
    throw new Error(`refusing to overwrite ${target}: no ${MANIFEST} (not a harness-kit vendor dir)`);
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const item of [...ITEMS, MANIFEST]) {
    const from = join(KIT_ROOT, item);
    if (existsSync(from)) cpSync(from, join(target, item), { recursive: true });
  }
  console.log(`harness-kit vendor: wrote ${target}`);
  return cmdCheck(target);
}

const [command = 'versions', argument] = process.argv.slice(2);
const COMMANDS = { versions: cmdVersions, check: cmdCheck, vendor: cmdVendor };

let code = 1;
try {
  if (Object.hasOwn(COMMANDS, command)) code = COMMANDS[command](argument || DEFAULT_DIR);
  else console.error(`harness-kit: unknown command ${JSON.stringify(command)} (versions | check | vendor)`);
} catch (error) {
  console.error(`harness-kit: ${error.message}`);
  code = 1;
}
process.exit(code);
