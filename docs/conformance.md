# Conformance CI

harness-kit ships a reusable workflow that runs a consumer's own installer against a real harness and reports a per-harness result. The runner stays dumb: the consumer supplies the install and assert commands, so the artifact under test is the consumer's real installer, not a reimplementation of it.

Status: the runner and the registry `headless` facts are experimental. Nothing has run against a real harness binary yet; every harness claim below is attributed to the research date (2026-11-09) or marked unverified.

## Opt in

Add a job to the consumer repo that calls the reusable workflow at a pinned tag:

```yaml
jobs:
  conformance:
    uses: WhiteBite/harness-kit/.github/workflows/conformance.yml@v2.1.0
    with:
      harnesses: "claude,opencode,oh-my-pi"
      config: ".github/conformance.yml"
```

`harnesses` is a comma-separated list of registry row ids, no spaces. `config` is the path to the contract file below. `lane` defaults to `pinned`; `scenario` is optional. The workflow splits the matrix on `harnesses`, so each row is its own job.

## Contract file

The consumer writes a small YAML file the runner reads. Four keys:

| Key | Meaning |
| --- | --- |
| `install` | Command that installs the consumer's integration into the harness. This is the artifact under test. |
| `detect` | Command that reports whether the integration loaded into the harness. Exit 0 = loaded. |
| `assert` | Command that asserts the hook fired and the behavior matched. Exit 0 = pass. |
| `artifacts` | Paths the runner collects and uploads when a job fails. |

Commands run with these placeholders substituted:

| Placeholder | Value |
| --- | --- |
| `{{HARNESS}}` | The registry row id for the current matrix job. |
| `{{WORKSPACE}}` | The scratch workspace the runner mounts for the run. |
| `{{MOCK_URL}}` | Base URL of the local mock model endpoint. |
| `{{MODEL}}` | Model alias for the row (registry `headless.provider.model`). |

```yaml
install:  "bun src/main.ts install --harness {{HARNESS}} --project --yes"
detect:   "node test/conformance/detect.mjs"
assert:   "node test/conformance/assert.mjs"
artifacts: [".claude/settings.json", ".opencode/dejavu/gates.json"]
```

The model endpoint is a local mock, so the workflow defines a dummy API key inline; no real secret is needed.

## Lanes

Two lanes, because one cannot serve both goals:

| Lane | Trigger | Versions | Blocks? |
| --- | --- | --- | --- |
| `pinned` | PR gate | from the runner's `versions.json` | yes |
| `latest` | nightly | upstream HEAD / `latest` | no (`continue-on-error`) |

A red `latest` run with a green `pinned` run is the expected, informative state: the consumer's integration works on the version it claims, and upstream just moved. The `latest` lane is the early-warning lane; it alerts, it does not gate PRs.

## Outcomes

Two orthogonal axes: attribution (whose fault) and action (what CI does).

| Outcome | Attribution | Action |
| --- | --- | --- |
| `pass` | — | — |
| `install-failed` | consumer | block |
| `load-failed` | consumer | block |
| `hook-not-fired` | consumer | block |
| `behavior-mismatch` | consumer | block |
| `mock-incompatible` | mock | block the flow maintainer |
| `harness-broken` | harness | quarantine |
| `infra-error` | infra | warn, retry |

Classification is gated: `mock-incompatible` is checked before `harness-broken`, so a harness that cannot complete a trivial round-trip is a mock defect, not upstream churn.

A quarantined row is reported as **"untested"**, never green. For a consumer that claims support, untested is a worse signal than red.

## Quarantine

A `harness-broken` row can be quarantined, but only with all of:

1. An `issue` link and an `expiresAt` date. Both are mandatory; an entry missing either is rejected.
2. On expiry the row returns to **hard failure**. Extending requires a human to re-affirm with a fresh reason and an issue link.
3. A budget: more than 3 active entries fails the nightly, so silence is not free.

## In scope

Rows are added when a real consumer claims them, never speculatively. A row nobody consumes still reddens on upstream churn and still demands triage.

Current in-scope rows: **claude, codex, gemini, opencode, crush, cline, oh-my-pi**.

## Not covered

| Area | Why |
| --- | --- |
| Skills surface (repo-aeo's integration) | repo-aeo installs skill symlinks; asserting "the agent loaded the skill" needs a scenario where the agent must use it. Different problem, deferred. |
| Windows | dejavu is Windows-first (long paths, rename retries); CI here is ubuntu. Deferred. |
| MCP-only rows (roo, zed, vscode, windsurf, factory) | The kit models only their MCP server map; there is no hook or plugin surface to fire. |
| aider | No hook, plugin, or MCP surface in the registry. |
| git | A marker-block target (pre-commit), not an agent that loads hooks. |

## Runner interface

The runner is `e2e/runner.mjs` in this repo, checked out at the same commit as the workflow into `.harness-kit/`. The workflow invokes it from the caller workspace root as:

```
node .harness-kit/e2e/runner.mjs --harness <id> --config <path> --lane <pinned|latest> [--scenario <path>]
```

TODO (runner owner): confirm the flag names and the result/trace output paths (`conformance-result.json`, `mock-trace.jsonl`) the workflow uploads on failure.
