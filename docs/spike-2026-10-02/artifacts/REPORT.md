# Runtime coexistence spike (Phase 0b) — Claude Code harness

Date: 2026-10-02. Scratch dir: `%USERPROFILE%\AppData\Local\Temp\opencode\hk-spike` (preserved, not cleaned up).

## Environment

| Item | Value |
|---|---|
| Kit (frozen snapshot) | harness-kit @ `e1b8f1bddbba267cc7bc1f66cab4a47236dd976f` (`artifacts/kit-sha.txt`, per-file sha256 in `artifacts/vendor-manifest.txt`) |
| Kit import | `./vendor-kit/src/index.mjs` only; live worktree never imported |
| Harness | Claude Code `2.1.163` at `S:\ClaudeCode\claude.exe` (`artifacts/claude-version.txt`) |
| Node | v24.12.0, Windows / pwsh 7 |
| Config site | project-scope `.claude/settings.json`, shape `nested-hooks`, event `PreToolUse`, matcher `Write\|Edit`, entry `{type:'command', timeout:30}` (seconds) |
| Auth status | **NOT AUTHENTICATED** — see `artifacts/env-blocked.md` |

## Assertion results

| # | Assertion | Result | Evidence |
|---|---|---|---|
| 1 | Both owners' entries coexist in one config | **PASS** | `artifacts/config-both.json` — two group entries under `hooks.PreToolUse` (one per owner), each `{matcher:'Write\|Edit', hooks:[{type:'command', command, timeout:30}]}`. Sidecar `artifacts/ownership-both.json`: owner-a locator `[hooks,PreToolUse,0]`, owner-b `[hooks,PreToolUse,1]`, distinct sha256 entry hashes. |
| 2 | Both hooks fire at runtime (claude creates hello.txt) | **ENV-BLOCKED** | `artifacts/claude-run1.txt`: `Not logged in · Please run /login`, exit 1. hello.txt absent; both logs 0 lines (`artifacts/log-counts.txt`). Full diagnostics: `artifacts/env-blocked.md`. Not a merge/config failure — claude exited at the auth gate before tool use. |
| 3 | Reinstall of owner-a is byte-identical (sha256 before/after) | **FAIL** (order flip; entry set preserved) | `artifacts/sha-before.txt` = `26b031e2…` ≠ `artifacts/sha-after.txt` = `b48445d9…`. Root cause below. Supplementary: `artifacts/sha-reinstall2.txt` = `b48445d9…` — the SECOND reinstall is byte-identical (fixed point). `artifacts/config-reinstalled.json` shows the only delta: entry order `[A,B] → [B,A]`. |
| 4 | Foreign root key survives another owner's install | **PASS** | `artifacts/config-foreign.json` — `spikeForeign: true` present, both owners' entries intact after owner-b reinstall. (Order flipped `[B,A] → [A,B]` — same strip-then-append semantics; presence preserved.) |
| 5 | Uninstall strips only own entries | **PASS** | `artifacts/config-uninstalled.json` — no `--owner-a-spike` anywhere, owner-b entry intact, `spikeForeign` intact. Sidecar `artifacts/ownership-uninstalled.json` — owner-a records cleared, owner-b retained. |
| 6 | Post-uninstall runtime: owner-b fires, owner-a silent | **ENV-BLOCKED** | Same auth blocker as #2; no further claude invocations spent. Static end-state: config holds exactly one PreToolUse command (owner-b); `artifacts/log-counts.txt` final: `owner-a.log=0 owner-b.log=0`; `artifacts/sha-final.txt` = `2929254c…`. |

## Assertion 3 root cause (the material finding)

`mergeHooks` is strip-then-append: the reinstalling owner's entries are removed from
every event, then re-appended at the end. With install order A-then-B, reinstalling
A moves A's group from index 0 to index 1:

```
[A, B] --reinstall A--> [B, A] --reinstall A--> [B, A]   (fixed point)
```

- Entry SET is preserved across the flip (no loss, no duplication) — verified in `artifacts/config-reinstalled.json`.
- Byte-identity holds only (a) for the last-installed owner's reinstall, or (b) from the second application onward. The frozen kit's own committed test documents this as intended pre-D1 semantics: `test/coexistence.test.mjs:71-76` asserts cross-owner reinstall is *set-preserving* with the comment "strip-then-append may move own entries to the end of each event"; byte-identity is asserted only for the same-owner/last-installed case (line 65-69).
- The runbook's blanket "re-run owner-a's install → config is byte-identical" claim does not hold for a non-last-installed owner under frozen (pre-D1) semantics. Consumers with golden-diff/byte-stability gates must compare entry sets or re-apply twice before comparing bytes.

## Sidecar locator drift (second finding)

The ownership sidecar stores array-index locators. Any cross-owner install/uninstall
shifts indices and invalidates OTHER owners' records until each refreshes its own:

- After owner-a's reinstall (assertion 3): owner-b's record `[hooks,PreToolUse,1]` resolves to owner-a's group → `entryMatchesHash: false` (false-positive tamper signal). `artifacts/ownership-reinstalled.json`.
- After owner-a's uninstall (assertion 5): owner-b's record still says index 1; the live entry sits at index 0 → `entryMatchesHash: false`. `artifacts/ownership-uninstalled.json`.

Locator+hash cannot distinguish legitimate index drift from out-of-band tampering.
Consumers using `entryMatchesHash` for tamper detection must re-resolve by content
(e.g. command-marker match) before trusting a `false`.

## Claude behavior observations

- Claude did NOT modify `.claude/settings.json` during the (failed) run: sha before = sha after = `26b031e2…` (`artifacts/sha-run1-before.txt`, `artifacts/sha-run1-after.txt`). Whether a *successful* run normalizes the file is unproven here (auth-blocked) — flag for the registry row.
- `claude doctor` is an interactive TUI: zero output in a non-TTY shell, killed at 60 s (`artifacts/claude-doctor.txt`, 0 bytes). Not usable as headless diagnostics.
- Auth diagnostics: no `ANTHROPIC_*`/`CLAUDE_*` env vars; `~/.claude/.credentials.json` = `{}`; `~/.claude.json` carries no auth material. Details in `artifacts/env-blocked.md`.
- Invocation budget: 1 of 3 `-p` invocations used (failed at auth); `--version` and `doctor` do not hit the API. 2 unused.

## Expected kit behaviors observed (no action needed)

- `.bak` rotation: `.claude/settings.json.bak` and `.harness-kit/ownership.json.bak` appear next to every rewritten target (writeJsonAtomic). Present in the final tree.
- Uninstall of owner-a left `hooks.PreToolUse` non-empty (owner-b's group), so the pre-D1 "emptied event array stays as `[]`" case did not materialize in this run.
- Serialization: 2-space JSON, LF, trailing newline — stable across all writes; the manual `spikeForeign` edit used the same format and round-tripped cleanly.

## Verdict

File-level coexistence model: **4 of 4 testable assertions PASS** (1, 4, 5 pass; 3
fails with a precisely-attributed, kit-documented pre-D1 semantics gap — entry set
preserved, byte order not). Runtime fire (assertions 2, 6): **unproven —
environment blocked** (claude unauthenticated), not a kit failure.

Per the runbook pass criteria, adoption is NOT fully unblocked by this run:
1. Re-run the runtime half after `claude /login` on this machine (scratch dir is
   preserved; resume at runbook step "Runtime fire").
2. File the assertion-3 byte-identity gap and the sidecar locator-drift false
   positive against the kit/registry before consumer adoption — both are
   pre-D1 semantics the concurrent kit work is expected to change; re-spike
   against the post-D1 snapshot.

## Artifact index

| File | Content |
|---|---|
| `kit-sha.txt` | frozen kit git HEAD + timestamp |
| `vendor-manifest.txt` | sha256 of every vendored kit file |
| `config-both.json` | settings.json after both installs (assertion 1) |
| `ownership-both.json` | sidecar after both installs |
| `claude-run1.txt` | claude -p output: auth failure, exit 1 |
| `claude-version.txt` | 2.1.163 |
| `claude-doctor.txt` | empty (doctor is TUI-only) |
| `env-blocked.md` | auth diagnostics + unblock path |
| `sha-run1-before.txt` / `sha-run1-after.txt` | claude did not rewrite settings.json |
| `sha-before.txt` / `sha-after.txt` / `sha-reinstall2.txt` | assertion 3: first reinstall differs, second is fixed point |
| `config-reinstalled.json` | post-reinstall order `[B,A]` |
| `ownership-reinstalled.json` | sidecar post-reinstall (owner-b drift) |
| `config-foreign.json` | assertion 4: spikeForeign + both owners |
| `config-uninstalled.json` | assertion 5: owner-a stripped |
| `ownership-uninstalled.json` | sidecar post-uninstall |
| `sha-final.txt` | end-state config sha |
| `log-counts.txt` | log line counts: before-run1 / after-run1 / final-state |
