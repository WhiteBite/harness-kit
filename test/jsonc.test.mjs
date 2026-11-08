import test from 'node:test';
import assert from 'node:assert/strict';
import { scanJsonc, parseJsonc, mergeJsoncContainer } from '../src/jsonc.mjs';

const isMine = (name) => name === 'mine';
const TEMPLATE = { mine: { command: 'npx', args: ['-y', 'mine-server'] } };
const FOREIGN = { command: 'npx', args: ['-y', 'foreign'] };

const types = (text) => scanJsonc(text).map((token) => token.type);

test('scanJsonc does not treat // inside a string as a comment', () => {
  assert.deepEqual(types('{"a":"//x"}'), ['punct', 'string', 'punct', 'string', 'punct']);
});

test('scanJsonc does not treat /* inside a string as a comment', () => {
  assert.deepEqual(types('{"a":"/*x*/"}'), ['punct', 'string', 'punct', 'string', 'punct']);
});

test('scanJsonc handles an escaped quote inside a string', () => {
  assert.deepEqual(types('{"a":"x\\"y"}'), ['punct', 'string', 'punct', 'string', 'punct']);
});

test('scanJsonc handles an escaped backslash before the closing quote', () => {
  assert.deepEqual(types('{"a":"c:\\\\"}'), ['punct', 'string', 'punct', 'string', 'punct']);
});

test('scanJsonc handles a \\u0022 escape inside a string', () => {
  assert.deepEqual(types('{"a":"\\u0022"}'), ['punct', 'string', 'punct', 'string', 'punct']);
});

test('parseJsonc strips comments and trailing commas', () => {
  assert.deepEqual(parseJsonc('{\n  // c\n  "a": 1,\n  /* b */ "x": [1, 2,],\n}'), { a: 1, x: [1, 2] });
});

test('an empty file gets the container created', () => {
  const result = mergeJsoncContainer('', TEMPLATE, { container: 'mcp', isMine });
  assert.equal(result.changed, true);
  assert.deepEqual(parseJsonc(result.text), { mcp: TEMPLATE });
});

test('a whitespace-only file gets the container created', () => {
  const result = mergeJsoncContainer('\n  \n', TEMPLATE, { container: 'mcp', isMine });
  assert.deepEqual(parseJsonc(result.text), { mcp: TEMPLATE });
});

test('an absent container is inserted and foreign keys survive', () => {
  const src = '{\n  "other": true\n}';
  const result = mergeJsoncContainer(src, TEMPLATE, { container: 'mcp', isMine });
  assert.deepEqual(parseJsonc(result.text), { other: true, mcp: TEMPLATE });
});

test('a foreign server survives, the caller server is stripped then re-added, reinstall is byte-identical', () => {
  const src = '{\n  "mcp": {\n    "foreign": {"command":"npx","args":["-y","foreign"]},\n    "mine": {"command":"npx","args":["-y","old"]}\n  }\n}';
  const result = mergeJsoncContainer(src, TEMPLATE, { container: 'mcp', isMine });
  const parsed = parseJsonc(result.text);
  assert.deepEqual(parsed.mcp.foreign, FOREIGN);
  assert.deepEqual(parsed.mcp.mine, TEMPLATE.mine);

  const reinstall = mergeJsoncContainer(result.text, TEMPLATE, { container: 'mcp', isMine });
  assert.equal(reinstall.changed, false);
  assert.equal(reinstall.text, result.text);
});

test('an empty template uninstalls only the caller server', () => {
  const src = '{\n  "mcp": {\n    "foreign": {"command":"npx","args":["-y","foreign"]},\n    "mine": {"command":"npx","args":["-y","old"]}\n  }\n}';
  const result = mergeJsoncContainer(src, {}, { container: 'mcp', isMine });
  assert.deepEqual(parseJsonc(result.text).mcp, { foreign: FOREIGN });
});

test('an empty template deletes an emptied container', () => {
  const src = '{\n  "mcp": {\n    "mine": {"command":"x"}\n  }\n}';
  const result = mergeJsoncContainer(src, {}, { container: 'mcp', isMine });
  assert.equal('mcp' in parseJsonc(result.text), false);
});

test('a non-object container is rejected', () => {
  assert.throws(() => mergeJsoncContainer('{"mcp": []}', TEMPLATE, { container: 'mcp', isMine }), /server map/);
  assert.throws(() => mergeJsoncContainer('{"mcp": 5}', TEMPLATE, { container: 'mcp', isMine }), /server map/);
  assert.throws(() => mergeJsoncContainer('{"mcp": null}', TEMPLATE, { container: 'mcp', isMine }), /server map/);
});

test('a missing isMine or an invalid container is rejected', () => {
  assert.throws(() => mergeJsoncContainer('{}', TEMPLATE, { container: 'mcp' }), /isMine/);
  assert.throws(() => mergeJsoncContainer('{}', TEMPLATE, { isMine }), /container/);
  assert.throws(() => mergeJsoncContainer('{}', TEMPLATE, { container: '', isMine }), /container/);
});

test('a /* inside a string value survives', () => {
  const src = '{\n  "mcp": {\n    "foreign": {"url":"http://x/*y*/"},\n    "mine": {}\n  }\n}';
  const result = mergeJsoncContainer(src, TEMPLATE, { container: 'mcp', isMine });
  assert.equal(result.text.includes('http://x/*y*/'), true);
});

test('a line comment containing braces, brackets and quotes survives', () => {
  const src = '{\n  // keep { this } and [that] and "q"\n  "mcp": {\n    "mine": {}\n  }\n}';
  const result = mergeJsoncContainer(src, TEMPLATE, { container: 'mcp', isMine });
  assert.equal(result.text.includes('// keep { this } and [that] and "q"'), true);
});

test('a block comment containing // survives', () => {
  const src = '{\n  /* keep // this */\n  "mcp": {\n    "mine": {}\n  }\n}';
  const result = mergeJsoncContainer(src, TEMPLATE, { container: 'mcp', isMine });
  assert.equal(result.text.includes('/* keep // this */'), true);
});

test('an unterminated block comment is rejected', () => {
  assert.throws(() => mergeJsoncContainer('{\n  /* open\n  "mcp": {}\n}', TEMPLATE, { container: 'mcp', isMine }), /unterminated/);
});

test('an unterminated string is rejected', () => {
  assert.throws(() => mergeJsoncContainer('{"a":"open}', TEMPLATE, { container: 'mcp', isMine }), /unterminated/);
});

test('a trailing comma in the container object is tolerated', () => {
  const src = '{\n  "mcp": {\n    "mine": {"command":"old"},\n  }\n}';
  const result = mergeJsoncContainer(src, TEMPLATE, { container: 'mcp', isMine });
  assert.deepEqual(parseJsonc(result.text).mcp.mine, TEMPLATE.mine);
});

test('CRLF line endings are preserved', () => {
  const src = '{\r\n  "mcp": {\r\n    "mine": {}\r\n  }\r\n}\r\n';
  const result = mergeJsoncContainer(src, { mine: { v: 1 }, mine2: { command: 'npx', args: ['a'] } }, { container: 'mcp', isMine: (name) => name === 'mine' });
  assert.equal(result.text.includes('\r\n'), true);
  assert.equal(/(?<!\r)\n/.test(result.text), false, 'inserted multi-line values must stay CRLF throughout');
  assert.deepEqual(parseJsonc(result.text).mcp.mine2, { command: 'npx', args: ['a'] });
});

test('a leading BOM is preserved', () => {
  const src = '\uFEFF{\n  "mcp": {\n    "mine": {}\n  }\n}';
  const result = mergeJsoncContainer(src, { mine: { v: 2 } }, { container: 'mcp', isMine });
  assert.equal(result.text.charCodeAt(0), 0xFEFF);
});

test('a file without a trailing newline keeps it that way', () => {
  const src = '{\n  "mcp": {\n    "mine": {}\n  }\n}';
  const result = mergeJsoncContainer(src, { mine: { v: 2 } }, { container: 'mcp', isMine });
  assert.equal(result.text.endsWith('}'), true);
});

test('a duplicate container key is rejected', () => {
  assert.throws(() => mergeJsoncContainer('{"mcp": {}, "mcp": {}}', TEMPLATE, { container: 'mcp', isMine }), /duplicate/);
});

test('a nested container name does not match the top level', () => {
  const src = '{\n  "other": {"mcp": {"x": {}}}\n}';
  const result = mergeJsoncContainer(src, TEMPLATE, { container: 'mcp', isMine });
  const parsed = parseJsonc(result.text);
  assert.deepEqual(parsed.mcp, TEMPLATE);
  assert.deepEqual(parsed.other.mcp, { x: {} });
});

test('a comment between the key and the colon is tolerated', () => {
  const src = '{\n  "mcp" /* c */ : {\n    "mine": {}\n  }\n}';
  const result = mergeJsoncContainer(src, TEMPLATE, { container: 'mcp', isMine });
  assert.deepEqual(parseJsonc(result.text).mcp.mine, TEMPLATE.mine);
});

test('a literal amp.mcpServers key is not split on the dot', () => {
  const src = '{\n  "amp.mcpServers": {\n    "mine": {}\n  }\n}';
  const result = mergeJsoncContainer(src, { mine: { command: 'x' } }, { container: 'amp.mcpServers', isMine });
  assert.deepEqual(parseJsonc(result.text)['amp.mcpServers'].mine, { command: 'x' });
});

test('single-quoted strings are rejected', () => {
  assert.throws(() => mergeJsoncContainer("{'a': 1}", TEMPLATE, { container: 'mcp', isMine }));
});

test('every byte outside the container region is unchanged', () => {
  const src = '{\n  "keep": 1,\n  /* c */\n  "mcp": {\n    "mine": {}\n  },\n  "tail": 2\n}\n';
  const result = mergeJsoncContainer(src, TEMPLATE, { container: 'mcp', isMine });
  assert.equal(result.text.slice(0, result.text.indexOf('"mcp"')), src.slice(0, src.indexOf('"mcp"')));
  assert.equal(result.text.endsWith('  "tail": 2\n}\n'), true);
  assert.deepEqual(parseJsonc(result.text).keep, 1);
  assert.deepEqual(parseJsonc(result.text).tail, 2);
});

test('merging twice is idempotent', () => {
  const src = '{\n  "keep": 1,\n  "mcp": {\n    "foreign": {},\n    "mine": {}\n  }\n}';
  const once = mergeJsoncContainer(src, TEMPLATE, { container: 'mcp', isMine });
  const twice = mergeJsoncContainer(once.text, TEMPLATE, { container: 'mcp', isMine });
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test('a no-op merge leaves the text byte-identical', () => {
  const src = '{\n  "mcp": {\n    "foreign": {}\n  }\n}';
  const result = mergeJsoncContainer(src, {}, { container: 'mcp', isMine });
  assert.equal(result.changed, false);
  assert.equal(result.text, src);
});

test('a deep value does not overflow the stack', () => {
  // keep the depth under native JSON.stringify's recursion limit (it overflows near 2k on some engines)
  let value = 0;
  for (let i = 0; i < 200; i += 1) value = { n: value };
  const src = `{\n  "mcp": {\n    "mine": ${JSON.stringify(value)}\n  }\n}`;
  const result = mergeJsoncContainer(src, { mine: { v: 1 } }, { container: 'mcp', isMine });
  assert.deepEqual(parseJsonc(result.text).mcp.mine, { v: 1 }, 'the deep own member must be replaced, not crash');
});
