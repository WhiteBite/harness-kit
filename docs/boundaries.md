# Product boundaries

harness-kit is the **install substrate**: it answers "how do I write byte X into harness Y's config file safely?". It is not a harness, not a plugin runtime, and not a marketplace.

## In scope

- Registry facts: config paths, hook dialects/shapes, write modes, events, skills dirs, MCP client dialects.
- Owner-scoped merges that preserve foreign bytes; marker blocks; atomic JSON writes; skill-dir symlinking; install/drift checks.
- Language-neutral data: the registry and its schema are JSON, consumable from any language, pinned by tag.

## Out of scope (deliberate)

| Area | Why excluded |
| --- | --- |
| Capability-pack / bundle abstraction | Fast-moving layer; the kit wires files, it does not define a bundle format. |
| Marketplace / repository consumption | A consumer parameter (which catalog, which scope), never a registry column. |
| Plugin-API versioning | Host plugin APIs churn; the kit only touches on-disk config. |
| Non-JSON config *writing* (TOML, JSONC) | Zero-dep implies no parsers; such targets are `write: "print-only"`. |
| Command-dir install | No live consumer in the family today; `skills` + `linkDir` cover the real case. |
| Plugin-manifest read/write | Manifests are static repo artifacts; no runtime consumer. |
| Runtime harness behavior | The kit never runs inside a harness; install/build-time only. |
| Registry server / HTTP API | Static JSON pinned by tag is enough and cacheable. |
| Parsing `notes` fields | Human-only by contract (registry/AGENTS.md). |

## Known limitations

- `mergeHooks` strips by the caller's `isMine(command)` predicate. A SUBSTRING predicate can delete a foreign entry whose command merely contains the substring; use exact command equality or the ownership sidecar (`readOwnership`/`entryMatchesHash`). The kit cannot tell a substring predicate from an exact one.
- For `root-events`, stripping runs over every top-level array, so a foreign non-event top-level array whose entries carry a matching command can be stripped (rare; restricting to declared `events` is a future option).
- `canonicalJson` recurses per nesting level, so a pathologically deep config can overflow the stack (install-time, and only on untrusted input).
- `resolveHooksDir` returns git's `core.hooksPath` unvalidated; the resulting write is still guarded by the symlink-component refusal, but the path is not contained to the repo.

## Growth rule

Grow only under a live consumer: one shape + a sabotage test + a MINOR `registryVersion` bump + `status: "experimental"` for unverified facts (see docs/dialects.md). New keys are additive. MAJOR is reserved for STRUCTURAL breaks — a key removed, renamed, or given a new meaning, which breaks consumer code. A fact VALUE change (path, write, shape, events, container) is MINOR: consumer code does not change, and the lockfile/`diff` surfaces it (see registry/CHANGELOG.md).
