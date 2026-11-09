import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  OUTCOMES,
  ATTRIBUTIONS,
  ACTIONS,
  QUARANTINE_BUDGET,
  RULES,
  classify,
  readQuarantine,
  activeQuarantine,
  expiredQuarantine,
  overBudget,
} from '../taxonomy.mjs';

const good = () => ({
  mockSelfTestPassed: true,
  installExit: 0,
  harnessBootOk: true,
  integrationLoaded: true,
  hookFired: true,
  behaviorOk: true,
  infraOk: true,
  harnessExit: 0,
});

const entry = (overrides = {}) => ({
  harness: 'claude',
  version: '1.0.0',
  outcome: 'harness-broken',
  reason: 'upstream churn',
  issue: '#42',
  expiresAt: '2026-12-31',
  ...overrides,
});

test('constants: the two axes and the budget are frozen and complete', () => {
  assert.deepEqual([...OUTCOMES], [
    'pass',
    'install-failed',
    'load-failed',
    'hook-not-fired',
    'behavior-mismatch',
    'mock-incompatible',
    'harness-broken',
    'infra-error',
  ]);
  assert.deepEqual([...ATTRIBUTIONS], ['consumer', 'harness', 'mock', 'infra']);
  assert.deepEqual([...ACTIONS], ['block', 'warn', 'quarantine']);
  assert.equal(QUARANTINE_BUDGET, 3);
  assert.ok(Object.isFrozen(OUTCOMES) && Object.isFrozen(ATTRIBUTIONS) && Object.isFrozen(ACTIONS));
});

test('classify: every outcome maps to exactly one attribution/action pair', () => {
  const cases = [
    ['pass', good(), null, null],
    ['install-failed', { ...good(), installExit: 1 }, 'consumer', 'block'],
    ['load-failed', { ...good(), integrationLoaded: false }, 'consumer', 'block'],
    ['hook-not-fired', { ...good(), hookFired: false }, 'consumer', 'block'],
    ['behavior-mismatch', { ...good(), behaviorOk: false }, 'consumer', 'block'],
    ['mock-incompatible', { ...good(), mockSelfTestPassed: false }, 'mock', 'block'],
    ['harness-broken', { ...good(), harnessBootOk: false }, 'harness', 'quarantine'],
    ['infra-error', { ...good(), infraOk: false }, 'infra', 'warn'],
  ];
  for (const [outcome, evidence, attribution, action] of cases) {
    assert.deepEqual(classify(evidence), { outcome, attribution, action });
  }
});

test('classify: mock health is evaluated before harness health', () => {
  const sabotage = { ...good(), mockSelfTestPassed: false, harnessBootOk: false };
  assert.equal(classify(sabotage).outcome, 'mock-incompatible');
  assert.notEqual(classify(sabotage).outcome, 'harness-broken');
  const order = RULES.map((rule) => rule.outcome);
  assert.ok(order.indexOf('mock-incompatible') < order.indexOf('harness-broken'));
});

test('classify: a non-zero harness exit is harness-broken, a null exit is not', () => {
  assert.equal(classify({ ...good(), harnessExit: 1 }).outcome, 'harness-broken');
  assert.equal(classify({ ...good(), harnessExit: null }).outcome, 'pass');
});

test('classify: unknown fields never produce pass', () => {
  assert.equal(classify({}).outcome, 'infra-error');
  assert.equal(classify().outcome, 'infra-error');
  assert.equal(classify({ ...good(), hookFired: undefined }).outcome, 'infra-error');
  assert.equal(classify({ ...good(), installExit: undefined }).outcome, 'infra-error');
  assert.equal(classify({ ...good(), harnessExit: undefined }).outcome, 'infra-error');
  assert.equal(classify({ ...good(), mockSelfTestPassed: undefined }).outcome, 'infra-error');
  assert.equal(classify({ ...good(), behaviorOk: 'yes' }).outcome, 'infra-error');
});

test('readQuarantine: reads budget and entries, throws on an entry missing issue or expiresAt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hk-taxonomy-'));
  try {
    const path = join(dir, 'quarantine.json');
    writeFileSync(path, JSON.stringify({ budget: 2, entries: [entry()] }));
    const q = readQuarantine(path);
    assert.equal(q.budget, 2);
    assert.equal(q.entries.length, 1);

    writeFileSync(path, JSON.stringify({ budget: 3, entries: [{ ...entry(), issue: undefined }] }));
    assert.throws(() => readQuarantine(path), /issue/);

    writeFileSync(path, JSON.stringify({ budget: 3, entries: [{ ...entry(), expiresAt: undefined }] }));
    assert.throws(() => readQuarantine(path), /expiresAt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('expiredQuarantine: entries at or before now are returned separately', () => {
  const entries = [
    entry({ expiresAt: '2026-01-01' }),
    entry({ expiresAt: '2026-06-01' }),
    entry({ expiresAt: '2027-01-01' }),
  ];
  const expired = expiredQuarantine(entries, '2026-06-01');
  assert.deepEqual(expired.map((e) => e.expiresAt), ['2026-01-01', '2026-06-01']);
});

test('activeQuarantine: matches harness and version, ignores expired and other versions', () => {
  const entries = [
    entry({ version: '1.0.0', expiresAt: '2027-01-01' }),
    entry({ version: '2.0.0', expiresAt: '2027-01-01' }),
    entry({ version: '1.0.0', expiresAt: '2026-01-01' }),
    entry({ harness: 'codex', version: '1.0.0', expiresAt: '2027-01-01' }),
  ];
  const active = activeQuarantine(entries, '2026-06-01', 'claude', '1.0.0');
  assert.equal(active.length, 1);
  assert.equal(active[0].harness, 'claude');
  assert.equal(active[0].version, '1.0.0');
});

test('overBudget: true only when the count exceeds the budget', () => {
  assert.equal(overBudget([entry(), entry(), entry()], 3), false);
  assert.equal(overBudget([entry(), entry(), entry(), entry()], 3), true);
  assert.equal(overBudget([entry(), entry(), entry(), entry()]), true);
  assert.equal(overBudget([], 3), false);
});
