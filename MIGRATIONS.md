# Migrations

Per-consumer steps for breaking harness-kit changes. The package `version` and `registryVersion` are independent; a MAJOR `registryVersion` bump is where a fact a consumer acts on (path, write, shape, events, container) changed, even when it "fixes" a value.

## Registry 0.2.0 (kit 0.6.0)

Additive: new `mcp` blocks and four MCP-only harness rows (vscode, roo, zed, factory), all `status: "experimental"`. No consumer action required; ignore `mcp` if unused.

## Registry 0.1.0

Initial. No migrations.
