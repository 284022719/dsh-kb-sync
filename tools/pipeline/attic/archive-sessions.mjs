// Archive a list of session ids (hides them from the sidebar) — used to retire
// throwaway seed sessions whose in-memory copy the host will not re-read.
//
//   node archive-sessions.mjs <manifest.json> [...more manifests]
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const H = 'http://127.0.0.1:3080';
const rpc = async (m, p = {}) =>
  (await fetch(`${H}/api/${m}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: m, payload: p }),
  })).json();

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node archive-sessions.mjs <manifest.json> [...]');
  process.exit(2);
}
const ids = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).sessions.map((s) => s.id));
console.log(`archiving ${ids.length} session ids`);
let ok = 0;
for (const id of ids) {
  const r = await rpc('workspace.archiveSession', { sessionId: id });
  if (r.result?.ok) ok++;
  else console.log(`  FAIL ${id}: ${JSON.stringify(r).slice(0, 160)}`);
}
console.log(`archived ${ok}/${ids.length}`);

const list = await rpc('session.list');
const visible = list.result.value.items.filter((i) => ids.includes(i.sessionId));
console.log(`still visible in session.list: ${visible.length}`);
