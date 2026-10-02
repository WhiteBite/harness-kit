import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkState, linkDir, unlinkDir } from '../src/symlink.mjs';

function makeSource(dir, name) {
  const source = join(dir, name);
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), `# ${name}\n`);
  return source;
}

test('linkDir links into an existing harness dir, reports already-linked, and unlinks cleanly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-link-'));
  try {
    const source = makeSource(dir, 'my-skill');
    const harnessDir = join(dir, 'home', '.claude');
    mkdirSync(harnessDir, { recursive: true });
    const target = join(harnessDir, 'skills', 'my-skill');

    const first = linkDir(source, target);
    assert.equal(first.action, 'linked');
    assert.equal(first.ok, true);
    assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), '# my-skill\n');
    assert.equal(linkState(target, source), 'linked');

    const second = linkDir(source, target);
    assert.equal(second.action, 'already-linked');

    const removed = unlinkDir(source, target);
    assert.equal(removed.action, 'removed');
    assert.equal(existsSync(target), false);
    assert.equal(unlinkDir(source, target).action, 'already-absent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('linkDir never clobbers manual content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-link-'));
  try {
    const source = makeSource(dir, 'my-skill');
    const harnessDir = join(dir, 'home', '.claude');
    mkdirSync(harnessDir, { recursive: true });
    const target = join(harnessDir, 'skills', 'my-skill');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'HANDWRITTEN.md'), 'precious\n');

    const result = linkDir(source, target);
    assert.equal(result.ok, false);
    assert.match(result.action, /manual/);
    assert.equal(readFileSync(join(target, 'HANDWRITTEN.md'), 'utf8'), 'precious\n');

    const removal = unlinkDir(source, target);
    assert.equal(removal.ok, false);
    assert.equal(existsSync(join(target, 'HANDWRITTEN.md')), true, 'unlink must not touch manual content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('linkDir classifies a link to another source as foreign and skips it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-link-'));
  try {
    const mine = makeSource(dir, 'mine');
    const theirs = makeSource(dir, 'theirs');
    const harnessDir = join(dir, 'home', '.codex');
    mkdirSync(join(harnessDir, 'skills'), { recursive: true });
    const target = join(harnessDir, 'skills', 'shared-name');
    symlinkSync(theirs, target, process.platform === 'win32' ? 'junction' : 'dir');

    assert.equal(linkState(target, mine), 'foreign-link');
    const result = linkDir(mine, target);
    assert.equal(result.ok, false);
    assert.match(result.action, /foreign-link/);
    assert.equal(linkState(target, theirs), 'linked', 'the foreign link still resolves for its real owner');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('linkDir skips when the harness itself is not installed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-link-'));
  try {
    const source = makeSource(dir, 'my-skill');
    const target = join(dir, 'no-home', '.kiro', 'skills', 'my-skill');
    const result = linkDir(source, target);
    assert.equal(result.ok, false);
    assert.match(result.action, /harness not installed/);
    assert.equal(existsSync(join(dir, 'no-home')), false, 'must not create the harness home');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
