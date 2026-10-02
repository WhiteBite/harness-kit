# Runtime coexistence spike (Phase 0b)

Purpose: prove at runtime what the test suite proves at file level — two independent owners' hooks coexist in one harness config, both fire, and neither installer clobbers the other.

Target harnesses: **Codex CLI** (`.codex/hooks.json`) and **Devin CLI** (`.devin/hooks.v1.json`) — the known conflict sites where two family tools wrote the same file with different identity markers. Substitute **Claude Code** (`.claude/settings.json`) when Devin access is unavailable; for Devin note it also auto-imports `.claude/settings.json` hooks, so a Claude run partially covers it.

## Setup

1. Scratch repo (project scope only — no global config is touched):

```bash
mkdir hk-spike && cd hk-spike && git init
```

2. Two fake owners — logger scripts standing in for real tools:

```js
// owner-a.mjs — stands in for a write-time gate
import { appendFileSync } from 'node:fs';
appendFileSync(new URL('./owner-a.log', import.meta.url), `fired ${Date.now()}\n`);
process.exit(0);
```

```js
// owner-b.mjs — stands in for an error-gate
import { appendFileSync } from 'node:fs';
appendFileSync(new URL('./owner-b.log', import.meta.url), `fired ${Date.now()}\n`);
process.exit(0);
```

3. Install both owners through the kit (one `install.mjs`, run twice with different owner ids):

```js
import { mergeHooks, readJsonConfig, writeJsonAtomic, recordOwnership } from './vendor/harness-kit/src/index.mjs';

const [owner, command, marker] = process.argv.slice(2);
const path = '.codex/hooks.json';
const template = { hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command, timeout: 30 }] }] } };
const isMine = (c) => typeof c === 'string' && c.includes(marker);

const existing = readJsonConfig(path) || {};
const merged = mergeHooks(existing, template, { shape: 'nested-hooks', isMine });
writeJsonAtomic(path, merged);
recordOwnership('.', owner, path, merged, [['hooks', 'PreToolUse', merged.hooks.PreToolUse.length - 1]]);
console.log(`${owner} installed`);
```

```bash
node install.mjs owner-a "node <abs>/owner-a.mjs --pre-tool" "--pre-tool"
node install.mjs owner-b "node <abs>/owner-b.mjs --harness spike" "--harness spike"
```

## Assertions

- [ ] `.codex/hooks.json` contains both owners' entries (inspect by hand).
- [ ] Run the harness so it attempts a file write (e.g. `codex exec "create a file hello.txt containing hi"`): **both** `owner-a.log` and `owner-b.log` gain lines.
- [ ] Re-run owner-a's install → the entry SET is unchanged and owner-a's entries move to the end of each event array; a second re-run is byte-identical (fixed point). Compare sha256 across the second re-run, not the first.
- [ ] Out-of-band edit: add `"spikeForeign": true` to the config root → re-run owner-b's install → the foreign key survives.
- [ ] Uninstall owner-a (merge with an empty template `{ hooks: {} }` and its `isMine`) → owner-a entries gone, owner-b still fires on the next harness run.
- [ ] The harness logs no schema complaints about the merged file at any point.

## Pass criteria and follow-up

All boxes checked ⇒ the sidecar + owner-scoped merge model is runtime-proven at the hardest site; adoption phases (rdk → stop-ai-slop → dejavu) are unblocked. Any failure ⇒ freeze adoption, file the discrepancy against `registry/harnesses.json` (the row for that harness is wrong or incomplete) before touching consumers.

## Cleanup

Delete the scratch repo. No global state was modified; project-scope configs die with the directory.

## Run log

- 2026-10-02, Claude Code 2.1.163 substitution (codex/devin absent), kit frozen at e1b8f1b: file-level assertions 1/4/5 PASS; assertion 3 exposed the cross-owner reorder documented in coexistence.md rule 1 (set preserved, fixed point from the second application) and this runbook's assertion was corrected; runtime assertions 2/6 ENV-BLOCKED — the local claude install is unauthenticated (`claude -p` exits at the login gate before any tool use). Artifacts: `%TEMP%\opencode\hk-spike\artifacts\REPORT.md`. Runtime half remains open: authenticate claude (`claude /login`) and re-run from the preserved scratch, or re-target a harness with live auth.
