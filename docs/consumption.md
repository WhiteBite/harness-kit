# Consuming harness-kit

The kit is vendored, not depended on: every consumer ships a pinned copy and proves it is unmodified. This keeps all consumers zero-runtime-dependency and keeps hook hot paths free of npx.

## 1. Vendor

Copy these items into `vendor/harness-kit/` of the consumer repo:

- `src/`
- `registry/`
- `types/` (TS/Bun consumers)
- `manifest.json`

## 2. Sync-check (required)

Add a check to the consumer's self-test suite that recomputes sha256 of every vendored file (content EOL-normalized to LF) and compares against `manifest.json`. Any mismatch fails the suite: vendored copies are read-only; changes go upstream to the kit, then re-vendor.

```js
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('vendor/harness-kit/manifest.json', 'utf8'));
for (const [rel, sha] of Object.entries(manifest.files)) {
  const content = readFileSync(`vendor/harness-kit/${rel}`, 'utf8').replace(/\r\n/g, '\n');
  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== sha) throw new Error(`vendored file drifted from harness-kit ${manifest.kitVersion}: ${rel}`);
}
```

## 3. Upgrade

Re-copy the four vendored items from the kit version being adopted, in one commit. `manifest.kitVersion` and `manifest.registryVersion` pin exactly what was vendored.

## 4. Files left in the target tree

`writeJsonAtomic` rotates a `<file>.bak` copy of every existing config it replaces, and `recordOwnership` writes `.harness-kit/ownership.json` at the target root. Consumers decide gitignore policy for `*.bak` and `.harness-kit/`.

## Migration rules (strangler)

- Each consumer migrates behind its existing install test suite, plus a golden byte-diff gate: snapshot every config file the installer writes before the migration, run it after, require an empty diff.
- Migrated hook entries must keep their legacy command substrings (`--pre-tool`, `src/cli.ts ... --harness <name>`) so a not-yet-migrated tool still recognizes its own entries.
- Adoption order: repo-aeo (smallest installer) → stop-ai-slop → dejavu-gates (whose install-config is the kit's spiritual source, so its migration is mostly deletion).

## 5. CLI

The kit ships a zero-dep CLI so vendoring and the sync-check are one command:

```bash
npx @whitebite/harness-kit versions                    # kit + registry versions
npx @whitebite/harness-kit vendor vendor/harness-kit   # copy the pinned kit, then verify
npx @whitebite/harness-kit check vendor/harness-kit    # recompute manifest hashes, fail on drift
```

`vendor` refuses to overwrite a directory that is not a harness-kit copy (no `manifest.json`).

## 6. Language-neutral consumption (any language)

The registry and schema are plain JSON, so a non-JS consumer needs no npm or node - pin an immutable tag:

- `https://raw.githubusercontent.com/WhiteBite/harness-kit/vX.Y.Z/registry/harnesses.json`
- `https://raw.githubusercontent.com/WhiteBite/harness-kit/vX.Y.Z/registry/harnesses.schema.json`

Verify the fetched file against the sha256 in `manifest.json` (`files["registry/harnesses.json"]`) before trusting it. Tags are immutable; `main` is not a pin.
