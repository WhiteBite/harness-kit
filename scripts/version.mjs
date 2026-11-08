#!/usr/bin/env node
/** One source of the release version: package.json drives CITATION.cff, jsonld and manifest.json; `check` gates drift and `tag` gates a forgotten release. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeManifest } from '../src/manifest.mjs';

const DEFAULT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = 'package.json';
const CITATION = 'CITATION.cff';
const JSONLD = 'docs/jsonld.jsonld';
const MANIFEST = 'manifest.json';
const REGISTRY = 'registry/harnesses.json';
const CHANGELOG = 'CHANGELOG.md';
const SURFACES = [PKG, CITATION, JSONLD, REGISTRY, MANIFEST, CHANGELOG];

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

function readText(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function hasSection(text, version) {
  return new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}\\b`, 'm').test(text);
}

export function nextVersion(version, level) {
  if (/^\d+\.\d+\.\d+$/.test(level)) return level;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`current version ${JSON.stringify(version)} is not semver`);
  let [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (level === 'major') [major, minor, patch] = [major + 1, 0, 0];
  else if (level === 'minor') [minor, patch] = [minor + 1, 0];
  else if (level === 'patch') patch += 1;
  else throw new Error(`unknown bump level ${JSON.stringify(level)} (major | minor | patch | X.Y.Z)`);
  return `${major}.${minor}.${patch}`;
}

export function tagProblem(version, tags) {
  return tags.includes(`v${version}`) ? null : `package version ${version} has no git tag v${version} - run "npm run release"`;
}

export function surfaceProblems(root) {
  const problems = [];
  const version = readJson(root, PKG).version;
  const citation = readText(root, CITATION).match(/^version: *"?([^"\n]+)"?/m);
  const citationVersion = citation ? citation[1].trim() : null;
  const jsonld = readJson(root, JSONLD).softwareVersion;
  const manifest = readJson(root, MANIFEST);
  const registry = readJson(root, REGISTRY);
  if (citationVersion !== version) problems.push(`CITATION.cff version ${citationVersion} != package ${version} (run npm run version:sync)`);
  if (jsonld !== version) problems.push(`jsonld softwareVersion ${jsonld} != package ${version} (run npm run version:sync)`);
  if (manifest.kitVersion !== version) problems.push(`manifest kitVersion ${manifest.kitVersion} != package ${version} (run npm run version:sync)`);
  if (registry.registryVersion !== version) problems.push(`registry registryVersion ${registry.registryVersion} != package ${version} (run npm run version:sync)`);
  if (manifest.registryVersion !== version) problems.push(`manifest registryVersion ${manifest.registryVersion} != package ${version} (run npm run version:sync)`);
  if (!hasSection(readText(root, CHANGELOG), version)) problems.push(`CHANGELOG.md has no "## ${version}" section`);
  return problems;
}

export function applySync(root) {
  const version = readJson(root, PKG).version;
  const changed = [];

  const citationPath = join(root, CITATION);
  const citation = readFileSync(citationPath, 'utf8');
  const nextCitation = citation.replace(/^version: *"?[^"\n]+"?/m, `version: "${version}"`);
  if (nextCitation !== citation) {
    writeFileSync(citationPath, nextCitation, 'utf8');
    changed.push(CITATION);
  }

  const jsonldPath = join(root, JSONLD);
  const jsonldText = readFileSync(jsonldPath, 'utf8');
  const nextJsonld = jsonldText.replace(/^(\s*"softwareVersion": ")[^"]+(")/m, `$1${version}$2`);
  if (nextJsonld !== jsonldText) {
    writeFileSync(jsonldPath, nextJsonld, 'utf8');
    changed.push(JSONLD);
  } else if (JSON.parse(jsonldText).softwareVersion !== version) {
    throw new Error('sync: docs/jsonld.jsonld has no top-level "softwareVersion" line');
  }

  const registryText = readText(root, REGISTRY);
  const nextRegistry = registryText.replace(/^(\s*"registryVersion": ")[^"]+(")/m, `$1${version}$2`);
  if (nextRegistry !== registryText) {
    writeFileSync(join(root, REGISTRY), nextRegistry, 'utf8');
    changed.push(REGISTRY);
  }

  const manifestPath = join(root, MANIFEST);
  const manifest = { kit: readJson(root, PKG).name, kitVersion: version, registryVersion: version, files: computeManifest(root) };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== serialized) {
    writeFileSync(manifestPath, serialized, 'utf8');
    changed.push(MANIFEST);
  }

  const changelogPath = join(root, CHANGELOG);
  const changelog = readFileSync(changelogPath, 'utf8');
  if (!hasSection(changelog, version)) {
    const anchor = changelog.indexOf('\n## ');
    const next = anchor === -1
      ? `${changelog.replace(/\n*$/, '\n')}\n## ${version}\n\n- \n`
      : `${changelog.slice(0, anchor + 1)}## ${version}\n\n- \n\n${changelog.slice(anchor + 1)}`;
    writeFileSync(changelogPath, next, 'utf8');
    changed.push(CHANGELOG);
  }

  return changed;
}

function gitTags(root) {
  return execFileSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
}

function git(root, args, { inherit = false } = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe' });
}

function cmdSync(root) {
  const changed = applySync(root);
  console.log(changed.length === 0 ? 'version:sync: already in sync' : `version:sync: updated ${changed.join(', ')}`);
  return 0;
}

function cmdCheck(root) {
  const problems = surfaceProblems(root);
  if (problems.length > 0) {
    console.error('version:check failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log('version:check: all surfaces agree');
  return 0;
}

export function cmdBump(root, level) {
  const pkg = readJson(root, PKG);
  const next = nextVersion(pkg.version, level);
  const pkgText = readText(root, PKG);
  const versionLine = /^(\s*"version": ")[^"]+(")/m;
  if (!versionLine.test(pkgText)) throw new Error('bump: package.json has no top-level "version" line');
  writeFileSync(join(root, PKG), pkgText.replace(versionLine, `$1${next}$2`), 'utf8');
  applySync(root);
  console.log(`version:bump: ${level} -> ${next}`);
  return 0;
}

function cmdTag(root) {
  const version = readJson(root, PKG).version;
  const problem = tagProblem(version, gitTags(root));
  if (problem) {
    console.error(`version:tag: ${problem}`);
    return 1;
  }
  console.log(`version:tag: v${version} exists`);
  return 0;
}

function assertVendorTreeClean(root) {
  const dirty = git(root, ['status', '--porcelain', '--', 'src', 'registry', 'types']).trim();
  if (dirty) throw new Error(`release: refusing to release with uncommitted vendored files (manifest.json hashes the tree):\n${dirty}`);
}

export function cmdRelease(root, level, { push = false } = {}) {
  assertVendorTreeClean(root);
  if (level) cmdBump(root, level);
  applySync(root);
  const version = readJson(root, PKG).version;
  const tag = `v${version}`;

  git(root, ['add', ...SURFACES]);
  let dirty = true;
  try {
    git(root, ['diff', '--cached', '--quiet']);
    dirty = false;
  } catch {
    dirty = true;
  }
  if (dirty) git(root, ['commit', '-m', `chore: release ${version}`], { inherit: true });
  else console.log('version:release: nothing to commit');

  if (gitTags(root).includes(tag)) throw new Error(`release: tag ${tag} already exists; delete it explicitly to re-release`);
  git(root, ['tag', '-a', tag, '-m', `harness-kit ${version}`], { inherit: true });
  console.log(`version:release: ${version} committed and tagged ${tag}`);

  if (push) {
    git(root, ['push', '--follow-tags'], { inherit: true });
  } else {
    console.log('version:release: push with `git push --follow-tags` (or --push) to trigger publishing');
  }
  return 0;
}

const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const root = process.env.HARNESS_KIT_ROOT ? resolve(process.env.HARNESS_KIT_ROOT) : DEFAULT_ROOT;
  const args = process.argv.slice(2);
  const command = args[0] || 'check';
  const positional = args.slice(1).filter((arg) => !arg.startsWith('--'));
  const flags = new Set(args.filter((arg) => arg.startsWith('--')));

  const COMMANDS = {
    sync: () => cmdSync(root),
    check: () => cmdCheck(root),
    bump: () => cmdBump(root, positional[0] || 'patch'),
    tag: () => cmdTag(root),
    release: () => cmdRelease(root, positional[0], { push: flags.has('--push') }),
  };

  let code = 1;
  try {
    if (Object.hasOwn(COMMANDS, command)) code = COMMANDS[command]();
    else console.error(`version: unknown command ${JSON.stringify(command)} (sync | check | bump | tag | release)`);
  } catch (error) {
    console.error(`version: ${error.message}`);
    code = 1;
  }
  process.exit(code);
}
