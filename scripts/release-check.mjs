#!/usr/bin/env node
/** Release-integrity gate: the pushed tag must equal the package version, and the packed artifact must run vendor/check. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const problems = [];

const tag = process.env.GITHUB_REF_NAME || '';
if (tag.startsWith('v') && tag.slice(1) !== pkg.version) {
  problems.push(`tag ${tag} does not match package.json version ${pkg.version}`);
}

const dir = mkdtempSync(join(tmpdir(), 'hk-release-'));
try {
  const out = process.platform === 'win32'
    ? execFileSync(`npm pack --pack-destination "${dir}"`, { cwd: ROOT, encoding: 'utf8', shell: true })
    : execFileSync('npm', ['pack', '--pack-destination', dir], { cwd: ROOT, encoding: 'utf8' });
  const tgz = join(dir, out.trim().split(/\r?\n/).pop());
  execFileSync('tar', ['-xzf', tgz, '-C', dir]);
  const pkgDir = join(dir, 'package');
  for (const required of ['manifest.json', 'bin/harness-kit.mjs', 'registry/harnesses.json']) {
    if (!existsSync(join(pkgDir, required))) problems.push(`published tarball is missing ${required}`);
  }
  if (problems.length === 0) {
    const vendored = join(dir, 'vendor');
    execFileSync(process.execPath, [join(pkgDir, 'bin', 'harness-kit.mjs'), 'vendor', vendored], { encoding: 'utf8' });
    execFileSync(process.execPath, [join(pkgDir, 'bin', 'harness-kit.mjs'), 'check', vendored], { encoding: 'utf8' });
  }
} catch (error) {
  problems.push(`pack/vendor smoke failed: ${error.message}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error('release-check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('release-check: tag/version and the packaged artifact are intact');
