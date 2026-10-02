import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const [label] = process.argv.slice(2);
const count = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length : 0);
const line = `${label}: owner-a.log=${count('owner-a.log')} owner-b.log=${count('owner-b.log')}`;
appendFileSync('artifacts/log-counts.txt', `${line}\n`);
console.log(line);
