# Changelog

Keep-a-changelog format. `registryVersion` mirrors the package `version`: there is one version everywhere (`npm run version:sync` sets it); historical registry-only versions live in `registry/CHANGELOG.md`.

## 2.1.0

- Registry: additive `headless` block on the `claude` and `opencode` rows (durable invocation facts for headless conformance runs), both `status: "experimental"`; the schema declares it with `wire`/`integration` enums and a `stable`-requires-`verified` rule, and self-test gates reject an unknown wire, an unknown or structurally inconsistent `integration`, an unparseable `run`, and a block without `status`/`verified`.

## 2.0.0

- BREAKING: `linkState` arguments are now `(source, target)`, aligned with `linkDir`/`unlinkDir`.
- Ownership is wired into merges: new `stripOwned` strips by sidecar hash with an optional substring fallback (a hash mismatch alone never deletes), `locatorFor` centralizes the per-shape locator knowledge, `clearOwnership` completes the uninstall lifecycle, and `recordOwnership` accumulates key-verified records per (owner, file).
- Hardening: `renderTemplate` substitutes only own vars (prototype-chain names like `{{constructor}}` stay literal); the atomic writer fsyncs the temp before rename and refuses a symlinked `.harness-kit.bak` target; BOM'd configs parse instead of aborting as broken JSON; marker-block writes go through the atomic temp-and-rename writer; junction target normalization covers the UNC and object-manager prefix forms; `linkDir` reports a dangling own link instead of healthy.
- `mergeJsoncContainer` keeps CRLF files uniform - inserted multi-line values no longer leak bare LF.
- `extractCliPath` no longer truncates `.tsx`/`.tsbuildinfo` into phantom `.ts` paths; the unused `isMine` option is gone from `CheckDriftOpts`.
- CLI/release: `vendor` refuses to operate on the kit tree or an ancestor of it and copies the manifest first; `release` commits only the version surfaces, never a stranger's staged files; the npm package resolves its TS types through the `exports` map and ships the README image.
- Registry facts reconciled with the data (amp is merge-text, zcode's phantom shape dropped, windsurf's unverified Windows path note removed, `conventions.mcpPolicy` matches the merge-text reality); the schema now encodes the cross-field rules (merge requires shape, stable requires `verified`, mcp write/format pairs) and declares top-level `envOverrides`.
- Docs are gated instead of trusted: self-test checks the dialects MCP and shape tables against the registry, pins exact row counts, and asserts the precise validator message per sabotage; README/AGENTS/dialects/boundaries/consumption/SECURITY/MIGRATIONS refreshed; CI runs the suite on windows-latest as well.

## 1.10.5

- `version:tag` now asserts the tagged commit carries the version; prereleases publish under the `next` dist-tag, a `workflow_dispatch` run only dry-runs, and `hasSection` no longer matches a prerelease prefix.
- New opt-in pre-commit gate (`npm run hooks:install` → `.githooks/pre-commit` running `scripts/manifest.mjs --check`) fails a commit when `manifest.json` lags `src`/`registry`/`types`; the `package.json` bin path drops the redundant `./`.

## 1.10.4

- Release-chain hardening: `npm run release` stages every version surface (registry included), refuses a dirty `src`/`registry`/`types` tree, refuses to move an existing tag, and pushes branch and tag together; `docs/jsonld.jsonld` is version-synced in place instead of re-serialized; `publish.yml` runs `version:check` and compares the exact version before skipping.

## 0.11.0

- Comment-preserving MCP writes for non-JSON configs: `mergeJsoncContainer` (JSONC) and `mergeTomlTable` (TOML) splice an owner-scoped server map into text, preserving every foreign byte and comment and refusing any construct outside their supported subset. New `mcp.write: "merge-text"`; opencode and amp (jsonc) and codex (toml) move off `print-only`.
- New `writeTextAtomic` (verbatim-bytes atomic writer) plus `scanJsonc` / `parseJsonc` / `scanTomlTables` helpers.

## 0.10.0

- Owner-scoped MCP server-map merge (`mergeMcpServers`): six JSON, env-interpolated `mcp` rows (claude, gemini, cursor, windsurf, kiro, factory) move from `print-only` to `write: "merge"`.
- Registry grows by 11 experimental harness rows: goose, hermes, openhands, continue, junie, oh-my-pi, pi, kimi-code, amp and zcode, deepseek.
- One version everywhere: `registryVersion` is now a mirror of the package `version`, set by `npm run version:sync`; `version:check` rejects any drift between the package, `CITATION.cff`, `docs/jsonld.jsonld`, `manifest.json` and the registry.

## 0.9.0

Security and robustness hardening:
- Refuse a write when ANY existing path component is a symlink (not just the final file), and reject traversal/separator values in `renderPath` placeholders: an untrusted `{tool}`/`{id}` value or a symlinked config directory can no longer redirect a write outside the target tree.
- `writeJsonAtomic` backup suffix is now `.harness-kit.bak` (was `.bak`, which could clobber an unrelated file); temp files use a random name.
- `renderTemplate` is single-pass (a `{{...}}` inside a substituted value is no longer re-substituted).
- Fixes: `checkInstall` no longer throws on a non-shell marker surface; `readOwnership`/`entryMatchesHash` tolerate malformed sidecar entries; `recordOwnership` keeps prior records for other locators of the same file; the first-line marker matches a CRLF file.
- CLI: `vendor` requires the target to be a real harness-kit copy; `check` rejects manifest keys that escape the tree.
- Hook shapes now have a single source of truth (`src/shapes.mjs`); the schema enum, `mergeHooks` and `collectCommands` derive from it, and an unknown shape fails loudly.
- CLI gains a lockfile: `vendor` writes `harness-kit.lock` (versions, registry/schema sha256, tag), `check` validates the lock and reports staleness (fatal with `--strict`), `diff` shows what `update` would change, and `update` re-vendors from the installed kit. The manifest hash logic is shared via `src/manifest.mjs`.

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
