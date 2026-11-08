import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic, readJsonConfig, ConfigParseError } from '../src/atomic.mjs';
import { renderTemplate, renderPath } from '../src/template.mjs';

test('writeJsonAtomic creates an LF file with two-space indent and trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-atomic-'));
  try {
    const path = join(dir, 'config.json');
    writeJsonAtomic(path, { hooks: { PreToolUse: [] } });
    const text = readFileSync(path, 'utf8');
    assert.ok(text.endsWith('\n'));
    assert.ok(!text.includes('\r'));
    assert.deepEqual(JSON.parse(text), { hooks: { PreToolUse: [] } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeJsonAtomic backs up the previous valid content before replacing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-atomic-'));
  try {
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ version: 1, old: true }, null, 2) + '\n');
    writeJsonAtomic(path, { version: 1, old: false });
    const backup = readFileSync(join(dir, 'config.json.harness-kit.bak'), 'utf8');
    assert.deepEqual(JSON.parse(backup), { version: 1, old: true });
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { version: 1, old: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeJsonAtomic refuses to write through a symlink', { skip: process.platform === 'win32' ? 'file symlinks need privileges on Windows' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-atomic-'));
  try {
    const real = join(dir, 'real.json');
    const link = join(dir, 'link.json');
    writeFileSync(real, '{}\n');
    try {
      symlinkSync(real, link);
    } catch {
      return;
    }
    assert.throws(() => writeJsonAtomic(link, { a: 1 }), /symlink/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readJsonConfig: absent is null, malformed aborts with ConfigParseError, non-object aborts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-atomic-'));
  try {
    assert.equal(readJsonConfig(join(dir, 'missing.json')), null);
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{ not json');
    assert.throws(() => readJsonConfig(broken), ConfigParseError);
    const array = join(dir, 'array.json');
    writeFileSync(array, '[]');
    assert.throws(() => readJsonConfig(array), ConfigParseError);
    const ok = join(dir, 'ok.json');
    writeFileSync(ok, '{"a":1}');
    assert.deepEqual(readJsonConfig(ok), { a: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderTemplate substitutes {{VARS}} with full JSON-string escaping', () => {
  const windowsCommand = 'bun "C:\\tools\\cli.ts" pre --harness codex';
  const rendered = renderTemplate('{"hooks":{"PreToolUse":[{"command":"{{CLI}}"}]}}', { CLI: windowsCommand });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.hooks.PreToolUse[0].command, windowsCommand, 'backslashes and quotes must survive the round trip');
});

test('renderTemplate leaves unknown placeholders untouched and is idempotent on plain text', () => {
  assert.equal(renderTemplate('no vars here', { CLI: 'x' }), 'no vars here');
  assert.equal(renderTemplate('{{UNKNOWN}}', {}), '{{UNKNOWN}}');
});

test('renderTemplate leaves prototype-chain keys untouched', () => {
  assert.equal(renderTemplate('{{constructor}}', {}), '{{constructor}}');
  assert.equal(renderTemplate('{{toString}} {{__proto__}}', {}), '{{toString}} {{__proto__}}');
});

test('renderPath expands {placeholders} and passes through paths without any', () => {
  assert.equal(renderPath('.kiro/hooks/{tool}.json', { tool: 'dejavu-gates' }), '.kiro/hooks/dejavu-gates.json');
  assert.equal(renderPath('.github/hooks/{tool}.json', { tool: 'stop-ai-slop' }), '.github/hooks/stop-ai-slop.json');
  assert.equal(renderPath('.claude/settings.json', {}), '.claude/settings.json');
});

test('renderPath throws on any unresolved placeholder instead of writing a literal brace path', () => {
  assert.throws(() => renderPath('.kiro/hooks/{tool}.json', {}), /\{tool\}/);
  assert.throws(() => renderPath('.cursor/rules/{id}.mdc', { tool: 'x' }), /\{id\}/);
  assert.throws(() => renderPath('.devin/rules/{id}.md', { id: '' }), /\{id\}/);
});

test('writeJsonAtomic skips a byte-identical rewrite: no mtime change and no backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-atomic-'));
  try {
    const path = join(dir, 'config.json');
    writeJsonAtomic(path, { a: 1 });
    const before = statSync(path).mtimeMs;
    writeJsonAtomic(path, { a: 1 });
    assert.equal(statSync(path).mtimeMs, before);
    assert.equal(existsSync(join(dir, 'config.json.harness-kit.bak')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeJsonAtomic with backup:false leaves no .bak on a real change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-atomic-'));
  try {
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ version: 1 }, null, 2) + '\n');
    writeJsonAtomic(path, { version: 2 }, { backup: false });
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { version: 2 });
    assert.equal(existsSync(join(dir, 'config.json.harness-kit.bak')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderPath rejects a traversal or separator value', () => {
  assert.throws(() => renderPath('.kiro/hooks/{tool}.json', { tool: '../evil' }), /unsafe/);
  assert.throws(() => renderPath('.kiro/hooks/{tool}.json', { tool: 'a/b' }), /unsafe/);
  assert.throws(() => renderPath('.kiro/hooks/{tool}.json', { tool: '..' }), /unsafe/);
});

test('renderTemplate does not re-substitute inside a value', () => {
  assert.equal(renderTemplate('{{A}}-{{B}}', { A: '{{B}}', B: 'x' }), '{{B}}-x');
});

test('writeJsonAtomic refuses a symlinked parent directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-atomic-'));
  try {
    const realDir = join(dir, 'real');
    mkdirSync(realDir);
    const link = join(dir, 'link');
    try {
      symlinkSync(realDir, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    assert.throws(() => writeJsonAtomic(join(link, 'config.json'), { a: 1 }), /symlink/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
