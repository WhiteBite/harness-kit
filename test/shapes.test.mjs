import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SHAPE_NAMES, shapeDescriptor } from '../src/shapes.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

test('the schema shape enum equals the descriptor keys (single source)', () => {
  const schema = JSON.parse(readFileSync(join(ROOT, 'registry', 'harnesses.schema.json'), 'utf8'));
  const enumValues = schema.definitions.harness.properties.hooks.oneOf[1].properties.shape.enum;
  assert.deepEqual(enumValues, SHAPE_NAMES);
});

test('every descriptor resolves to a known container and a boolean grouped', () => {
  for (const name of SHAPE_NAMES) {
    const descriptor = shapeDescriptor(name);
    assert.ok(['hooks', 'root', 'hooks-array'].includes(descriptor.container), `${name}: bad container`);
    assert.equal(typeof descriptor.grouped, 'boolean', `${name}: grouped must be boolean`);
  }
});

test('an unknown shape throws', () => {
  assert.throws(() => shapeDescriptor('sideways'), /unknown shape/);
});

test('every shape is used by a registry row', () => {
  const registry = JSON.parse(readFileSync(join(ROOT, 'registry', 'harnesses.json'), 'utf8'));
  const used = new Set(Object.values(registry.harnesses).map((entry) => entry.hooks && entry.hooks.shape).filter(Boolean));
  for (const name of SHAPE_NAMES) assert.ok(used.has(name), `no registry row uses shape ${name}`);
});
