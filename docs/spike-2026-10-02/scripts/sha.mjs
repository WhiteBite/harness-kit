import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [file, out] = process.argv.slice(2);
const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
if (out) writeFileSync(out, `${sha}\n`);
console.log(sha);
