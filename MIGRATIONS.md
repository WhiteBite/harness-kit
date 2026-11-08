# Migrations

Per-consumer steps for breaking harness-kit changes. Since package 0.10.0 the package `version` and `registryVersion` are mirrors set by `npm run version:sync` (they were independent before that; historical registry-only versions live in `registry/CHANGELOG.md`). A MAJOR version bump is a STRUCTURAL change (a key removed, renamed, or given a new meaning) that breaks consumer code; a fact VALUE change is MINOR and is surfaced by the lockfile/`diff`, not the version number.

## Registry 0.2.0 (kit 0.7.0)

Additive: new `mcp` blocks and four MCP-only harness rows (vscode, roo, zed, factory), all `status: "experimental"`. No consumer action required; ignore `mcp` if unused.

## Registry 0.1.0

Initial. No migrations.
