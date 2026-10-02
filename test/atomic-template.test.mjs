import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic, readJsonConfig, ConfigParseError } from '../src/atomic.mjs';
import { renderTemplate } from '../src/template.mjs';

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
    const backup = readFileSync(join(dir, 'config.json.bak'), 'utf8');
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
  const windowsCommand = 'bun "C:\\tools\\dejavu-gates\\src\\cli.ts" pre --harness codex';
  const rendered = renderTemplate('{"hooks":{"PreToolUse":[{"command":"{{CLI}}"}]}}', { CLI: windowsCommand });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.hooks.PreToolUse[0].command, windowsCommand, 'backslashes and quotes must survive the round trip');
});

test('renderTemplate leaves unknown placeholders untouched and is idempotent on plain text', () => {
  assert.equal(renderTemplate('no vars here', { CLI: 'x' }), 'no vars here');
  assert.equal(renderTemplate('{{UNKNOWN}}', {}), '{{UNKNOWN}}');
});
