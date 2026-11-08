# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| latest | yes |

## Reporting a vulnerability

Please report security issues privately: open a private security advisory on
GitHub (Security -> Report a vulnerability) or email the maintainers.

Do not open a public issue for an unreported vulnerability.

## Scope

@whitebite/harness-kit is a local, install-time library and CLI. It reads, merges and writes
config files (hook-config JSON, JSONC/TOML MCP fragments, shell/HTML marker blocks), creates
directory symlinks, and queries `git` for hook paths - always inside the repository or paths
its caller passes. It sends nothing anywhere: no network calls, no telemetry, no eval of
config content. The npm package has zero runtime dependencies; vendored consumers hash every
kit file against `manifest.json`, so any substituted copy fails their sync-check. Reports
about dependency vulnerabilities are welcome and are treated as high priority.
