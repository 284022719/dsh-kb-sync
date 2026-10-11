// Enumerate every /api/v0 endpoint referenced by the SPA bundle.
import { readdirSync, readFileSync } from 'node:fs';
const f = readdirSync('bundle').find((x) => x.startsWith('main.'));
const s = readFileSync('bundle/' + f, 'utf8');
const set = new Map();
const re = /["'`](\/api\/v0\/[A-Za-z0-9_/\-{}.$]+)["'`]/g;
for (const m of s.matchAll(re)) if (!set.has(m[1])) set.set(m[1], 0);
console.log('endpoints:', set.size);
for (const p of [...set.keys()].sort()) console.log('  ' + p);

// also: any absolute http calls to other hosts that look like api
const hosts = new Set();
for (const m of s.matchAll(/https?:\/\/[a-z0-9.\-]*deepseek\.com[A-Za-z0-9_/\-.]*/gi)) hosts.add(m[1]);
console.log('\nhosts/urls:');
for (const h of [...hosts].sort()) console.log('  ' + h);
