import test from 'node:test';
import assert from 'node:assert/strict';
import { scanTomlTables, mergeTomlTable } from '../src/toml.mjs';

const CONTAINER = 'mcp_servers';
const isMine = (name) => name === 'mine';
const opts = { container: CONTAINER, isMine };

test('scanTomlTables reports path and byte extents for each table', () => {
  const text = '[a]\nx = 1\n[a.b]\ny = 2\n';
  const tables = scanTomlTables(text);
  assert.deepEqual(tables.map((t) => t.path), [['a'], ['a', 'b']]);
  assert.equal(tables[0].headerStart, 0);
  assert.equal(tables[0].blockStart, 0);
  assert.equal(tables[0].blockEnd, text.indexOf('[a.b]'));
  assert.equal(tables[1].blockEnd, text.length);
});

test('scanTomlTables parses quoted and literal path segments as single segments', () => {
  const text = '[mcp_servers."a.b"]\nx = 1\n[mcp_servers.\'c.d\']\ny = 2\n';
  const tables = scanTomlTables(text);
  assert.deepEqual(tables[0].path, ['mcp_servers', 'a.b']);
  assert.deepEqual(tables[1].path, ['mcp_servers', 'c.d']);
});

test('foreign scalar keys under the base table survive an owned strip', () => {
  const text = '[mcp_servers]\ntimeout = 5\n\n[mcp_servers.mine]\ncommand = "x"\n';
  const { text: out, changed } = mergeTomlTable(text, {}, opts);
  assert.equal(out, '[mcp_servers]\ntimeout = 5\n\n');
  assert.equal(changed, true);
});

test('an owned [container.NAME] sub-table is replaced by the template block', () => {
  const text = '[mcp_servers.mine]\ncommand = "old"\n';
  const { text: out } = mergeTomlTable(text, { mine: { command: 'new' } }, opts);
  assert.equal(out, '[mcp_servers.mine]\ncommand = "new"\n\n');
});

test('a quoted sub-table name is matched and re-rendered quoted', () => {
  const text = '[mcp_servers."quoted name"]\ncommand = "old"\n';
  const { text: out } = mergeTomlTable(text, { 'quoted name': { command: 'new' } }, { container: CONTAINER, isMine: (n) => n === 'quoted name' });
  assert.equal(out, '[mcp_servers."quoted name"]\ncommand = "new"\n\n');
});

test('a literal sub-table name is matched and re-rendered as a basic string', () => {
  const text = "[mcp_servers.'literal name']\ncommand = \"old\"\n";
  const { text: out } = mergeTomlTable(text, { 'literal name': { command: 'new' } }, { container: CONTAINER, isMine: (n) => n === 'literal name' });
  assert.equal(out, '[mcp_servers."literal name"]\ncommand = "new"\n\n');
});

test('a nested [container.NAME.env] sub-table is stripped together with NAME', () => {
  const text = '[mcp_servers.mine]\ncommand = "x"\n\n[mcp_servers.mine.env]\nFOO = "bar"\n';
  const { text: out, changed } = mergeTomlTable(text, {}, opts);
  assert.equal(out, '');
  assert.equal(changed, true);
});

test('a dotted-key definition of the container is refused', () => {
  assert.throws(() => mergeTomlTable('mcp_servers.mine.command = "x"\n', {}, opts), /dotted-key/);
});

test('a dotted key inside the base table is refused', () => {
  assert.throws(() => mergeTomlTable('[mcp_servers]\nmine.command = "x"\n', {}, opts), /dotted-key/);
});

test('an inline table for the container is refused', () => {
  assert.throws(() => mergeTomlTable('mcp_servers = { mine = { command = "x" } }\n', {}, opts), /inline table/);
});

test('an array-of-tables for the container is refused', () => {
  assert.throws(() => mergeTomlTable('[[mcp_servers]]\ncommand = "x"\n', {}, opts), /array-of-tables/);
});

test('a duplicate sub-table is refused', () => {
  const text = '[mcp_servers.mine]\na = 1\n[mcp_servers.mine]\nb = 2\n';
  assert.throws(() => mergeTomlTable(text, {}, opts), /duplicate/);
});

test('an unterminated multi-line string is refused', () => {
  assert.throws(() => mergeTomlTable('note = """\nunterminated\n', {}, opts), /unterminated/);
});

test('a # comment containing a header is not a table', () => {
  const text = '# [mcp_servers.mine]\nmodel = "gpt"\n';
  assert.deepEqual(scanTomlTables(text), []);
  const { text: out } = mergeTomlTable(text, { mine: { command: 'x' } }, opts);
  assert.equal(out, '# [mcp_servers.mine]\nmodel = "gpt"\n\n[mcp_servers.mine]\ncommand = "x"\n\n');
});

test('a header-looking line inside a multi-line array is not a table', () => {
  const text = 'args = [\n  "[mcp_servers.mine]",\n]\n';
  assert.deepEqual(scanTomlTables(text), []);
});

test('a header-looking line inside a multi-line string is not a table', () => {
  const text = 'note = """\n[mcp_servers.mine]\n"""\n';
  assert.deepEqual(scanTomlTables(text), []);
});

test('CRLF line endings are preserved', () => {
  const text = '[mcp_servers.mine]\r\ncommand = "old"\r\n';
  const { text: out } = mergeTomlTable(text, { mine: { command: 'new' } }, opts);
  assert.equal(out, '[mcp_servers.mine]\r\ncommand = "new"\r\n\r\n');
});

test('a leading BOM is preserved', () => {
  const text = '\uFEFF[mcp_servers.mine]\ncommand = "old"\n';
  const { text: out } = mergeTomlTable(text, { mine: { command: 'new' } }, opts);
  assert.equal(out, '\uFEFF[mcp_servers.mine]\ncommand = "new"\n\n');
});

test('an empty file gets the template appended', () => {
  const { text: out, changed } = mergeTomlTable('', { mine: { command: 'x' } }, opts);
  assert.equal(out, '[mcp_servers.mine]\ncommand = "x"\n\n');
  assert.equal(changed, true);
});

test('a file without the container gets the template appended at EOF', () => {
  const text = 'model = "gpt"\n';
  const { text: out } = mergeTomlTable(text, { mine: { command: 'x' } }, opts);
  assert.equal(out, 'model = "gpt"\n\n[mcp_servers.mine]\ncommand = "x"\n\n');
});

test('a quoted name containing a dot round-trips', () => {
  const text = '[mcp_servers."a.b"]\ncommand = "old"\n';
  const { text: out } = mergeTomlTable(text, { 'a.b': { command: 'new' } }, { container: CONTAINER, isMine: (n) => n === 'a.b' });
  assert.equal(out, '[mcp_servers."a.b"]\ncommand = "new"\n\n');
});

test('whitespace inside a header is tolerated and normalized on re-render', () => {
  const text = '[ mcp_servers.mine ]\ncommand = "old"\n';
  assert.deepEqual(scanTomlTables(text)[0].path, ['mcp_servers', 'mine']);
  const { text: out } = mergeTomlTable(text, { mine: { command: 'new' } }, opts);
  assert.equal(out, '[mcp_servers.mine]\ncommand = "new"\n\n');
});

test('a trailing comment on a foreign header line is preserved', () => {
  const text = '[mcp_servers.foreign] # keep me\ncommand = "x"\n';
  const { text: out } = mergeTomlTable(text, { mine: { command: 'y' } }, opts);
  assert.equal(out, '[mcp_servers.foreign] # keep me\ncommand = "x"\n[mcp_servers.mine]\ncommand = "y"\n\n');
});

test('a trailing comment on a kept base header line is preserved', () => {
  const text = '[mcp_servers] # base\nmodel = "gpt"\n\n[mcp_servers.mine]\ncommand = "old"\n';
  const { text: out } = mergeTomlTable(text, {}, opts);
  assert.equal(out, '[mcp_servers] # base\nmodel = "gpt"\n\n');
});

test('foreign sub-tables before and after an owned one all survive', () => {
  const text = '[mcp_servers.before]\na = 1\n\n[mcp_servers.mine]\nb = 2\n\n[mcp_servers.after]\nc = 3\n';
  const { text: out } = mergeTomlTable(text, { mine: { b: 9 } }, opts);
  assert.equal(out, '[mcp_servers.before]\na = 1\n\n[mcp_servers.after]\nc = 3\n[mcp_servers.mine]\nb = 9\n\n');
});

test('an owned sub-table that is the only one removes the empty base header', () => {
  const text = '[mcp_servers]\n[mcp_servers.mine]\nb = 2\n';
  const { text: out, changed } = mergeTomlTable(text, {}, opts);
  assert.equal(out, '');
  assert.equal(changed, true);
});

test('an empty template removes only owned sub-tables', () => {
  const text = '[mcp_servers.foreign]\na = 1\n\n[mcp_servers.mine]\nb = 2\n';
  const { text: out } = mergeTomlTable(text, {}, opts);
  assert.equal(out, '[mcp_servers.foreign]\na = 1\n\n');
});

test('every byte outside the owned region is unchanged', () => {
  const text = '# top comment\nmodel = "gpt"\n\n[mcp_servers]\ntimeout = 5\n\n[mcp_servers.foreign]\ncommand = "keep"\n\n[mcp_servers.mine]\ncommand = "old"\n\n[other]\nx = 1\n';
  const { text: out } = mergeTomlTable(text, { mine: { command: 'new' } }, opts);
  assert.equal(out, '# top comment\nmodel = "gpt"\n\n[mcp_servers]\ntimeout = 5\n\n[mcp_servers.foreign]\ncommand = "keep"\n\n[mcp_servers.mine]\ncommand = "new"\n\n[other]\nx = 1\n');
  assert.deepEqual(scanTomlTables(out).map((t) => t.path), [['mcp_servers'], ['mcp_servers', 'foreign'], ['mcp_servers', 'mine'], ['other']]);
});

test('merging is idempotent and reports no change on the second pass', () => {
  const text = '[mcp_servers]\ntimeout = 5\n\n[mcp_servers.foreign]\ncommand = "keep"\n\n[mcp_servers.mine]\ncommand = "old"\n';
  const first = mergeTomlTable(text, { mine: { command: 'new' } }, opts);
  const second = mergeTomlTable(first.text, { mine: { command: 'new' } }, opts);
  assert.equal(second.text, first.text);
  assert.equal(second.changed, false);
});

test('a no-op merge leaves the text byte-identical', () => {
  const text = '[mcp_servers.foreign]\na = 1\n';
  const { text: out, changed } = mergeTomlTable(text, {}, { container: CONTAINER, isMine: () => false });
  assert.equal(out, text);
  assert.equal(changed, false);
});

test('template values serialize strings, arrays, booleans and numbers', () => {
  const { text: out } = mergeTomlTable('', { mine: { command: 'npx', args: ['-y', 'x'], enabled: true, timeout: 30 } }, opts);
  assert.equal(out, '[mcp_servers.mine]\ncommand = "npx"\nargs = ["-y", "x"]\nenabled = true\ntimeout = 30\n\n');
});

test('a non-table template entry is refused', () => {
  assert.throws(() => mergeTomlTable('', { mine: 'nope' }, opts), /must be a table/);
});

test('missing container or isMine is refused', () => {
  assert.throws(() => mergeTomlTable('', {}, {}), /container/);
  assert.throws(() => mergeTomlTable('', {}, { container: CONTAINER }), /isMine/);
});
