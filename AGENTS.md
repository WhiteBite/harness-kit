# AGENTS.md

> Operational instructions for coding agents (Codex, Cursor, OpenCode, Claude Code).

Project: **harness-kit** — canonical registry and zero-dependency primitives for wiring AI coding harnesses.

## Commands

```bash
npm test            # node --test: coexistence spike, atomic/template, symlink state machine
npm run self-test   # registry validation + sabotage fixtures + two-owner merge sweep
npm run manifest    # regenerate manifest.json after any src/, registry/ or types/ change
```

## Repository map

| Path | Purpose |
| --- | --- |
| `registry/harnesses.json` | canonical harness facts: config paths, shapes, events, timeout units, env overrides |
| `registry/harnesses.schema.json` | language-neutral validation contract (unknown keys tolerated) |
| `registry/CHANGELOG.md` | registryVersion history |
| `src/merge.mjs` | owner-scoped strip-then-append across all six config shapes |
| `src/ownership.mjs` | sidecar manifest: locator + sha256 per owned entry |
| `src/atomic.mjs` | validate-then-rotate writes, symlink refusal, Windows rename retries |
| `src/template.mjs` | `{{VAR}}` substitution with full JSON-string escaping |
| `src/symlink.mjs` | skill-dir linking with absent/linked/foreign-link/manual classification |
| `src/registry.mjs` | loader + zero-dep structural validator |
| `scripts/self-test.mjs` | sabotage-checked invariants + coexistence sweep |
| `scripts/manifest.mjs` | deterministic hash manifest for vendored sync-checks |
| `docs/consumption.md` | vendoring + sync-check procedure |
| `docs/coexistence.md` | multi-tool ownership convention |
| `docs/dialects.md` | shape catalog + how to add a harness |

## Do / Don't

- **Do** regenerate `manifest.json` in the same commit that changes `src/`, `registry/` or `types/`.
- **Do** keep the registry factual: one reconciled value per fact; disagreements between tools are policy knobs in consumer code, never registry columns.
- **Do** bump `registryVersion` (semver) and add a `registry/CHANGELOG.md` entry for every registry change.
- **Do** mark unverified harness behavior `status: "experimental"` with a note naming what to verify.
- **Don't** add runtime dependencies — zero-dep is a product property.
- **Don't** delete registry keys; deprecate in place (vendored consumers pin old versions).
- **Don't** parse `notes` fields in code — they are human-only.
- **Don't** bake policy into the registry (user-scope writes, runner choice, matcher vocabularies): those are consumer parameters.
- **Don't** publish, tag or force-push without explicit human confirmation.
