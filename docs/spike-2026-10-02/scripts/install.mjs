import { mergeHooks, readJsonConfig, writeJsonAtomic, recordOwnership } from './vendor-kit/src/index.mjs';

const [owner, command, marker, mode] = process.argv.slice(2);
if (!owner || !command || !marker) {
  console.error('usage: node install.mjs <owner> <command> <marker> [uninstall]');
  process.exit(2);
}

const path = '.claude/settings.json';
const isMine = (c) => typeof c === 'string' && c.includes(marker);
const template = mode === 'uninstall'
  ? { hooks: { PreToolUse: [] } }
  : { hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command, timeout: 30 }] }] } };

const existing = readJsonConfig(path) || {};
const merged = mergeHooks(existing, template, { shape: 'nested-hooks', isMine });
writeJsonAtomic(path, merged);

if (mode === 'uninstall') {
  recordOwnership('.', owner, path, merged, []);
} else {
  recordOwnership('.', owner, path, merged, [['hooks', 'PreToolUse', merged.hooks.PreToolUse.length - 1]]);
}
console.log(`${owner} ${mode === 'uninstall' ? 'uninstalled' : 'installed'}`);
