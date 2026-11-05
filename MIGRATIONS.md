# Migrations

Per-consumer steps for breaking harness-kit changes. The package `version` and `registryVersion` are independent. A MAJOR `registryVersion` bump is a STRUCTURAL change (a key removed, renamed, or given a new meaning) that breaks consumer code; a fact VALUE change is MINOR and is surfaced by the lockfile/`diff`, not the version number.

## Registry 0.2.0 (kit 0.6.0)

Additive: new `mcp` blocks and four MCP-only harness rows (vscode, roo, zed, factory), all `status: "experimental"`. No consumer action required; ignore `mcp` if unused.

## Registry 0.1.0

Initial. No migrations.
