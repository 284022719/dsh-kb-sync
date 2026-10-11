// Inspect the `mapping` node tree of exported conversations.
import { readFileSync } from 'node:fs';
const convs = JSON.parse(readFileSync('raw/conversations.json', 'utf8'));
console.log('conversations:', convs.length);

// find a conversation with a decent number of nodes
const withNodes = convs
  .map((c) => ({ c, n: c.mapping ? Object.keys(c.mapping).length : 0 }))
  .filter((x) => x.n > 0);
console.log('conversations with mapping nodes:', withNodes.length);
const target = withNodes.sort((a, b) => b.n - a.n)[0];
console.log(`largest: "${target.c.title}" nodes=${target.n} updated=${target.c.updated_at}`);

const nodes = Object.entries(target.c.mapping);
const [nid, node] = nodes[0];
console.log('\n--- node entry ---');
console.log('node id:', nid);
console.log('node keys:', Object.keys(node).join(', '));
console.log(JSON.stringify(node, null, 1).slice(0, 1500));

const kinds = {};
for (const [, n] of nodes) {
  const k = n.message ? (n.message.role ?? 'norole') : 'no-message';
  kinds[k] = (kinds[k] ?? 0) + 1;
}
console.log('\nnode kinds:', JSON.stringify(kinds));

// find a user + assistant message node and print shapes
for (const role of ['user', 'assistant']) {
  const found = nodes.find(([, n]) => n.message?.role === role);
  if (!found) continue;
  const m = found[1].message;
  console.log(`\n--- ${role} message keys ---`);
  console.log(Object.keys(m).join(', '));
  console.log(JSON.stringify(m, null, 1).slice(0, 1400));
}

// content-type histogram across a sample of conversations
const ct = {};
let msgCount = 0;
for (const c of convs.slice(0, 200)) {
  for (const n of Object.values(c.mapping ?? {})) {
    const m = n.message;
    if (!m) continue;
    msgCount++;
    const t = typeof m.content === 'string' ? 'string' : (m.content?.content_type ?? typeof m.content);
    ct[`${m.role}/${t}`] = (ct[`${m.role}/${t}`] ?? 0) + 1;
  }
}
console.log(`\ncontent-type histogram over first 200 convs (${msgCount} messages):`);
console.log(JSON.stringify(ct, null, 1));
