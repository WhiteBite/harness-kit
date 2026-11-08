/** Skill-directory linking with state classification: never clobbers manual content or foreign links. Ported from rdk skill.js with Windows junction-path normalization added. */
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Windows junctions report rooted targets with an extended-length, UNC or object-manager prefix; strip it before comparing (concrete forms are pinned in test/symlink.test.mjs). */
export function normalizeLinkTarget(raw) {
  const value = String(raw);
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice(8)}`;
  if (value.startsWith('\\\\?\\') || value.startsWith('\\??\\')) return value.slice(4);
  return value;
}

function samePath(a, b) {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** absent | linked (ours) | foreign-link (points elsewhere) | manual (real directory or file). */
export function linkState(source, target) {
  let stat = null;
  try {
    stat = lstatSync(target);
  } catch {
    return 'absent';
  }
  if (stat.isSymbolicLink()) {
    let dest = null;
    try {
      dest = resolve(dirname(target), normalizeLinkTarget(readlinkSync(target)));
    } catch {
      dest = null;
    }
    return dest !== null && samePath(dest, source) ? 'linked' : 'foreign-link';
  }
  return 'manual';
}

export function linkDir(source, target) {
  const absolute = resolve(source);
  const state = linkState(absolute, target);
  if (state === 'linked') {
    if (!existsSync(absolute)) return { state, ok: false, action: `skipped (link dangles at a missing source: ${absolute})` };
    return { state, ok: true, action: 'already-linked' };
  }
  if (state === 'manual' || state === 'foreign-link') {
    return { state, ok: false, action: `skipped (${state} content present at ${target})` };
  }
  const parent = dirname(target);
  try {
    if (!existsSync(parent)) {
      if (!existsSync(dirname(parent))) return { state, ok: false, action: 'skipped (harness not installed)' };
      mkdirSync(parent, { recursive: true });
    }
    symlinkSync(absolute, target, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    return { state, ok: false, action: `skipped (${error && error.code ? error.code : 'link failed'})` };
  }
  return { state: 'linked', ok: true, action: 'linked' };
}

export function unlinkDir(source, target) {
  const state = linkState(resolve(source), target);
  if (state === 'absent') return { state, ok: true, action: 'already-absent' };
  if (state !== 'linked') return { state, ok: false, action: `skipped (${state})` };
  rmSync(target, { recursive: true, force: true });
  return { state: 'absent', ok: true, action: 'removed' };
}
