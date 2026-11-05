# Changelog

Keep-a-changelog format. The package `version` is independent of the registry's `registryVersion` (see `registry/CHANGELOG.md`).

## 0.9.0

Security and robustness hardening:
- Refuse a write when ANY existing path component is a symlink (not just the final file), and reject traversal/separator values in `renderPath` placeholders: an untrusted `{tool}`/`{id}` value or a symlinked config directory can no longer redirect a write outside the target tree.
- `writeJsonAtomic` backup suffix is now `.harness-kit.bak` (was `.bak`, which could clobber an unrelated file); temp files use a random name.
- `renderTemplate` is single-pass (a `{{...}}` inside a substituted value is no longer re-substituted).
- Fixes: `checkInstall` no longer throws on a non-shell marker surface; `readOwnership`/`entryMatchesHash` tolerate malformed sidecar entries; `recordOwnership` keeps prior records for other locators of the same file; the first-line marker matches a CRLF file.
- CLI: `vendor` requires the target to be a real harness-kit copy; `check` rejects manifest keys that escape the tree.
- Hook shapes now have a single source of truth (`src/shapes.mjs`); the schema enum, `mergeHooks` and `collectCommands` derive from it, and an unknown shape fails loudly.

## 0.8.0

- registry 0.3.0: add `verified: { against, at }` provenance. `status: "stable"` rows must carry it; `validateRegistry` and a self-test gate reject a stable row without it or with a malformed date.
- Types gain `Verified`, `RegistryMcp`, and `harness.verified` / `harness.mcp`.

## 0.7.1

- Publish `manifest.json`, `CHANGELOG.md` and `docs/` in the npm tarball: `harness-kit vendor/check` and the documented sync-check now work for npm consumers (previously `manifest.json` was omitted).
- Add a release-integrity gate: `manifest.json` must match the tree, all version surfaces must agree, and a pushed `v*` tag must equal the package version.
- Registry versioning clarified: a fact VALUE change (path, write, shape, events, container) is MINOR and is surfaced by the lockfile/`diff`, not the version number; MAJOR is reserved for structural breaks (key removed, renamed, or meaning changed).

## 0.7.0

- CLI `harness-kit` (`versions`/`check`/`vendor`), `./schema` export, `MIGRATIONS.md`, and a raw-tag recipe for non-JS consumers.
- registry 0.2.0: experimental MCP client blocks for 12 clients.
- `renderPath` for `{tool}`/`{id}`/`{name}` path placeholders.
- `writeJsonAtomic` skips byte-identical rewrites and takes an optional `backup`; `resolveHooksDir` is worktree-aware.
- `docs/boundaries.md`.
