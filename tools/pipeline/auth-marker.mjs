// 鉴权失败判定：把「真的没授权」和「其它原因的失败」区分开。
//
// 为什么需要它：
//   sync-daily.cmd 原来的逻辑是「recon 退出码非 0 且找不到成功标记 → 判定 Token 过期」。
//   这是个猜测：任何非鉴权原因的失败（网络抖动、接口改版、限流）都会被报成
//   “Token 可能已过期”，把你引向错误的排查方向。
//
// 用法：
//   抓到响应后调用 classifyAuth(res, json)，命中则打印 AUTH_MARKER 自身，
//   再由 sync/check-log.mjs 按 AUTH_MARKER 匹配出准确结论。
//
// 注意：标记串是 ASCII，因为它要出现在 .cmd 间接读取的日志里。

export const AUTH_MARKER = 'AUTH_UNAUTHORIZED';

/** DeepSeek 网页端未授权时常见的业务码（见 chat.deepseek.com api/v0 的返回）。 */
const AUTH_CODES = new Set([40001, 40002, 40003, 40100, 40101]);

/** HTTP 状态与文案的双重判据，任一命中即认为是鉴权问题。 */
export function classifyAuth(res, json) {
  const status = res?.status ?? 0;
  if (status === 401 || status === 403) return true;

  const code = Number(json?.code ?? json?.data?.code ?? NaN);
  if (Number.isFinite(code) && AUTH_CODES.has(code)) return true;

  const msg = String(json?.msg ?? json?.message ?? json?.data?.msg ?? '');
  return /auth|unauthor|forbidden|token|login|credential|未授权|登录|令牌/i.test(msg);
}

/**
 * 失败时统一出口：鉴权问题打印 ASCII 标记，其它问题打印原始响应片段。
 * @returns {never} 调用方负责 process.exit
 */
export function reportFetchFailure(res, json, label) {
  const detail = `HTTP ${res?.status ?? '?'} :: ${JSON.stringify(json).slice(0, 280)}`;
  if (classifyAuth(res, json)) {
    console.log(AUTH_MARKER);
    console.log(`${label} 鉴权失败 → ${detail}`);
  } else {
    console.log(`${label} 拉取失败（非鉴权）→ ${detail}`);
  }
}
