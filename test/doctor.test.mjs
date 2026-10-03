import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkInstall, resolveHooksDir } from '../src/doctor.mjs';
import { extractCliPath } from '../src/drift.mjs';
import { writeMarkerBlock } from '../src/marker.mjs';

const DEJAVU = 'bun "/tools/dejavu-gates/src/cli.ts" pre --harness codex';
const isDejavu = (command) => typeof command === 'string' && command.includes('--harness codex');
const STAGED = /node\s+"([^"]+)"\s+--staged/;

function temp() {
  return mkdtempSync(join(tmpdir(), 'hk-doctor-'));
}

function hookSurface(overrides = {}) {
  return { id: 'codex', kind: 'hook-config', path: '.codex/hooks.json', shape: 'nested-hooks', identify: isDejavu, ...overrides };
}

function markerSurface(overrides = {}) {
  return {
    id: 'git',
    kind: 'marker-block',
    path: 'pre-commit',
    variant: 'shell-block',
    markerId: 'slop-gate',
    extract: (text) => extractCliPath(text, STAGED),
    ...overrides,
  };
}

test('checkInstall hook-config: broken, missing, stale and ok map onto the drift vocabulary', () => {
  const dir = temp();
  try {
    const rel = join(dir, '.codex', 'hooks.json');
    mkdirSync(dirname(rel), { recursive: true });

    writeFileSync(rel, 'not json');
    assert.deepEqual(checkInstall(dir, { surfaces: [hookSurface()] })[0], { surface: 'codex', status: 'broken', detail: null });

    rmSync(rel);
    assert.deepEqual(checkInstall(dir, { surfaces: [hookSurface()] })[0], { surface: 'codex', status: 'missing', detail: null });

    writeFileSync(rel, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'node /foreign.js' }] }] } }));
    assert.deepEqual(checkInstall(dir, { surfaces: [hookSurface()] })[0], { surface: 'codex', status: 'missing', detail: null });

    writeFileSync(rel, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'bun --harness codex now' }] }] } }));
    assert.deepEqual(checkInstall(dir, { surfaces: [hookSurface()] })[0], { surface: 'codex', status: 'stale', detail: null });

    writeFileSync(rel, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: DEJAVU }] }] } }));
    assert.deepEqual(checkInstall(dir, { surfaces: [hookSurface()] })[0], { surface: 'codex', status: 'stale', detail: '/tools/dejavu-gates/src/cli.ts' });

    assert.deepEqual(checkInstall(dir, { surfaces: [hookSurface()], pathExists: () => true })[0], { surface: 'codex', status: 'ok', detail: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkInstall marker-block: absent file, foreign content, block rot and ok', () => {
  const dir = temp();
  try {
    const hookPath = join(dir, 'pre-commit');
    const scanner = join(dir, 'scan.mjs');
    writeFileSync(scanner, '');
    const blockFor = (target) =>
      `# >>> slop-gate >>>\nif [ ! -f "${target}" ]; then\n  exit 2\nfi\nnode "${target}" --staged\n# <<< slop-gate <<<\n`;

    assert.deepEqual(checkInstall(dir, { surfaces: [markerSurface()] })[0], { surface: 'git', status: 'missing', detail: null });

    writeFileSync(hookPath, '#!/bin/sh\necho foreign\n');
    assert.deepEqual(checkInstall(dir, { surfaces: [markerSurface()] })[0], { surface: 'git', status: 'missing', detail: null });

    writeFileSync(hookPath, `#!/bin/sh\n${blockFor(join(dir, 'gone.mjs'))}`);
    assert.deepEqual(checkInstall(dir, { surfaces: [markerSurface()] })[0], { surface: 'git', status: 'stale', detail: join(dir, 'gone.mjs') });

    writeFileSync(hookPath, `#!/bin/sh\n${blockFor(scanner)}`);
    assert.deepEqual(checkInstall(dir, { surfaces: [markerSurface()] })[0], { surface: 'git', status: 'ok', detail: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkInstall marker-block: extraction is scoped to the matched block', () => {
  const dir = temp();
  try {
    const hookPath = join(dir, 'pre-commit');
    writeFileSync(hookPath, `node "${join(dir, 'scan.mjs')}" --staged\n# >>> slop-gate >>>\nexit 0\n# <<< slop-gate <<<\n`);
    assert.deepEqual(checkInstall(dir, { surfaces: [markerSurface()] })[0], { surface: 'git', status: 'stale', detail: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkInstall marker-block: the default extractor stays ts-only over a writer-produced block', () => {
  const dir = temp();
  try {
    const cli = join(dir, 'cli.ts');
    writeFileSync(cli, '');
    writeMarkerBlock(join(dir, 'pre-commit'), `# >>> slop-gate >>>\nbun "${cli}" pre\n# <<< slop-gate <<<\n`, {
      variant: 'shell-block',
      id: 'slop-gate',
    });
    const surface = markerSurface({ extract: undefined });
    assert.deepEqual(checkInstall(dir, { surfaces: [surface] })[0], { surface: 'git', status: 'ok', detail: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkInstall: one finding per surface in order, absolute paths, unknown kinds, empty input', () => {
  const dir = temp();
  try {
    const findings = checkInstall(dir, {
      surfaces: [
        hookSurface({ id: 'a', path: 'missing.json' }),
        hookSurface({ id: 'b', path: join(dir, 'absent.json') }),
        { id: 'c', kind: 'surprise', path: 'x' },
      ],
    });
    assert.deepEqual(findings, [
      { surface: 'a', status: 'missing', detail: null },
      { surface: 'b', status: 'missing', detail: null },
      { surface: 'c', status: 'broken', detail: null },
    ]);
    assert.deepEqual(checkInstall(dir, { surfaces: [] }), []);
    assert.deepEqual(checkInstall(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveHooksDir: null without .git, configured path, empty and failing exec fall back', () => {
  const dir = temp();
  try {
    assert.equal(resolveHooksDir(dir), null, 'no .git means no hooks dir');

    mkdirSync(join(dir, '.git'), { recursive: true });
    assert.equal(resolveHooksDir(dir, { exec: () => '.githooks\n' }), join(dir, '.githooks'));
    assert.equal(resolveHooksDir(dir, { exec: () => '\n' }), join(dir, '.git', 'hooks'));
    assert.equal(resolveHooksDir(dir, { exec: () => { throw new Error('no git'); } }), join(dir, '.git', 'hooks'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveHooksDir: resolves a real git config core.hooksPath', () => {
  const dir = temp();
  try {
    execFileSync('git', ['init', '--quiet', dir]);
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
    assert.equal(resolveHooksDir(dir), join(dir, '.githooks'));
    assert.equal(resolveHooksDir(dir, { exec: () => '' }), join(dir, '.git', 'hooks'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
