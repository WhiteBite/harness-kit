# AGENTS.md

> Operational instructions for coding agents (Codex, Cursor, OpenCode, Claude Code).

Project: **harness-kit** — canonical registry and zero-dependency primitives for wiring AI coding harnesses.

## Commands

```bash
npm test              # node --test + selftest: coexistence spike, atomic/template, symlink state machine, registry validation
npm run self-test     # registry validation + sabotage fixtures + two-owner merge sweep
npm run manifest      # regenerate manifest.json after any src/, registry/ or types/ change
npm run manifest:check # fail if manifest.json is stale
npm run hooks:install  # enable the pre-commit manifest gate (once per clone)
npm run version:check # fail if a version surface drifted from package.json
npm run release       # sync + commit + tag the current (or bumped) version; push with `git push --follow-tags`
```

## Repository map

| Path | Purpose |
| --- | --- |
| `registry/harnesses.json` | canonical harness facts: config paths, shapes, events, timeout units, env overrides |
| `registry/harnesses.schema.json` | language-neutral validation contract (unknown keys tolerated) |
| `registry/CHANGELOG.md` | registryVersion history |
| `src/index.mjs` | public export barrel consumed via package exports |
| `src/shapes.mjs` | single source of the six hook-config shapes |
| `src/merge.mjs` | owner-scoped strip-then-append across all six shapes + `stripOwned`/`locatorFor` sidecar wiring |
| `src/ownership.mjs` | sidecar manifest: locator + sha256 per owned entry, `clearOwnership` uninstall |
| `src/atomic.mjs` | validate-then-rotate writes, symlink refusal (incl. backup path), Windows rename retries |
| `src/template.mjs` | `{{VAR}}` substitution with full JSON-string escaping |
| `src/symlink.mjs` | skill-dir linking with absent/linked/foreign-link/manual classification |
| `src/registry.mjs` | loader + zero-dep structural validator |
| `src/mcp.mjs` | owner-scoped MCP server-map merge for JSON configs |
| `src/jsonc.mjs` | JSONC scanner + comment-preserving container splice (`write: "merge-text"`) |
| `src/toml.mjs` | TOML scanner + comment-preserving table splice (`write: "merge-text"`) |
| `src/marker.mjs` | marker-block writers + shell-block reader |
| `src/drift.mjs` | hook-command drift classification (broken/missing/stale/ok) |
| `src/doctor.mjs` | `checkInstall` findings aggregation (hook-config drift, marker-block content status) + git `core.hooksPath` resolver |
| `src/manifest.mjs` | deterministic hash-manifest primitives shared by the CLI, scripts and tests |
| `bin/harness-kit.mjs` | zero-dep CLI: `versions`/`vendor`/`check`/`diff`/`update` |
| `scripts/selftest.mjs` | sabotage-checked invariants + coexistence sweep + docs-table gates |
| `scripts/manifest.mjs` | deterministic hash manifest for vendored sync-checks |
| `scripts/version.mjs` | single-source version: sync/check/bump/tag/release |
| `scripts/release-check.mjs` | release-integrity gate: tag==version + packed-artifact vendor smoke |
| `docs/consumption.md` | vendoring + sync-check procedure |
| `docs/coexistence.md` | multi-tool ownership convention |
| `docs/dialects.md` | shape catalog + how to add a harness |
| `docs/boundaries.md` | product scope + known limitations |

## Do / Don't

- **Do** regenerate `manifest.json` in the same commit that changes `src/`, `registry/` or `types/`.
- **Do** enable the local pre-commit gate once per clone: `npm run hooks:install` (it fails a commit when `manifest.json` lags `src`/`registry`/`types`; bypass with `HARNESS_KIT_SKIP_HOOKS=1`).
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
