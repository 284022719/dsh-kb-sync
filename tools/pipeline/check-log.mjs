// 判断某个阶段的输出日志里有没有"真正完成"的标记。
//
//   node sync/check-log.mjs <logfile> <stageKey>
//   exit 0 = 找到标记（该阶段其实成功了）    exit 1 = 没找到
//
// 为什么需要它：
//   Node 在 Windows 上退出时可能因 libuv 断言
//   （"Assertion failed: ... uv async.c"）以 0xC0000409 硬崩，退出码变成非 0 ——
//   而崩溃发生在**工作完成之后**。只看退出码会把成功报成失败，弹出错误告警
//   （比如"Token 可能已过期"，而其实抓取好好的）。
//
// 为什么标记表放在这里而不是 .cmd 里：
//   .cmd 由 cmd.exe 按 GBK 解码，里面写中文会乱码。所以 .cmd 只传 ASCII 的 stage key，
//   中文标记留在本文件里。
import { readFileSync, existsSync } from 'node:fs';

const MARKERS = {
  // recon-update.mjs 成功时一定会打印这行汇总
  recon: ['新增（本地没有）'],
  // update-from-api.mjs：有变化时以 "=== 完成 ===" 收尾；无变化时打印下面这句
  update: ['=== 完成 ===', '没有需要更新的内容'],
  // apply-extraction.mjs 全部校验通过时打印
  apply: ['全部校验通过'],
  // prep-inbox.mjs 正常收尾
  inbox: ['输出目录（待 headless 填写）', '收件箱已准备'],
  // 鉴权失败标记（ASCII，由 auth-marker.mjs 打印）。
  // 命中它才能理直气壮地说「Token 过期」；否则只能说「抓取失败」。
  reconAuth: ['AUTH_UNAUTHORIZED'],
  updateAuth: ['AUTH_UNAUTHORIZED'],
};

const [logPath, stage] = process.argv.slice(2);
if (!logPath || !stage) {
  console.error('用法: node check-log.mjs <logfile> <recon|update|apply|inbox|reconAuth|updateAuth>');
  process.exit(1);
}
const keys = MARKERS[stage];
if (!keys) {
  console.error(`未知阶段: ${stage}（可用：${Object.keys(MARKERS).join(' / ')}）`);
  process.exit(1);
}
if (!existsSync(logPath)) process.exit(1);

const text = readFileSync(logPath, 'utf8');
const hit = keys.find((k) => text.includes(k));
if (hit) {
  console.log(`标记命中（${stage}）：${hit}`);
  process.exitCode = 0;
} else {
  console.log(`标记未命中（${stage}），期望之一：${keys.join(' / ')}`);
  process.exitCode = 1;
}
