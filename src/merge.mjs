/** Owner-scoped hook-config merge: strip only the caller's entries, append fresh ones, preserve every foreign byte. */
import { canonicalJson, hashValue, resolveLocator } from './ownership.mjs';
import { shapeDescriptor } from './shapes.mjs';

/** Positional locator of an appended entry for one shape: ['hooks', event, index] for hook maps, [event, index] at the root, ['hooks', index] for the flat array. */
export function locatorFor(shape, event, index) {
  if (!Number.isInteger(index) || index < 0) throw new Error('locatorFor requires a non-negative integer index');
  const { container } = shapeDescriptor(shape);
  if (container === 'root') return [event, index];
  if (container === 'hooks-array') return ['hooks', index];
  if (typeof event !== 'string' || event === '') throw new Error('locatorFor requires an event name for hook-map shapes');
  return ['hooks', event, index];
}

export function entryCommands(entry) {
  const commands = [];
  if (!entry || typeof entry !== 'object') return commands;
  if (typeof entry.command === 'string') commands.push(entry.command);
  if (entry.action && typeof entry.action.command === 'string') commands.push(entry.action.command);
  if (Array.isArray(entry.hooks)) {
    for (const leaf of entry.hooks) {
      if (leaf && typeof leaf === 'object' && typeof leaf.command === 'string') commands.push(leaf.command);
    }
  }
  return commands;
}

function isOwnEntry(entry, isMine) {
  const commands = entryCommands(entry);
  return commands.length > 0 && commands.every((command) => isMine(command));
}

function stripGroups(entries, isMine) {
  const kept = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      kept.push(entry);
      continue;
    }
    if (Array.isArray(entry.hooks)) {
      const inner = entry.hooks.filter((leaf) => !(leaf && typeof leaf === 'object' && typeof leaf.command === 'string' && isMine(leaf.command)));
      if (inner.length === entry.hooks.length) kept.push(entry);
      else if (inner.length > 0) kept.push({ ...entry, hooks: inner });
      continue;
    }
    if (typeof entry.command === 'string') {
      if (!isMine(entry.command)) kept.push(entry);
      continue;
    }
    kept.push(entry);
  }
  return kept;
}

function stripLeaves(entries, isMine) {
  return entries.filter((entry) => !isOwnEntry(entry, isMine));
}

function eventMapOf(value, where) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${where} is not an event map - wrong shape descriptor for this config file?`);
  }
  return value;
}

function mergeHooksArray(existing, template, isMine) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(template)) {
    if (key === 'hooks') continue;
    if (!(key in merged)) merged[key] = value;
  }
  const current = merged.hooks;
  if (current !== undefined && !Array.isArray(current)) {
    throw new Error('config .hooks is not an array - wrong shape descriptor for this config file?');
  }
  const stripped = (Array.isArray(current) ? current : []).filter((entry) => !isOwnEntry(entry, isMine));
  const additions = Array.isArray(template.hooks) ? template.hooks : [];
  merged.hooks = [...stripped, ...additions];
  return merged;
}

/**
 * Merges a template into an existing config for one registry shape. Own entries
 * are stripped from EVERY event (so an empty template uninstalls), then the
 * template entries are appended. Foreign entries and unknown top-level keys
 * survive untouched; running the same merge twice is byte-identical.
 */
export function mergeHooks(existing, template, { shape, isMine }) {
  if (typeof isMine !== 'function') throw new Error('mergeHooks requires an isMine(command) predicate');
  const descriptor = shapeDescriptor(shape);
  if (descriptor.container === 'hooks-array') return mergeHooksArray(existing, template, isMine);

  const rootScoped = descriptor.container === 'root';
  const grouped = descriptor.grouped;
  const merged = { ...existing };

  if (!rootScoped) {
    for (const [key, value] of Object.entries(template)) {
      if (key === 'hooks') continue;
      if (!(key in merged)) merged[key] = value;
    }
  }

  const container = rootScoped
    ? merged
    : (() => {
        const hooks = eventMapOf(merged.hooks, 'config .hooks');
        merged.hooks = { ...hooks };
        return merged.hooks;
      })();

  for (const [event, entries] of Object.entries(container)) {
    if (!rootScoped && event === 'hooks') continue;
    if (!Array.isArray(entries)) continue;
    const stripped = grouped ? stripGroups(entries, isMine) : stripLeaves(entries, isMine);
    if (stripped.length === 0) delete container[event];
    else container[event] = stripped;
  }

  const templateEvents = rootScoped ? template : eventMapOf(template.hooks, 'template .hooks');
  for (const [event, entries] of Object.entries(templateEvents)) {
    if (!rootScoped && event === 'hooks') continue;
    if (!Array.isArray(entries)) continue;
    // foreign non-array event value: keep verbatim, skip template entries for it
    if (event in container && !Array.isArray(container[event])) continue;
    const current = Array.isArray(container[event]) ? container[event] : [];
    const appended = [...current, ...entries];
    if (appended.length === 0) delete container[event];
    else container[event] = appended;
  }

  return merged;
}

/** Copy-on-write walk down `prefix`: every object/array along the path is cloned in `merged`, the leaf array is returned. */
function copiedContainer(merged, prefix) {
  if (prefix.length === 0) return undefined;
  let parent = merged;
  for (let i = 0; i < prefix.length; i += 1) {
    const segment = prefix[i];
    const value = parent[segment];
    if (value === null || typeof value !== 'object') return undefined;
    const clone = Array.isArray(value) ? [...value] : { ...value };
    parent[segment] = clone;
    if (i === prefix.length - 1) return Array.isArray(clone) ? clone : undefined;
    parent = clone;
  }
  return undefined;
}

/**
 * Sidecar-driven strip (coexistence rules 2-3): an entry at a recorded locator
 * is removed when its sha256 matches, or - only when the caller passes isMine -
 * when the command still matches the substring predicate after an out-of-band
 * edit. A hash mismatch alone NEVER deletes: the entry may have shifted under
 * a foreign install. Returns the stripped config and how many entries went.
 */
export function stripOwned(config, { records, isMine } = {}) {
  if (!Array.isArray(records)) throw new Error('stripOwned requires records (the ownedLocators() output)');
  if (isMine !== undefined && typeof isMine !== 'function') throw new Error('stripOwned requires an isMine(command) predicate when given');
  const merged = { ...config };
  const buckets = new Map();
  for (const record of records) {
    const locator = Array.isArray(record.locator) ? record.locator : null;
    if (locator === null || locator.length === 0) continue;
    if (typeof locator[locator.length - 1] !== 'number') continue;
    const key = canonicalJson(locator.slice(0, -1));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  }
  let removed = 0;
  for (const group of buckets.values()) {
    group.sort((a, b) => b.locator[b.locator.length - 1] - a.locator[a.locator.length - 1]);
    for (const record of group) {
      const prefix = record.locator.slice(0, -1);
      const index = record.locator[record.locator.length - 1];
      const arr = copiedContainer(merged, prefix);
      if (arr === undefined) continue;
      const entry = arr[index];
      if (entry === undefined) continue;
      const hashMatches = hashValue(entry) === record.sha256;
      const substringMatches = isMine !== undefined && isOwnEntry(entry, isMine);
      if (!hashMatches && !substringMatches) continue;
      arr.splice(index, 1);
      removed += 1;
      if (arr.length === 0) {
        const parent = resolveLocator(merged, prefix.slice(0, -1));
        if (parent && typeof parent === 'object') delete parent[prefix[prefix.length - 1]];
      }
    }
  }
  return { config: merged, removed };
}
