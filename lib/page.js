/**
 * The same-origin control page served by the host half.
 *
 * Deliberately dependency-free: one HTML document, inline CSS and inline JS,
 * no external requests. The client script only talks to the plugin's own
 * routes (relative URLs), and mutating calls carry the `x-dsh-kb-sync` header
 * the host guard requires — a cross-site form cannot set a custom header.
 *
 * @module dsh-kb-sync/page
 */

/** Escape a string for safe interpolation into an HTML text/attribute slot. */
function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Render the control page.
 * @param {object} input - render input.
 * @param {string} input.prefix - route prefix owned by the plugin (e.g. `/__dsh-kb-sync`).
 * @param {string} input.configured - human-readable配置状态 line shown before the first fetch.
 * @returns {string} the complete HTML document.
 */
export function renderPage({ prefix, configured }) {
  const p = esc(prefix)
  const boot = esc(configured)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>dsh-kb-sync 控制页</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; padding: 24px; max-width: 980px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { opacity: .7; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 16px 0; }
  button { font: inherit; padding: 7px 14px; border-radius: 8px; border: 1px solid rgba(128,128,128,.5); background: transparent; cursor: pointer; }
  button:hover { background: rgba(128,128,128,.15); }
  button[disabled] { opacity: .5; cursor: default; }
  .card { border: 1px solid rgba(128,128,128,.35); border-radius: 10px; padding: 12px 14px; margin: 12px 0; }
  .card h2 { font-size: 14px; margin: 0 0 8px; }
  pre { margin: 0; padding: 10px; overflow: auto; max-height: 320px; border-radius: 8px; background: rgba(128,128,128,.12); font: 12px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; border: 1px solid rgba(128,128,128,.5); }
  .pill.ok { border-color: #2e9e5b; color: #2e9e5b; }
  .pill.warn { border-color: #d08b00; color: #d08b00; }
  .pill.bad { border-color: #cf3f3f; color: #cf3f3f; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0; }
  dt { opacity: .7; }
  dd { margin: 0; word-break: break-all; }
</style>
</head>
<body>
<h1>dsh-kb-sync</h1>
<p class="muted">编排已有的同步流水线：运行、看状态、看日志、跑知识库体检。<b>本插件自身不读凭据、不出网</b>——token 与出网都在被调用的脚本里。</p>
<p class="muted" id="boot">${boot}</p>

<div class="row">
  <button id="refresh">刷新状态</button>
  <button id="run">运行同步</button>
  <button id="doctor">跑知识库体检</button>
  <span class="muted" id="hint"></span>
</div>

<div class="card">
  <h2>状态</h2>
  <dl id="status"><dt>—</dt><dd>正在读取…</dd></dl>
</div>

<div class="card">
  <h2>最近日志</h2>
  <pre id="log">—</pre>
</div>

<div class="card">
  <h2>知识库体检（kb.mjs doctor）</h2>
  <pre id="doctorOut">未运行</pre>
</div>

<script>
(function () {
  var PREFIX = ${JSON.stringify(prefix)};
  var MAGIC = { 'x-dsh-kb-sync': '1', 'content-type': 'application/json' };
  var timer = null;

  function el(id) { return document.getElementById(id); }
  function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function pill(ok, text) { return '<span class="pill ' + (ok ? 'ok' : 'bad') + '">' + esc(text) + '</span>'; }

  function renderStatus(s) {
    var rows = [];
    function add(k, v) { rows.push('<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'); }
    add('配置', s.configured ? pill(true, '已就绪') : pill(false, '未配置'));
    if (s.message) add('说明', esc(s.message));
    add('root', esc(s.paths && s.paths.root || '—'));
    add('同步脚本', esc(s.paths && s.paths.syncScript || '—'));
    add('知识库', esc(s.paths && s.paths.kbDir || '—'));
    if (s.token) {
      var age = s.token.ageDays === null ? '未知' : (s.token.ageDays + ' 天');
      add('token 文件', s.token.present
        ? esc(s.token.file) + '　' + (s.token.old ? pill(false, '偏旧（阈值 ' + s.token.thresholdDays + ' 天）') : pill(true, '尚新')) + '　' + esc(age)
        : esc(s.token.file) + '　' + pill(false, '不存在'));
    }
    add('运行中', s.running ? pill(false, '是（' + new Date(s.runningSince).toLocaleString() + ' 开始）') : pill(true, '否'));
    if (s.lastResult) {
      add('上次运行', (s.lastResult.ok ? pill(true, '退出码 ' + s.lastResult.exitCode) : pill(false, '退出码 ' + s.lastResult.exitCode)) +
        '　' + new Date(s.lastResult.finishedAt).toLocaleString());
    }
    if (s.lastSync && s.lastSync.length) add('LAST-SYNC', '<pre>' + esc(s.lastSync.join('\\n')) + '</pre>');
    if (s.latestLog) add('最新日志', esc(s.latestLog.name) + '　' + new Date(s.latestLog.mtime).toLocaleString() + '　' + s.latestLog.bytes + ' B');
    el('status').innerHTML = rows.join('');
    el('log').textContent = (s.latestLog && s.latestLog.tail) || '（没有日志）';
    el('run').disabled = !!s.running || !s.configured;
    el('doctor').disabled = !s.configured;
    if (s.running) { if (!timer) timer = setInterval(load, 3000); } else if (timer) { clearInterval(timer); timer = null; }
  }

  function load() {
    fetch(PREFIX + '/status', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(renderStatus)
      .catch(function (e) { el('hint').textContent = '读取状态失败：' + e; });
  }

  el('refresh').onclick = load;

  el('run').onclick = function () {
    if (!confirm('现在运行同步流水线？（等价于手动跑一次每日任务）')) return;
    el('hint').textContent = '已提交…';
    fetch(PREFIX + '/run', { method: 'POST', headers: MAGIC, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (j) { el('hint').textContent = j.ok ? '已开始运行' : ('未能运行：' + (j.error || '') + ' ' + (j.message || '')); load(); })
      .catch(function (e) { el('hint').textContent = '运行请求失败：' + e; });
  };

  el('doctor').onclick = function () {
    el('doctorOut').textContent = '正在运行…';
    fetch(PREFIX + '/doctor', { method: 'POST', headers: MAGIC, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        el('doctorOut').textContent = (j.stdout || '') + (j.stderr ? '\\n[stderr]\\n' + j.stderr : '') +
          '\\n[exit=' + j.exitCode + (j.error ? ' error=' + j.error : '') + ']';
      })
      .catch(function (e) { el('doctorOut').textContent = '体检请求失败：' + e; });
  };

  load();
})();
</script>
</body>
</html>`
}
