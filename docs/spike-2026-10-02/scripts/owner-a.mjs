import { appendFileSync } from 'node:fs';
appendFileSync(new URL('./owner-a.log', import.meta.url), `fired ${Date.now()}\n`);
process.exit(0);
