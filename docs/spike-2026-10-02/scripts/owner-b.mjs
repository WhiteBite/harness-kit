import { appendFileSync } from 'node:fs';
appendFileSync(new URL('./owner-b.log', import.meta.url), `fired ${Date.now()}\n`);
process.exit(0);
