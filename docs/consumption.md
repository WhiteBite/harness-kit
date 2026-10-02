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

## Migration rules (strangler)

- Each consumer migrates behind its existing install test suite, plus a golden byte-diff gate: snapshot every config file the installer writes before the migration, run it after, require an empty diff.
- Migrated hook entries must keep their legacy command substrings (`--pre-tool`, `src/cli.ts ... --harness <name>`) so a not-yet-migrated tool still recognizes its own entries.
- Adoption order: repo-aeo (smallest installer) → stop-ai-slop → dejavu-gates (whose install-config is the kit's spiritual source, so its migration is mostly deletion).
