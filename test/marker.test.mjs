import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { writeMarkerBlock } from '../src/marker.mjs';

function temp() {
  return mkdtempSync(join(tmpdir(), 'hk-marker-'));
}

const SHELL_BLOCK = '# >>> slop-gate >>>\nif [ ! -f scan.mjs ]; then exit 2; fi\nnode scan.mjs --staged\n# <<< slop-gate <<<\n';
const HTML_OPEN = '<!-- >>> stop-ai-slop >>> -->';
const HTML_CLOSE = '<!-- <<< stop-ai-slop <<< -->';
const HTML_BLOCK = `${HTML_OPEN}\n# stop-ai-slop\n\npolicy body\n${HTML_CLOSE}`;

test('shell-block: creates the file with a shebang, appends when absent, replaces in place', () => {
  const dir = temp();
  try {
    const path = join(dir, 'nested', '.git', 'hooks', 'pre-commit');
    const created = writeMarkerBlock(path, SHELL_BLOCK, { variant: 'shell-block', id: 'slop-gate' });
    assert.equal(created.action, 'created');
    assert.equal(readFileSync(path, 'utf8'), `#!/bin/sh\n${SHELL_BLOCK}`);
    assert.equal(existsSync(dirname(path)), true, 'mkdir must be recursive');

    const appended = writeMarkerBlock(path, SHELL_BLOCK, { variant: 'shell-block', id: 'slop-gate' });
    assert.equal(appended.action, 'unchanged', 'rewriting identical bytes is a no-op');

    const seeded = join(dir, 'pre-commit-foreign');
    writeFileSync(seeded, '#!/bin/sh\necho existing\n');
    const append = writeMarkerBlock(seeded, SHELL_BLOCK, { variant: 'shell-block', id: 'slop-gate' });
    assert.equal(append.action, 'appended');
    assert.equal(readFileSync(seeded, 'utf8'), `#!/bin/sh\necho existing\n${SHELL_BLOCK}`);

    const replaced = join(dir, 'pre-commit-replace');
    writeFileSync(replaced, `#!/bin/sh\necho before\n# >>> slop-gate >>>\nOLD\n# <<< slop-gate <<<\necho after\n`);
    const result = writeMarkerBlock(replaced, SHELL_BLOCK, { variant: 'shell-block', id: 'slop-gate' });
    assert.equal(result.action, 'replaced');
    assert.equal(readFileSync(replaced, 'utf8'), `#!/bin/sh\necho before\n${SHELL_BLOCK}echo after\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell-block: identical bytes leave mtime untouched', () => {
  const dir = temp();
  try {
    const path = join(dir, 'pre-commit');
    writeMarkerBlock(path, SHELL_BLOCK, { variant: 'shell-block', id: 'slop-gate' });
    utimesSync(path, new Date(1_000_000_000_000), new Date(1_000_000_000_000));
    const stamp = statSync(path).mtimeMs;
    const result = writeMarkerBlock(path, SHELL_BLOCK, { variant: 'shell-block', id: 'slop-gate' });
    assert.equal(result.action, 'unchanged');
    assert.equal(statSync(path).mtimeMs, stamp, 'unchanged writes must not touch the file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell-block: executable mode is applied on posix', { skip: process.platform === 'win32' ? 'chmod semantics differ on Windows' : false }, () => {
  const dir = temp();
  try {
    const path = join(dir, 'pre-commit');
    writeMarkerBlock(path, SHELL_BLOCK, { variant: 'shell-block', id: 'slop-gate' });
    assert.equal(statSync(path).mode & 0o777, 0o755);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('html-block: creates, appends, replaces the token span, and tolerates inverted tokens', () => {
  const dir = temp();
  try {
    const path = join(dir, 'copilot-instructions.md');
    const created = writeMarkerBlock(path, HTML_BLOCK, { variant: 'html-block', id: 'stop-ai-slop' });
    assert.equal(created.action, 'created');
    assert.equal(readFileSync(path, 'utf8'), `${HTML_BLOCK}\n`);

    const appended = writeMarkerBlock(path, HTML_BLOCK, { variant: 'html-block', id: 'stop-ai-slop' });
    assert.equal(appended.action, 'unchanged');

    const foreign = join(dir, 'append.md');
    writeFileSync(foreign, 'head');
    const append = writeMarkerBlock(foreign, HTML_BLOCK, { variant: 'html-block', id: 'stop-ai-slop' });
    assert.equal(append.action, 'appended');
    assert.equal(readFileSync(foreign, 'utf8'), `head\n\n${HTML_BLOCK}`);

    const inverted = join(dir, 'inverted.md');
    writeFileSync(inverted, `${HTML_CLOSE}\nstuff\n${HTML_OPEN}`);
    const fallback = writeMarkerBlock(inverted, HTML_BLOCK, { variant: 'html-block', id: 'stop-ai-slop' });
    assert.equal(fallback.action, 'appended', 'close before open is not a valid block');

    const replacePath = join(dir, 'replace.md');
    writeFileSync(replacePath, `head\n${HTML_OPEN}\nOLD\n${HTML_CLOSE}\ntail\n`);
    const replaced = writeMarkerBlock(replacePath, HTML_BLOCK, { variant: 'html-block', id: 'stop-ai-slop' });
    assert.equal(replaced.action, 'replaced');
    assert.equal(readFileSync(replacePath, 'utf8'), `head\n${HTML_BLOCK}\ntail\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first-line-marker: creates, replaces its own file, skips foreign first lines, no-ops identical', () => {
  const dir = temp();
  try {
    const marker = 'Generated by stop-ai-slop';
    const path = join(dir, 'CONVENTIONS.md');
    const content = `${marker}\n\nrules body\n`;
    const created = writeMarkerBlock(path, content, { variant: 'first-line-marker', marker });
    assert.equal(created.action, 'created');
    assert.equal(readFileSync(path, 'utf8'), content);

    const unchanged = writeMarkerBlock(path, content, { variant: 'first-line-marker', marker });
    assert.equal(unchanged.action, 'unchanged');

    const next = `${marker}\n\nnew body\n`;
    const replaced = writeMarkerBlock(path, next, { variant: 'first-line-marker', marker });
    assert.equal(replaced.action, 'replaced');
    assert.equal(readFileSync(path, 'utf8'), next);

    const foreignPath = join(dir, 'foreign.md');
    writeFileSync(foreignPath, 'Handwritten policy\n');
    const skipped = writeMarkerBlock(foreignPath, content, { variant: 'first-line-marker', marker });
    assert.equal(skipped.action, 'skipped-foreign');
    assert.equal(readFileSync(foreignPath, 'utf8'), 'Handwritten policy\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mdc-frontmatter: assembles ordered fields and body, overwrites its own path', () => {
  const dir = temp();
  try {
    const path = join(dir, 'rules', 'stop-ai-slop.mdc');
    const fields = [
      ['description', 'stop-ai-slop: one-line WHY comments'],
      ['globs', '"**/*"'],
      ['alwaysApply', 'true'],
    ];
    const body = '# stop-ai-slop\n';
    const created = writeMarkerBlock(path, '', { variant: 'mdc-frontmatter', fields, body });
    assert.equal(created.action, 'created');
    assert.equal(
      readFileSync(path, 'utf8'),
      '---\ndescription: stop-ai-slop: one-line WHY comments\nglobs: "**/*"\nalwaysApply: true\n---\n\n# stop-ai-slop\n',
    );

    const unchanged = writeMarkerBlock(path, '', { variant: 'mdc-frontmatter', fields, body });
    assert.equal(unchanged.action, 'unchanged');

    const replaced = writeMarkerBlock(path, '', { variant: 'mdc-frontmatter', fields, body: '# changed\n' });
    assert.equal(replaced.action, 'replaced');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validation: each variant rejects a missing discriminator', () => {
  const dir = temp();
  try {
    const path = join(dir, 'x');
    assert.throws(() => writeMarkerBlock(path, SHELL_BLOCK, { variant: 'shell-block' }), /id/);
    assert.throws(() => writeMarkerBlock(path, HTML_BLOCK, { variant: 'html-block' }), /id/);
    assert.throws(() => writeMarkerBlock(path, 'x', { variant: 'first-line-marker' }), /marker/);
    assert.throws(() => writeMarkerBlock(path, '', { variant: 'mdc-frontmatter', fields: [] }), /body/);
    assert.throws(() => writeMarkerBlock(path, 'x', { variant: 'nope' }), /variant/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});