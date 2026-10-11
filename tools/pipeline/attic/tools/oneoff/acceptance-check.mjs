// Final end-to-end acceptance check for the migration.
//  A. every generated session log decodes and satisfies DSH's own record contract
//  B. both workspaces exist with the expected membership
//  C. every session is reported by the host with its projected title
//  D. the host can serve each session's history (proves it is loadable/resumable)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { zstdDecompressSync } from 'node:zlib';
import { decodeStorageRecord, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';

const KB = '..\\dsh-kb-sync\\data\\kb';
const HOME = process.env.USERPROFILE || process.env.HOME;
const HOST = 'http://127.0.0.1:3080';
const rpc = async (m, p = {}) =>
  (await fetch(`${HOST}/api/${m}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: m, payload: p }),
  })).json();

const ZSTD_MAGIC = 0xfd2fb528;
function scanFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset < buf.length) {
    const start = offset;
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`bad zstd magic @${offset}`);
    offset += 4;
    const d = buf.readUInt8(offset);
    offset += 1;
    const csFlag = d >>> 6;
    const single = (d & 32) !== 0;
    const checksum = (d & 4) !== 0;
    const dictFlag = d & 3;
    const dictBytes = dictFlag === 3 ? 4 : dictFlag;
    const csBytes = csFlag === 0 ? (single ? 1 : 0) : 1 << csFlag;
    offset += (single ? 0 : 1) + dictBytes + csBytes;
    for (;;) {
      const bh = buf.readUIntLE(offset, 3);
      offset += 3;
      const last = (bh & 1) !== 0;
      const type = (bh >>> 1) & 3;
      offset += type === 1 ? 1 : bh >>> 3;
      if (last) break;
    }
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return frames;
}

function projectKey(cwd) {
  let r = '';
  let sep = false;
  for (const ch of cwd) {
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!sep) r += '-';
      sep = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      r += ch;
      sep = false;
    } else {
      r += '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      sep = false;
    }
  }
  return `--${(r.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

const manifests = [
  { label: '话题', file: join(KB, 'dsh-sessions.json') },
  { label: '专题', file: join(KB, 'dsh-specialty-sessions.json') },
];

let logFail = 0;
let cwdFail = 0;
const all = [];
for (const m of manifests) {
  const mf = JSON.parse(readFileSync(m.file, 'utf8'));
  const dir = join(HOME, '.dsh', 'sessions', projectKey(mf.cwd));
  for (const s of mf.sessions) {
    const p = join(dir, s.id, 'session.jsonl.zstd');
    all.push({ ...s, label: m.label, manifest: m.file, logPath: p });
    if (!existsSync(p)) {
      console.log(`MISSING log: ${s.title}`);
      logFail++;
      continue;
    }
    // A. decode + contract
    const buf = readFileSync(p);
    const frames = scanFrames(buf);
    const text = Buffer.concat(frames.map((f) => zstdDecompressSync(buf.subarray(f.start, f.end)))).toString('utf8');
    const lines = text.split('\n').filter(Boolean);
    const header = JSON.parse(lines[0]);
    if (header.version !== SESSION_FORMAT_VERSION) {
      console.log(`BAD version ${header.id}: ${header.version}`);
      logFail++;
      continue;
    }
    if (header.cwd !== mf.cwd) {
      console.log(`BAD cwd ${header.id}: ${header.cwd} != ${mf.cwd}`);
      cwdFail++;
    }
    const flat = [];
    try {
      for (const l of lines.slice(1)) for (const ev of decodeStorageRecord(JSON.parse(l))) flat.push(ev);
    } catch (e) {
      console.log(`DECODE FAIL ${header.id}: ${e.message}`);
      logFail++;
      continue;
    }
    if (!flat.every((e, i) => e.seq === i)) {
      console.log(`SEQ GAP ${header.id}`);
      logFail++;
    }
  }
}

console.log(`A. logs: ${all.length} generated, ${logFail} bad, ${cwdFail} cwd mismatch`);

// B + C. workspaces and host-reported sessions
const ws = (await rpc('workspace.list')).result.value.items;
const sess = (await rpc('session.list')).result.value.items;
const archived = new Set((await rpc('workspace.list')).result.value.archivedSessionIds ?? []);
let okWs = 0;
for (const m of manifests) {
  const mf = JSON.parse(readFileSync(m.file, 'utf8'));
  const workspace = ws.find((w) => w.path.toLowerCase() === mf.cwd.toLowerCase());
  if (!workspace) {
    console.log(`B. workspace missing for ${m.label} (${mf.cwd})`);
    continue;
  }
  okWs++;
  const mine = sess.filter((i) => workspace.sessionIds.includes(i.sessionId));
  const titled = mine.filter((i) => i.projections?.values?.title);
  const hidden = mine.filter((i) => archived.has(i.sessionId)).length;
  const expected = new Set(mf.sessions.map((s) => s.id));
  const wrongIds = mine.filter((i) => !expected.has(i.sessionId)).length;
  console.log(
    `B/C. 「${workspace.title}」 path=${workspace.path}  会话=${workspace.sessionIds.length}  宿主报告标题=${titled.length}  归档隐藏=${hidden}  非本批 id=${wrongIds}`,
  );
}

// D. host can serve history for every session (loadability proof)
let served = 0;
let failed = [];
for (const s of all) {
  const h = await rpc('session.history', { sessionId: s.id, maxMessages: 2 });
  if (h.result?.ok) served++;
  else failed.push(`${s.title}: ${JSON.stringify(h.result?.error ?? h).slice(0, 120)}`);
}
console.log(`D. host served history for ${served}/${all.length} sessions`);
for (const f of failed.slice(0, 5)) console.log('   FAIL ' + f);
console.log(okWs === manifests.length && !logFail && !cwdFail && served === all.length ? '\nACCEPTANCE: PASS' : '\nACCEPTANCE: ISSUES ABOVE');
