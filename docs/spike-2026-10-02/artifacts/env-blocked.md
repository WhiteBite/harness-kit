# Env-blocked: Claude Code not authenticated

## What happened

The runtime fire test (assertions 2 and 6) cannot run on this machine. The first
and only `claude -p` invocation failed at the auth gate before any tool use:

```
& S:\ClaudeCode\claude.exe -p --dangerously-skip-permissions "create a file hello.txt containing hi"
```

Output (full capture in `artifacts/claude-run1.txt`):

```
Not logged in · Please run /login
exit code: 1
```

## Diagnostics

- `claude --version` → `2.1.163 (Claude Code)` (captured in `artifacts/claude-version.txt`)
- No `ANTHROPIC_*` or `CLAUDE_*` environment variables are set (no `ANTHROPIC_API_KEY`).
- `%USERPROFILE%\.claude\.credentials.json` exists but contains `{}` (2 bytes) — no stored OAuth credentials.
- `%USERPROFILE%\.claude.json` top-level keys: `opusProMigrationComplete, sonnet1m45MigrationComplete, seenNotifications, migrationVersion, firstStartTime, userID` — no auth material.
- `claude doctor` is an interactive TUI; in a non-TTY shell it produced zero output and was killed after 60 s (`artifacts/claude-doctor.txt`, 0 bytes).
- Claude did NOT modify `.claude/settings.json` during the failed run: sha256 before run 1 = sha256 after run 1 = `26b031e25989c93a997a94254181c2207bdcdacbc8797a0c72ca30965068257e` (`artifacts/sha-run1-before.txt`, `artifacts/sha-run1-after.txt`).
- Hook logs stayed at 0 lines (`artifacts/log-counts.txt`: `after-run1: owner-a.log=0 owner-b.log=0`) — claude exited before tool use, so no hook execution was possible.

## Consequence

- Assertions 2 and 6 (runtime hook fire, post-uninstall runtime fire) are ENV-BLOCKED, not failed: the merge/config layer is exercised, but "both hooks fire at runtime" is unproven on this machine.
- Claude invocation budget: 1 of 3 used; no further invocations attempted (auth cannot be fixed without user credentials, which are not available in this environment).
- File-level assertions 1, 3, 4, 5 were completed without claude and are reported in `artifacts/REPORT.md`.

## Unblock

Run `claude /login` (or set `ANTHROPIC_API_KEY`) on this machine, then re-run the
spike from step 5 of the runbook. The scratch dir is preserved untouched.
