#!/usr/bin/env node
/** harness-kit CLI: pin, verify, diff and re-vendor a kit copy without any dependency. */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeManifest, hashFile, readManifest } from '../src/manifest.mjs';

const KIT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KIT_NAME = '@whitebite/harness-kit';
const ITEMS = ['src', 'registry', 'types'];
const MANIFEST = 'manifest.json';
const LOCK = 'harness-kit.lock';
const DEFAULT_DIR = 'vendor/harness-kit';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function kitLock() {
  const pkg = readJson(join(KIT_ROOT, 'package.json'));
  const registry = readJson(join(KIT_ROOT, 'registry', 'harnesses.json'));
  return {
    lockVersion: 1,
    kitVersion: pkg.version,
    registryVersion: registry.registryVersion,
    schemaVersion: registry.schemaVersion,
    tag: `v${pkg.version}`,
    files: {
      'registry/harnesses.json': hashFile(join(KIT_ROOT, 'registry', 'harnesses.json')),
      'registry/harnesses.schema.json': hashFile(join(KIT_ROOT, 'registry', 'harnesses.schema.json')),
    },
  };
}

function safeKey(rel) {
  return !rel.split('/').includes('..') && !rel.startsWith('/') && !rel.startsWith('\\');
}

function integrityProblems(target, manifest) {
  const problems = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    if (!safeKey(rel)) {
      problems.push(`unsafe manifest path ${rel}`);
      continue;
    }
    const file = join(target, rel);
    if (!existsSync(file)) problems.push(`missing ${rel}`);
    else if (hashFile(file) !== expected) problems.push(`drifted ${rel}`);
  }
  return problems;
}

function lockProblems(target, manifest, lock) {
  const problems = [];
  if (!lock) return problems;
  for (const [rel, sha] of Object.entries(lock.files || {})) {
    if (!safeKey(rel)) {
      problems.push(`unsafe lock path ${rel}`);
      continue;
    }
    const file = join(target, rel);
    if (!existsSync(file)) problems.push(`lock lists missing ${rel}`);
    else if (hashFile(file) !== sha) problems.push(`lock hash drifted ${rel}`);
  }
  if (lock.kitVersion !== manifest.kitVersion || lock.registryVersion !== manifest.registryVersion) {
    problems.push(`lock ${lock.kitVersion}/${lock.registryVersion} disagrees with manifest ${manifest.kitVersion}/${manifest.registryVersion}`);
  }
  return problems;
}

function cmdVersions() {
  const pkg = readJson(join(KIT_ROOT, 'package.json'));
  const registry = readJson(join(KIT_ROOT, 'registry', 'harnesses.json'));
  console.log(`${pkg.name} ${pkg.version}`);
  console.log(`registry ${registry.registryVersion} (schemaVersion ${registry.schemaVersion})`);
  return 0;
}

function cmdCheck(dir, { strict = false } = {}) {
  const target = resolve(dir);
  const manifest = readManifest(target);
  const problems = [...integrityProblems(target, manifest), ...lockProblems(target, manifest, readLock(target))];
  if (problems.length > 0) {
    console.error(`harness-kit check: ${problems.length} problem(s) in ${target}`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }
  const installed = readJson(join(KIT_ROOT, 'package.json')).version;
  if (manifest.kitVersion !== installed) {
    const message = `harness-kit check: vendored kit ${manifest.kitVersion} is behind installed ${installed}`;
    if (strict) {
      console.error(message);
      return 1;
    }
    console.warn(message);
  }
  console.log(`harness-kit check: ${Object.keys(manifest.files).length} files match manifest (kit ${manifest.kitVersion}, registry ${manifest.registryVersion})`);
  return 0;
}

function writeLock(target) {
  writeFileSync(join(target, LOCK), `${JSON.stringify(kitLock(), null, 2)}\n`, 'utf8');
}

function cmdVendor(dir) {
  const target = resolve(dir);
  if (existsSync(target)) {
    let existing = null;
    try {
      existing = readManifest(target);
    } catch {
      existing = null;
    }
    if (!existing || existing.kit !== KIT_NAME) {
      throw new Error(`refusing to overwrite ${target}: not a harness-kit vendor dir`);
    }
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const item of [...ITEMS, MANIFEST]) {
    const from = join(KIT_ROOT, item);
    if (existsSync(from)) cpSync(from, join(target, item), { recursive: true });
  }
  writeLock(target);
  console.log(`harness-kit vendor: wrote ${target}`);
  return cmdCheck(target);
}

function readLock(target) {
  const path = join(target, LOCK);
  return existsSync(path) ? readJson(path) : null;
}

function cmdDiff(dir) {
  const target = resolve(dir);
  const vendored = readManifest(target);
  const current = computeManifest(KIT_ROOT);
  const installed = readJson(join(KIT_ROOT, 'package.json')).version;
  console.log(`vendored kit ${vendored.kitVersion} (registry ${vendored.registryVersion}) -> installed ${installed}`);
  const keys = [...new Set([...Object.keys(vendored.files), ...Object.keys(current)])].sort();
  let changes = 0;
  for (const key of keys) {
    const before = vendored.files[key];
    const after = current[key];
    if (before === after) continue;
    changes += 1;
    console.log(`${before === undefined ? '+' : after === undefined ? '-' : '~'} ${key}`);
  }
  if (changes === 0) console.log('no file differences');
  return 0;
}

const args = process.argv.slice(2);
const command = args[0] || 'versions';
const positional = args.slice(1).filter((arg) => !arg.startsWith('--'));
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const dir = positional[0] || DEFAULT_DIR;

const COMMANDS = {
  versions: cmdVersions,
  check: () => cmdCheck(dir, { strict: flags.has('--strict') }),
  vendor: () => cmdVendor(dir),
  update: () => cmdVendor(dir),
  diff: () => cmdDiff(dir),
};

let code = 1;
try {
  if (Object.hasOwn(COMMANDS, command)) code = COMMANDS[command]();
  else console.error(`harness-kit: unknown command ${JSON.stringify(command)} (versions | check | vendor | update | diff)`);
} catch (error) {
  console.error(`harness-kit: ${error.message}`);
  code = 1;
}
process.exit(code);
