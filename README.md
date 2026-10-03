# harness-kit

**English** | [Русский](README.ru.md)

> One canonical registry and zero-dependency primitives for wiring AI coding harnesses — Claude Code, Codex CLI, OpenCode 1.x/2.x, Gemini CLI, Qwen, Cursor, Windsurf, Kiro, Devin, VS Code Copilot, Crush, Cline, Aider — so tools stop re-implementing config paths, merge semantics and symlink installs each their own way.

## Quickstart

```bash
npm install
npm test
npm run self-test
```

Zero runtime dependencies, Node >= 18, plain ESM (Bun-compatible). Published to npm as `@whitebite/harness-kit`; deep integrations still vendor the sources behind the sha256 manifest (see [docs/consumption.md](docs/consumption.md)).

## Who is it for

- Tool authors shipping hooks, skills or rules into AI coding agents who keep re-learning each harness's config dialect.
- Teams whose repos are touched by several such tools and whose hook configs clobber each other.
- Maintainers who want one reviewed source of truth for harness config paths instead of three drifting copies.

## Use cases

- Look up the canonical config path, hook shape, event names and timeout unit for any supported harness.
- Merge your hook entries into a shared config without touching another tool's entries (owner-scoped strip-then-append).
- Track which entries you own via a hashed sidecar manifest, immune to command-string drift.
- Write JSON configs atomically with validated backups, symlink refusal and Windows rename retries.
- Install agent skills into harness skill directories with safe state classification (never clobbers manual content).
- Render hook-config templates with full JSON escaping so Windows paths survive the round trip.
- Aggregate install health across surfaces with structured findings — config drift, marker-block rot, the git `core.hooksPath` — while formatting and exit policy stay consumer-side.

## Examples

### Merge into a shared Codex-style config

```js
import { mergeHooks } from './vendor/harness-kit/src/index.mjs';

const template = { hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node /abs/scan.mjs --pre-tool' }] }] } };
const isMine = (command) => typeof command === 'string' && command.includes('--pre-tool');

const merged = mergeHooks(existingConfig, template, { shape: 'nested-hooks', isMine });
// foreign entries survive; re-running the merge is byte-identical; an empty template uninstalls only your entries
```

### Record and verify ownership

```js
import { recordOwnership, ownedLocators, entryMatchesHash } from './vendor/harness-kit/src/index.mjs';

recordOwnership(repoRoot, 'my-tool', '.codex/hooks.json', merged, [['hooks', 'PreToolUse', 0]]);
const [record] = ownedLocators(repoRoot, 'my-tool', '.codex/hooks.json');
const intact = entryMatchesHash(currentConfig, record); // false after any out-of-band edit
```

### Doctor an install across surfaces

```js
import { checkInstall, resolveHooksDir, extractCliPath } from './vendor/harness-kit/src/index.mjs';

const hooksDir = resolveHooksDir(repoRoot); // null when .git is absent
const findings = checkInstall(repoRoot, {
  surfaces: [
    { id: 'codex', kind: 'hook-config', path: '.codex/hooks.json', shape: 'nested-hooks', identify: isMine },
    hooksDir === null ? null : {
      id: 'git',
      kind: 'marker-block',
      path: `${hooksDir}/pre-commit`,
      variant: 'shell-block',
      markerId: 'slop-gate',
      extract: (text) => extractCliPath(text, /node\s+"([^"]+)"\s+--staged/),
    },
  ].filter(Boolean),
});
// [{ surface: 'codex', status: 'ok', detail: null }, { surface: 'git', status: 'stale', detail: '/gone/scan.mjs' }]
```

## Why choose this

- **Registry as data.** `registry/harnesses.json` is a language-neutral contract with a JSON Schema: non-JS tools read the same facts JS tools do.
- **Owner-scoped merges.** Strip-then-append keyed by an ownership sidecar with sha256 entry hashes; command-substring matching is only a migration fallback. Foreign bytes survive by construction, and the two-owner coexistence spike is a committed test.
- **Six real config shapes, one primitive.** nested-hooks (Claude/Codex/Gemini/Qwen), root-events (Devin), versioned-flat (Cursor), versioned-typed (Copilot), flat-matcher (Crush), hooks-array (Kiro).
- **Zero dependencies, vendored consumption.** No runtime dependency and no npx in hot paths; consumers vendor the kit and verify it against a deterministic hash manifest.
- **Sabotage-tested.** `npm run self-test` validates the registry, fails on sabotage fixtures, tolerates unknown keys (forward compatibility) and sweeps two-owner coexistence across every mergeable registry row.

## Status

Phase 3: doctor aggregation — `checkInstall` findings over hook-config and marker-block surfaces, marker read-side, the git `core.hooksPath` resolver, caller-supplied CLI-path extraction — atop Phase 2's canonical registry (14 harness rows reconciled from three independent implementations), merge/ownership/atomic/template/symlink/marker-block/drift primitives, test suite, self-test and hash manifest. Adopted by the family tools — repo-aeo (skill symlinks), stop-ai-slop (hooks, rules, pre-commit) and dejavu-gates (merges, templates, drift) each vendor the kit behind a sha256 sync-check and a golden byte-diff gate; see [docs/consumption.md](docs/consumption.md) and [docs/coexistence.md](docs/coexistence.md).

## License

MIT — see [LICENSE](LICENSE).
