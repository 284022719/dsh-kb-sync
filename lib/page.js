/**
 * 同源控制页：状态 / 同步 / 体检 / 网页端拉取 / 检索。
 *
 * 依赖为零：一个 HTML、内联 CSS、内联 JS，不请求任何外部资源。脚本只调用插件自己的
 * 同源路由；写操作都带 `x-dsh-kb-sync` 自定义头（跨站表单伪造不出来）。
 *
 * @module dsh-kb-sync/page
 */

/** HTML 文本/属性转义。 */
function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * 渲染控制页。
 * @param {{prefix: string, configured: string}} input - 渲染输入。
 * @returns {string} 完整 HTML。
 */
export function renderPage({ prefix, configured }) {
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
  body { font: 14px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; padding: 24px; max-width: 1040px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 0 0 8px; }
  .muted { opacity: .7; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 14px 0; }
  button { font: inherit; padding: 7px 14px; border-radius: 8px; border: 1px solid rgba(128,128,128,.5); background: transparent; cursor: pointer; }
  button:hover { background: rgba(128,128,128,.15); }
  button[disabled] { opacity: .5; cursor: default; }
  input, select { font: inherit; padding: 6px 9px; border-radius: 8px; border: 1px solid rgba(128,128,128,.5); background: transparent; color: inherit; }
  input[type=password] { width: 340px; }
  input[type=search] { width: 300px; }
  .card { border: 1px solid rgba(128,128,128,.35); border-radius: 10px; padding: 12px 14px; margin: 12px 0; }
  pre { margin: 0; padding: 10px; overflow: auto; max-height: 320px; border-radius: 8px; background: rgba(128,128,128,.12); font: 12px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; border: 1px solid rgba(128,128,128,.5); }
  .pill.ok { border-color: #2e9e5b; color: #2e9e5b; }
  .pill.warn { border-color: #d08b00; color: #d08b00; }
  .pill.bad { border-color: #cf3f3f; color: #cf3f3f; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0; }
  dt { opacity: .7; }
  dd { margin: 0; word-break: break-all; }
  ul.hits { list-style: none; margin: 0; padding: 0; }
  ul.hits li { border-top: 1px solid rgba(128,128,128,.25); padding: 8px 0; }
  ul.hits li:first-child { border-top: 0; }
  .hit-title { font-weight: 600; }
  .snip { font: 12px/1.5 ui-monospace, Consolas, monospace; opacity: .85; margin-top: 3px; word-break: break-word; }
</style>
</head>
<body>
<h1>dsh-kb-sync</h1>
<p class="muted">读 DeepSeek 网页端对话 → 规范化落盘 → 本地知识库检索，外加编排你已有的同步 / 体检命令。</p>
<p class="muted" id="boot">${boot}</p>

<div class="row">
  <button id="refresh">刷新状态</button>
  <button id="pull">拉取网页端新对话</button>
  <button id="backfill">全量回填（官方导出包）</button>
  <button id="run">运行已有同步脚本</button>
  <button id="doctor">跑知识库体检</button>
  <span class="muted" id="hint"></span>
</div>

<div class="card">
  <h2>① 网页端登录态（userToken，只进 DSH 凭据服务）</h2>
  <p class="muted" style="margin:4px 0">取法：浏览器登录 chat.deepseek.com → F12 → Application → Local Storage → 复制 <code>userToken</code> 的值（整段粘贴即可）。</p>
  <div class="row">
    <span id="tokenState">读取中…</span>
    <input id="token" type="password" placeholder="粘贴 userToken" autocomplete="off" spellcheck="false">
    <button id="tokenSave">保存</button>
    <button id="tokenClear">清除</button>
  </div>
</div>

<div class="card">
  <h2>② 拉取（增量：会话列表 + 每个线程的权威历史）</h2>
  <div class="row">
    <button id="pull2">开始拉取</button>
    <span class="muted" id="pullState">未运行</span>
  </div>
  <pre id="pullOut">—</pre>
  <div class="row" style="margin-top:8px">
    <button id="backfill2">全量回填</button>
    <span class="muted" id="backfillState">未运行（只在第一次需要完整历史时用，之后用增量）</span>
  </div>
  <pre id="backfillOut">—</pre>
</div>

<div class="card">
  <h2>③ 检索本地知识库</h2>
  <div class="row">
    <input id="q" type="search" placeholder="关键词（标题与正文）">
    <select id="role"><option value="any">全部发言</option><option value="user">只看用户说的话</option></select>
    <button id="search">搜索</button>
    <span class="muted" id="searchMeta"></span>
  </div>
  <ul class="hits" id="hits"></ul>
  <pre id="convOut" style="margin-top:10px;display:none">—</pre>
</div>

<div class="card">
  <h2>状态</h2>
  <dl id="status"><dt>—</dt><dd>正在读取…</dd></dl>
</div>

<div class="card">
  <h2>知识库</h2>
  <dl id="kb"><dt>—</dt><dd>—</dd></dl>
</div>

<div class="card">
  <h2>最近日志（已有同步脚本）</h2>
  <pre id="log">—</pre>
</div>

<div class="card">
  <h2>知识库体检</h2>
  <pre id="doctorOut">未运行</pre>
</div>

<script>
(function () {
  var PREFIX = ${JSON.stringify(prefix)};
  var POST = { 'x-dsh-kb-sync': '1', 'content-type': 'application/json' };
  var timer = null;

  function el(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function pill(ok, text) { return '<span class="pill ' + (ok ? 'ok' : 'bad') + '">' + esc(text) + '</span>'; }
  function ts(ms) { return ms ? new Date(ms).toLocaleString() : '—'; }
  function get(path) { return fetch(PREFIX + path, { headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }); }
  function post(path, body) { return fetch(PREFIX + path, { method: 'POST', headers: POST, body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); }); }

  function renderToken(t) {
    var state = !t.available ? 'DSH 凭据服务不可用'
      : t.configured ? pill(true, '已保存') : pill(false, '未保存');
    el('tokenState').innerHTML = '当前：' + state + '　<code>' + esc(t.ref) + '</code>';
  }

  function renderStatus(s) {
    var rows = [];
    function add(k, v) { rows.push('<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'); }
    add('已有同步脚本', s.configured ? pill(true, '已就绪') : pill(false, '未配置'));
    if (s.message) add('说明', esc(s.message));
    add('root', esc(s.paths && s.paths.root || '—'));
    add('知识库目录', esc(s.paths && s.paths.outDir || '—'));
    if (s.token) {
      add('token 文件', s.token.present
        ? esc(s.token.file) + '　' + (s.token.old ? pill(false, '偏旧（阈值 ' + s.token.thresholdDays + ' 天）') : pill(true, '尚新')) + '　' + s.token.ageDays + ' 天'
        : esc(s.token.file) + '　' + pill(false, '不存在'));
    }
    add('脚本运行中', s.running ? pill(false, '是（' + ts(s.runningSince) + '）') : pill(true, '否'));
    add('拉取中', s.pulling ? pill(false, '是（' + ts(s.pullStartedAt) + '）') : pill(true, '否'));
    if (s.lastResult) add('上次脚本', (s.lastResult.ok ? pill(true, '退出码 ' + s.lastResult.exitCode) : pill(false, '退出码 ' + s.lastResult.exitCode)) + '　' + ts(s.lastResult.finishedAt));
    if (s.lastPull) add('上次拉取', (s.lastPull.fatal ? pill(false, '失败') : pill(true, '完成')) + '　新增 ' + (s.lastPull.added || 0) + ' / 续聊 ' + (s.lastPull.updated || 0) + ' / 跳过 ' + (s.lastPull.skipped || 0) + '　' + ts(s.lastPull.finishedAt));
    if (s.lastSync && s.lastSync.length) add('LAST-SYNC', '<pre>' + esc(s.lastSync.join('\\n')) + '</pre>');
    el('status').innerHTML = rows.join('');
    el('log').textContent = (s.latestLog && s.latestLog.tail) || '（没有日志）';

    var kbRows = [];
    function addKb(k, v) { kbRows.push('<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'); }
    var j = s.kb && s.kb.conversationsJsonl;
    addKb('conversations.jsonl', j ? (Math.round(j.bytes / 1024) + ' KB　' + ts(j.mtime)) : '（还没有）');
    addKb('catalog.json', s.kb && s.kb.catalog ? (s.kb.catalog.rows + ' 行') : '（还没有）');
    addKb('Markdown 会话', s.kb ? (s.kb.markdown + ' 个文件') : '—');
    el('kb').innerHTML = kbRows.join('');

    el('run').disabled = !!s.running || !s.configured;
    el('doctor').disabled = !s.configured;
    el('pull').disabled = !!s.pulling;
    el('pull2').disabled = !!s.pulling;
    el('backfill').disabled = !!s.backfilling || !!s.pulling;
    el('backfill2').disabled = !!s.backfilling || !!s.pulling;
    el('pullState').textContent = s.pulling ? '运行中…（页面每 3 秒自动刷新）' : '未运行';
    el('backfillState').textContent = s.backfilling
      ? ('运行中：' + ((s.backfill && s.backfill.phase) || '') + (s.backfill && s.backfill.exportStatus ? ('（服务端导出状态 ' + s.backfill.exportStatus + '，已查询 ' + s.backfill.attempts + ' 次）') : ''))
      : (s.backfill && s.backfill.fatal ? ('上次失败：' + s.backfill.fatal) : '未运行');
    if (s.backfill) {
      var bo = [];
      bo.push('阶段：' + (s.backfill.phase || '—') + (s.backfill.exportStatus ? '　导出状态：' + s.backfill.exportStatus + '（第 ' + s.backfill.attempts + ' 次查询）' : ''));
      if (s.backfill.exportConversations) bo.push('导出包会话：' + s.backfill.exportConversations + (s.backfill.zipBytes ? ('　zip ' + Math.round(s.backfill.zipBytes / 1048576) + ' MB') : ''));
      if (s.backfill.finishedAt) bo.push('结果：新增 ' + (s.backfill.added || 0) + '，更新 ' + (s.backfill.updated || 0) + '，跳过 ' + (s.backfill.skipped || 0));
      (s.backfill.files || []).slice(0, 10).forEach(function (f) { bo.push('  ' + f); });
      if ((s.backfill.files || []).length > 10) bo.push('  …还有 ' + (s.backfill.files.length - 10) + ' 个');
      (s.backfill.errors || []).slice(0, 10).forEach(function (e) { bo.push('  ! ' + e.title + ': ' + e.message); });
      el('backfillOut').textContent = bo.join('\\n');
    }
    if (s.lastPull) {
      var out = [];
      out.push('本轮：列出 ' + (s.lastPull.listed || 0) + '，新增 ' + (s.lastPull.added || 0) + '，续聊 ' + (s.lastPull.updated || 0) + '，跳过 ' + (s.lastPull.skipped || 0));
      if (s.lastPull.noChanges) out.push('（没有需要更新的内容）');
      if (s.lastPull.fatal) out.push('失败：' + s.lastPull.fatal);
      (s.lastPull.files || []).slice(0, 20).forEach(function (f) { out.push('  ' + f); });
      if ((s.lastPull.files || []).length > 20) out.push('  …还有 ' + (s.lastPull.files.length - 20) + ' 个');
      (s.lastPull.errors || []).forEach(function (e) { out.push('  ! ' + e.title + ' (' + e.id + '): ' + e.message); });
      el('pullOut').textContent = out.join('\\n');
    }
    if (s.running || s.pulling || s.backfilling) { if (!timer) timer = setInterval(load, 3000); } else if (timer) { clearInterval(timer); timer = null; }
  }

  function load() {
    get('/status').then(renderStatus).catch(function (e) { el('hint').textContent = '读取状态失败：' + e; });
    get('/token').then(renderToken).catch(function () { el('tokenState').textContent = '凭据状态读取失败'; });
  }

  function doPull() {
    el('hint').textContent = '已提交拉取…';
    post('/pull', {}).then(function (j) {
      el('hint').textContent = j.ok ? ('拉取完成：新增 ' + j.added + '、续聊 ' + j.updated) : ('未能拉取：' + (j.error || '') + ' ' + (j.message || ''));
      load();
    }).catch(function (e) { el('hint').textContent = '拉取请求失败：' + e; });
  }

  el('refresh').onclick = load;
  el('pull').onclick = doPull;
  el('pull2').onclick = doPull;

  function doBackfill() {
    if (!confirm('全量回填：让 DeepSeek 生成一次完整导出并下载解析（可能要等几分钟）。已有会话只在导出内容更多时才更新。继续？')) return;
    el('hint').textContent = '已提交全量回填…';
    post('/backfill', {}).then(function (j) {
      el('hint').textContent = j.ok ? '回填已在后台开始（见下方进度）' : ('未能开始：' + (j.error || '') + ' ' + (j.message || ''));
      load();
    }).catch(function (e) { el('hint').textContent = '回填请求失败：' + e; });
  }
  el('backfill').onclick = doBackfill;
  el('backfill2').onclick = doBackfill;

  el('tokenSave').onclick = function () {
    var value = el('token').value.trim();
    if (!value) { el('hint').textContent = '请先粘贴 userToken'; return; }
    post('/token', { token: value }).then(function (j) {
      el('token').value = '';
      el('hint').textContent = j.ok ? 'token 已保存到 DSH 凭据服务' : ('保存失败：' + (j.error || ''));
      load();
    }).catch(function (e) { el('hint').textContent = '保存请求失败：' + e; });
  };

  el('tokenClear').onclick = function () {
    if (!confirm('清除已保存的 userToken？')) return;
    post('/token/clear', {}).then(function (j) { el('hint').textContent = j.ok ? '已清除' : ('清除失败：' + (j.error || '')); load(); });
  };

  el('search').onclick = function () {
    var q = el('q').value.trim();
    if (!q) return;
    el('searchMeta').textContent = '搜索中…';
    get('/search?q=' + encodeURIComponent(q) + '&role=' + el('role').value).then(function (j) {
      if (!j.ok) { el('searchMeta').textContent = '失败：' + (j.error || ''); return; }
      el('searchMeta').textContent = '扫描 ' + j.scanned + ' 个会话，命中 ' + j.hits.length + ' 个';
      el('hits').innerHTML = j.hits.map(function (h) {
        var head = '<div class="hit-title">' + esc(h.title || '(无标题)') + (h.titleHit ? ' <span class="pill ok">标题命中</span>' : '') + '</div>';
        var meta = '<div class="muted" style="font-size:12px">' + esc(h.updated_at || '') + '　' + esc(h.file || '') + '</div>';
        var body = (h.matches || []).map(function (m) { return '<div class="snip">' + esc(m.role === 'user' ? '👤 ' : '🤖 ') + esc(m.snippet) + '</div>'; }).join('');
        var open = '<div><a href="#" class="open" data-id="' + esc(h.id) + '">展开全文</a></div>';
        return '<li>' + head + meta + body + open + '</li>';
      }).join('') || '<li class="muted">没有命中</li>';
    }).catch(function (e) { el('searchMeta').textContent = '搜索失败：' + e; });
  };
  el('q').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') el('search').onclick(); });

  el('hits').addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a.open') : null;
    if (!a) return;
    ev.preventDefault();
    var box = el('convOut');
    box.style.display = 'block';
    box.textContent = '读取中…';
    get('/conversation?id=' + encodeURIComponent(a.getAttribute('data-id'))).then(function (j) {
      box.textContent = j.ok ? j.markdown : ('读取失败：' + (j.error || ''));
    }).catch(function (e) { box.textContent = '读取失败：' + e; });
  });

  el('run').onclick = function () {
    if (!confirm('运行你已有的同步脚本？（与计划任务跑的是同一条命令）')) return;
    post('/run', {}).then(function (j) { el('hint').textContent = j.ok ? '已开始运行' : ('未能运行：' + (j.error || '') + ' ' + (j.message || '')); load(); });
  };

  el('doctor').onclick = function () {
    el('doctorOut').textContent = '正在运行…';
    post('/doctor', {}).then(function (j) {
      el('doctorOut').textContent = (j.stdout || '') + (j.stderr ? '\\n[stderr]\\n' + j.stderr : '') + '\\n[exit=' + j.exitCode + (j.error ? ' error=' + j.error : '') + ']';
    }).catch(function (e) { el('doctorOut').textContent = '体检请求失败：' + e; });
  };

  load();
})();
</script>
</body>
</html>`
}
