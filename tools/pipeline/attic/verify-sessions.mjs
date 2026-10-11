// Verify the migrated knowledge-base sessions as the DSH host sees them.
import { randomUUID } from 'node:crypto';
const HOST = 'http://127.0.0.1:3080';
async function rpc(method, payload = {}) {
  const res = await fetch(`${HOST}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }),
  });
  return res.json();
}
const ws = await rpc('workspace.list');
const kb = ws.result.value.items.find((w) => w.path.toLowerCase().includes('knowledge-base'));
console.log(`workspace: ${kb.workspaceId}  path=${kb.path}  title=${kb.title}  sessionIds=${kb.sessionIds.length}`);

const list = await rpc('session.list');
const items = list.result.value.items;
console.log(`host sessions total: ${items.length}`);

const ids = new Set(kb.sessionIds);
const mine = items.filter((i) => ids.has(i.sessionId));
console.log(`of those, present in the host list: ${mine.length}/${kb.sessionIds.length}`);

const titleOf = (i) => i.projections?.values?.title ?? i.title ?? '(no title in projection)';
console.log('\n| sessionId | cwd | title | asOfSeq |');
for (const i of mine.sort((a, b) => String(titleOf(a)).localeCompare(String(titleOf(b)))))
  console.log(`| ${i.sessionId.slice(0, 20)}… | ${i.cwd} | ${titleOf(i)} | ${i.projections?.asOfSeq ?? '-'} |`);

const wt = mine.filter((i) => String(titleOf(i)).includes('知识库')).length;
console.log(`\ntitles carrying 【知识库】: ${wt}/${mine.length}`);
const missingTitles = mine.filter((i) => !i.projections?.values?.title);
console.log(`sessions without a projected title: ${missingTitles.length}`);
if (missingTitles.length) console.log('  (cold rows fall back to the workspace/folder name until the session is opened)');
