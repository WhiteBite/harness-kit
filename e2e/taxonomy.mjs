/** Conformance-failure taxonomy: attributes a raw run to a culprit and a CI action, gating mock health ahead of harness health. */
import { readFileSync } from 'node:fs';

/** The eight conformance outcomes; `pass` carries no attribution or action. */
export const OUTCOMES = Object.freeze([
  'pass',
  'install-failed',
  'load-failed',
  'hook-not-fired',
  'behavior-mismatch',
  'mock-incompatible',
  'harness-broken',
  'infra-error',
]);

/** Whose fault a failure is. */
export const ATTRIBUTIONS = Object.freeze(['consumer', 'harness', 'mock', 'infra']);

/** What CI does about a failure. */
export const ACTIONS = Object.freeze(['block', 'warn', 'quarantine']);

/** Default cap on simultaneously active quarantine entries. */
export const QUARANTINE_BUDGET = 3;

const PAIRS = Object.freeze({
  pass: Object.freeze({ attribution: null, action: null }),
  'install-failed': Object.freeze({ attribution: 'consumer', action: 'block' }),
  'load-failed': Object.freeze({ attribution: 'consumer', action: 'block' }),
  'hook-not-fired': Object.freeze({ attribution: 'consumer', action: 'block' }),
  'behavior-mismatch': Object.freeze({ attribution: 'consumer', action: 'block' }),
  'mock-incompatible': Object.freeze({ attribution: 'mock', action: 'block' }),
  'harness-broken': Object.freeze({ attribution: 'harness', action: 'quarantine' }),
  'infra-error': Object.freeze({ attribution: 'infra', action: 'warn' }),
});

const EVIDENCE_TYPES = Object.freeze({
  mockSelfTestPassed: 'boolean',
  installExit: 'number',
  harnessBootOk: 'boolean',
  integrationLoaded: 'boolean',
  hookFired: 'boolean',
  behaviorOk: 'boolean',
  infraOk: 'boolean',
  harnessExit: 'number|null',
});

/** Ordered failure rules; the first match wins, and mock health precedes harness health by construction. */
export const RULES = Object.freeze([
  Object.freeze({ outcome: 'mock-incompatible', when: (e) => e.mockSelfTestPassed === false }),
  Object.freeze({ outcome: 'infra-error', when: (e) => e.infraOk === false }),
  Object.freeze({ outcome: 'install-failed', when: (e) => typeof e.installExit === 'number' && e.installExit !== 0 }),
  Object.freeze({
    outcome: 'harness-broken',
    when: (e) => e.harnessBootOk === false || (typeof e.harnessExit === 'number' && e.harnessExit !== 0),
  }),
  Object.freeze({ outcome: 'load-failed', when: (e) => e.integrationLoaded === false }),
  Object.freeze({ outcome: 'hook-not-fired', when: (e) => e.hookFired === false }),
  Object.freeze({ outcome: 'behavior-mismatch', when: (e) => e.behaviorOk === false }),
]);

function isKnown(field, value) {
  const type = EVIDENCE_TYPES[field];
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number') return typeof value === 'number';
  return typeof value === 'number' || value === null;
}

function result(outcome) {
  const pair = PAIRS[outcome];
  return { outcome, attribution: pair.attribution, action: pair.action };
}

/** Classifies flat run evidence into one outcome; unknown fields never yield `pass` and fall back to `infra-error`. */
export function classify(evidence = {}) {
  const e = evidence ?? {};
  for (const rule of RULES) {
    if (rule.when(e)) return result(rule.outcome);
  }
  const complete = Object.keys(EVIDENCE_TYPES).every((field) => isKnown(field, e[field]));
  return result(complete ? 'pass' : 'infra-error');
}

function toMs(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('quarantine entry must be an object');
  if (typeof entry.issue !== 'string' || entry.issue === '') throw new Error('quarantine entry requires an issue');
  if (typeof entry.expiresAt !== 'string' || entry.expiresAt === '') throw new Error('quarantine entry requires an expiresAt');
  if (Number.isNaN(toMs(entry.expiresAt))) throw new Error(`quarantine entry has an unparseable expiresAt: ${entry.expiresAt}`);
}

/** Reads and validates a quarantine file; throws when any entry lacks an issue or an expiry. */
export function readQuarantine(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const entries = Array.isArray(data.entries) ? data.entries : [];
  for (const entry of entries) validateEntry(entry);
  return { budget: typeof data.budget === 'number' ? data.budget : QUARANTINE_BUDGET, entries };
}

/** Returns the entries for a harness+version that are still within their expiry at `now`. */
export function activeQuarantine(entries, now, harness, version) {
  const nowMs = toMs(now);
  return entries.filter((entry) => entry.harness === harness && entry.version === version && toMs(entry.expiresAt) > nowMs);
}

/** Returns the entries whose expiry is at or before `now`; expiry escalates to a hard failure. */
export function expiredQuarantine(entries, now) {
  const nowMs = toMs(now);
  return entries.filter((entry) => toMs(entry.expiresAt) <= nowMs);
}

/** True when the active entry count exceeds the budget (default `QUARANTINE_BUDGET`). */
export function overBudget(entries, budget = QUARANTINE_BUDGET) {
  return entries.length > budget;
}
