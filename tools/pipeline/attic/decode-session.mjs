// Decode a DSH session log (concatenated zstd frames of JSONL) into readable JSONL.
// Usage: node decode-session.mjs <path-to-session.jsonl.zstd> [--raw out.jsonl] [--only-types]
import { readFileSync, writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const ZSTD_MAGIC = 0xfd2fb528;

/** Split a concatenated-frame zstd container into complete frame ranges. */
function scanFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset < buf.length) {
    const start = offset;
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`bad zstd magic at byte ${offset}`);
    offset += 4;
    const descriptor = buf.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictFlag = descriptor & 3;
    const dictBytes = dictFlag === 3 ? 4 : dictFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    offset += (singleSegment ? 0 : 1) + dictBytes + contentSizeBytes;
    for (;;) {
      const blockHeader = buf.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`reserved block type at ${offset}`);
      offset += blockType === 1 ? 1 : blockSize;
      if (lastBlock) break;
    }
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return frames;
}

function decode(path) {
  const buf = readFileSync(path);
  const frames = scanFrames(buf);
  const parts = frames.map((f) => zstdDecompressSync(buf.subarray(f.start, f.end)));
  return { frames: frames.length, text: Buffer.concat(parts).toString('utf8') };
}

const [, , path, ...rest] = process.argv;
if (!path) {
  console.error('usage: node decode-session.mjs <session.jsonl.zstd> [--raw out.jsonl]');
  process.exit(2);
}
const rawIndex = rest.indexOf('--raw');
const { frames, text } = decode(path);
const lines = text.split('\n').filter((l) => l.length > 0);

console.log(`frames=${frames} lines=${lines.length}`);
console.log('--- HEADER ---');
console.log(lines[0]);
if (rest.includes('--only-types')) {
  const types = {};
  for (const line of lines.slice(1)) {
    try {
      const r = JSON.parse(line);
      const arr = Array.isArray(r) ? r : [r];
      for (const e of arr) types[e.type] = (types[e.type] ?? 0) + 1;
    } catch {
      types['<unparsable>'] = (types['<unparsable>'] ?? 0) + 1;
    }
  }
  console.log('--- event types ---');
  console.log(JSON.stringify(types, null, 2));
  process.exit(0);
}
console.log('--- first records ---');
for (const line of lines.slice(1, 8)) {
  console.log(line.slice(0, 1500));
  console.log('  ·');
}
if (rawIndex !== -1 && rest[rawIndex + 1]) {
  writeFileSync(rest[rawIndex + 1], text);
  console.log('wrote', rest[rawIndex + 1]);
}
