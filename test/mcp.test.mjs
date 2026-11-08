import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeMcpServers } from '../src/mcp.mjs';
import { recordOwnership, ownedLocators, entryMatchesHash } from '../src/ownership.mjs';

const CONTAINER = 'mcpServers';
const isMine = (name) => name === 'mine';

const mineTemplate = { mine: { command: 'npx', args: ['-y', 'mine-server'] } };
const foreignServer = { command: 'npx', args: ['-y', 'foreign-server'] };

test('merge into an empty config installs servers under the container', () => {
  const merged = mergeMcpServers({}, mineTemplate, { container: CONTAINER, isMine });
  assert.deepEqual(merged, { mcpServers: { mine: { command: 'npx', args: ['-y', 'mine-server'] } } });
});

test('a foreign server survives, the caller server is stripped then re-added, reinstall is byte-identical', () => {
  const seeded = { mcpServers: { foreign: foreignServer, mine: { command: 'npx', args: ['-y', 'old'] } } };
  const merged = mergeMcpServers(seeded, mineTemplate, { container: CONTAINER, isMine });
  assert.deepEqual(merged.mcpServers.foreign, foreignServer);
  assert.deepEqual(merged.mcpServers.mine, mineTemplate.mine);

  const reinstall = mergeMcpServers(merged, mineTemplate, { container: CONTAINER, isMine });
  assert.equal(JSON.stringify(reinstall), JSON.stringify(merged));
});

test('an empty template uninstalls only the caller servers and deletes an emptied container', () => {
  const seeded = { permissions: { allow: ['Bash'] }, mcpServers: { foreign: foreignServer, mine: mineTemplate.mine } };
  const uninstalled = mergeMcpServers(seeded, {}, { container: CONTAINER, isMine });
  assert.deepEqual(uninstalled.mcpServers, { foreign: foreignServer });
  assert.deepEqual(uninstalled.permissions, { allow: ['Bash'] });

  const emptied = mergeMcpServers({ mcpServers: { mine: mineTemplate.mine } }, {}, { container: CONTAINER, isMine });
  assert.equal('mcpServers' in emptied, false);
  assert.deepEqual(emptied, {});
});

test('a non-object container value is rejected', () => {
  assert.throws(() => mergeMcpServers({ mcpServers: [] }, mineTemplate, { container: CONTAINER, isMine }), /not a server map/);
});

test('a missing isMine or an invalid container is rejected', () => {
  assert.throws(() => mergeMcpServers({}, mineTemplate, { container: CONTAINER }), /isMine/);
  assert.throws(() => mergeMcpServers({}, mineTemplate, { isMine }), /container/);
  assert.throws(() => mergeMcpServers({}, mineTemplate, { container: '', isMine }), /container/);
});

test('ownership round-trip: a [container, serverName] locator resolves and hashes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-mcp-'));
  try {
    const config = mergeMcpServers({}, mineTemplate, { container: CONTAINER, isMine });
    recordOwnership(dir, 'tool', '.mcp.json', config, [[CONTAINER, 'mine']]);
    const [record] = ownedLocators(dir, 'tool', '.mcp.json');
    assert.equal(entryMatchesHash(config, record), true);

    const tampered = JSON.parse(JSON.stringify(config));
    tampered.mcpServers.mine.args = ['-y', 'hijacked'];
    assert.equal(entryMatchesHash(tampered, record), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
