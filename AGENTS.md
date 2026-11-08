# AGENTS.md

> Operational instructions for coding agents (Codex, Cursor, OpenCode, Claude Code).

Project: **harness-kit** — canonical registry and zero-dependency primitives for wiring AI coding harnesses.

## Commands

```bash
npm test              # node --test + selftest: coexistence spike, atomic/template, symlink state machine, registry validation
npm run self-test     # registry validation + sabotage fixtures + two-owner merge sweep
npm run manifest      # regenerate manifest.json after any src/, registry/ or types/ change
npm run version:check # fail if a version surface drifted from package.json
npm run release       # sync + commit + tag the current (or bumped) version; push with `git push --follow-tags`
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
| `scripts/selftest.mjs` | sabotage-checked invariants + coexistence sweep |
| `scripts/manifest.mjs` | deterministic hash manifest for vendored sync-checks |
| `scripts/version.mjs` | single-source version: sync/check/bump/tag/release |
| `scripts/release-check.mjs` | release-integrity gate: tag==version + packed-artifact vendor smoke |
| `docs/consumption.md` | vendoring + sync-check procedure |
| `docs/coexistence.md` | multi-tool ownership convention |
| `docs/dialects.md` | shape catalog + how to add a harness |

## Do / Don't

- **Do** regenerate `manifest.json` in the same commit that changes `src/`, `registry/` or `types/`.
- **Do** keep the registry factual: one reconciled value per fact; disagreements between tools are policy knobs in consumer code, never registry columns.
- **Do** keep `registryVersion` a mirror of the package `version` (`npm run version:sync` sets both) and add a `CHANGELOG.md` entry for every registry change.
- **Do** mark unverified harness behavior `status: "experimental"` with a note naming what to verify.
- **Do** treat `package.json` as the only hand-edited version; `npm run version:sync` propagates it to `CITATION.cff`, `docs/jsonld.jsonld` and `manifest.json`.
- **Do** release via `npm run release` so every version gets a `v*` tag (CI fails on main when the version is untagged) and a `CHANGELOG.md` section.
- **Don't** add runtime dependencies — zero-dep is a product property.
- **Don't** delete registry keys; deprecate in place (vendored consumers pin old versions).
- **Don't** parse `notes` fields in code — they are human-only.
- **Don't** bake policy into the registry (user-scope writes, runner choice, matcher vocabularies): those are consumer parameters.
- **Don't** publish, tag or force-push without explicit human confirmation.
