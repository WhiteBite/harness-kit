# Changelog

Keep-a-changelog format. The package `version` is independent of the registry's `registryVersion` (see `registry/CHANGELOG.md`).

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
