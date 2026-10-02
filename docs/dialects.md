# Hook-config dialects

Six JSON shapes observed in the wild (registry `hooks.shape`):

| Shape | Container | Entry form | Harnesses |
| --- | --- | --- | --- |
| `nested-hooks` | `hooks.<Event>[]` | `{matcher?, hooks:[{type,command,timeout?}]}` | claude, codex, gemini, qwen |
| `root-events` | `<Event>[]` at config root | `{matcher?, hooks:[{type,command,timeout?}]}` | devin |
| `versioned-flat` | `hooks.<event>[]` + `version:1` | `{command, timeout?}` | cursor |
| `versioned-typed` | `hooks.<event>[]` + `version:1` | `{type, command, timeoutSec?}` | copilot |
| `flat-matcher` | `hooks.<Event>[]` | `{matcher, command}` | crush |
| `hooks-array` | `hooks[]` + `version:"v1"` | `{name, trigger, matcher, action:{type,command}, timeout?}` | kiro |

Event names and timeout units differ per harness and are registry facts (`events`, `entryFields.timeoutUnit`): PascalCase `PreToolUse` (Claude dialect), `BeforeTool`/`AfterTool` with millisecond timeouts (Gemini), camelCase `preToolUse` (Cursor/Copilot), `timeoutSec` (Copilot), `trigger` fields inside an array (Kiro).

`mergeHooks` strips own entries via a single command extraction that covers all six shapes: `entry.command`, `entry.action.command`, and every `entry.hooks[].command`. Mixed groups lose only own leaves; emptied own groups drop; foreign entries and unknown top-level keys survive untouched.

Templates are supplied in the target shape's native carrier: `{hooks:{Event:[entries]}}` for container shapes, `{Event:[entries]}` for root-events, `{version, hooks:[entries]}` for hooks-array.

## Adding a harness

1. Add a row to `registry/harnesses.json`: name, status, `hooks.config` paths, write mode, shape, events, timeoutUnit, `envOverrides` where the harness documents them.
2. Facts only — verified against the harness's real behavior. Unverified rows get `status: "experimental"` plus a note naming what to verify.
3. Bump `registryVersion` (MINOR for a new row) and add a `registry/CHANGELOG.md` entry.
4. `npm run self-test` — the coexistence sweep automatically covers new `write: "merge"` rows.
5. `npm run manifest` and commit it in the same change.

## Changing a shape

MAJOR `registryVersion` bump when a key is renamed, removed, or changes meaning. Keys are never deleted — deprecate in place; vendored consumers pin the version they validated against.
