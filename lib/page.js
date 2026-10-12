/**
 * 同源控制页：状态 / 同步 / 体检 / 网页端拉取 / 检索。
 *
 * 依赖为零：一个 HTML、内联 CSS、内联 JS，不请求任何外部资源。脚本只调用插件自己的
 * 同源路由；写操作都带 `x-dsh-kb-sync` 自定义头（跨站表单伪造不出来）。
 *
 * 多语言：中文是**源语言**（页面里写的就是 key），译文在 `locale/<lang>.json`。
 * 服务端用 `t('中文')`，浏览器端把当前语言的译文表内联成 `DICT` 并用 `T('中文')` 查——
 * 缺译回落中文原文，所以加语言不用改这个文件（见 `lib/locale.js` 的说明）。
 *
 * @module dsh-kb-sync/page
 */
import { SOURCE_LANG, SUPPORTED_LANGS, dictionary, normalizeLang, translator } from './locale.js'

/** HTML 文本/属性转义。 */
function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** 语言切换器：当前语言加粗，其余是 `?lang=` 链接。语言名本身不翻译。 */
function langSwitcher(lang) {
  const name = { zh: '中文', en: 'English' }
  return SUPPORTED_LANGS.map((code) =>
    code === lang
      ? `<b>${esc(name[code] ?? code)}</b>`
      : `<a href="?lang=${encodeURIComponent(code)}">${esc(name[code] ?? code)}</a>`,
  ).join(' · ')
}

/**
 * 渲染控制页。
 * @param {{prefix: string, lang?: string, root?: string|null, configFile?: string, configFileUsed?: boolean, configured?: string}} input - 渲染输入。
 *   `root` 为 `null` 表示还没配置；也接受旧的 `configured`（已渲染好的启动提示串，原样输出）。
 * @returns {string} 完整 HTML。
 */
export function renderPage({ prefix, lang, root, configFile, configFileUsed, configured }) {
  const language = normalizeLang(lang)
  const t = translator(language)
  const boot = esc(
    configured !== undefined
      ? configured
      : root === null || root === undefined
        ? t('尚未配置 root。可写设置文件 {file}（形如 {"root":"..."}），或在 profile patch 里给 id: dsh-kb-sync 加 config.root，或设环境变量 DSH_KB_SYNC_ROOT。', { file: configFile ?? '' })
        : t('root = {root}', { root }) + (configFileUsed ? t('（设置文件：{file}）', { file: configFile ?? '' }) : ''),
  )
  const dict = language === SOURCE_LANG ? {} : dictionary(language)
  return `<!doctype html>
<html lang="${language === SOURCE_LANG ? 'zh-CN' : language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${t('dsh-kb-sync 控制页')}</title>
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
<div class="row" style="justify-content:space-between;align-items:baseline;margin:0 0 4px">
  <h1>dsh-kb-sync</h1>
  <span class="muted">${langSwitcher(language)}</span>
</div>
<p class="muted">${t('读 DeepSeek 网页端对话 → 规范化落盘 → 本地知识库检索，外加编排你已有的同步 / 体检命令。')}</p>
<p class="muted" id="boot">${boot}</p>

<div class="row">
  <button id="refresh">${t('刷新状态')}</button>
  <button id="pull">${t('拉取网页端新对话')}</button>
  <button id="backfill">${t('全量回填（官方导出包）')}</button>
  <button id="run">${t('运行已有同步脚本')}</button>
  <button id="doctor">${t('跑知识库体检')}</button>
  <span class="muted" id="hint"></span>
</div>

<div class="card">
  <h2>${t('① 网页端登录态（userToken，只进 DSH 凭据服务）')}</h2>
  <p class="muted" style="margin:4px 0">${t('取法：浏览器登录 chat.deepseek.com → F12 → Application → Local Storage → 复制 {token} 的值（整段粘贴即可）。', { token: '<code>userToken</code>' })}</p>
  <div class="row">
    <span id="tokenState">${t('读取中…')}</span>
    <input id="token" type="password" placeholder="${t('粘贴 userToken')}" autocomplete="off" spellcheck="false">
    <button id="tokenSave">${t('保存')}</button>
    <button id="tokenClear">${t('清除')}</button>
  </div>
</div>

<div class="card">
  <h2>${t('② 拉取（增量：会话列表 + 每个线程的权威历史）')}</h2>
  <div class="row">
    <button id="pull2">${t('开始拉取')}</button>
    <span class="muted" id="pullState">${t('未运行')}</span>
  </div>
  <pre id="pullOut">—</pre>
  <div class="row" style="margin-top:8px">
    <button id="backfill2">${t('全量回填')}</button>
    <span class="muted" id="backfillState">${t('未运行（只在第一次需要完整历史时用，之后用增量）')}</span>
  </div>
  <pre id="backfillOut">—</pre>
</div>

<div class="card">
  <h2>${t('③ 检索本地知识库')}</h2>
  <div class="row">
    <input id="q" type="search" placeholder="${t('关键词（标题与正文）')}">
    <select id="role"><option value="any">${t('全部发言')}</option><option value="user">${t('只看用户说的话')}</option></select>
    <button id="search">${t('搜索')}</button>
    <span class="muted" id="searchMeta"></span>
  </div>
  <ul class="hits" id="hits"></ul>
  <pre id="convOut" style="margin-top:10px;display:none">—</pre>
</div>

<div class="card">
  <h2>${t('状态')}</h2>
  <dl id="status"><dt>—</dt><dd>${t('正在读取…')}</dd></dl>
</div>

<div class="card">
  <h2>${t('知识库')}</h2>
  <dl id="kb"><dt>—</dt><dd>—</dd></dl>
</div>

<div class="card">
  <h2>${t('最近日志（已有同步脚本）')}</h2>
  <pre id="log">—</pre>
</div>

<div class="card">
  <h2>${t('知识库体检')}</h2>
  <pre id="doctorOut">${t('未运行')}</pre>
</div>

<div class="card">
  <h2>${t('④ 一键整链（阶段 3：调度与通知都归插件）')}</h2>
  <p class="muted" style="margin:4px 0">${t('按顺序跑：')}<b>${t('Token 检查 → 只读侦察 → 抓取落盘 → 段 2 判断/校验/落盘/重建 → 知识库体检')}</b>${t('。每一段都有独立结论、退出码与耗时；计划任务或手动都走这条链（经 {trigger}）。', { trigger: '<code>tools\\pipeline\\trigger.cmd</code>' })}</p>
  <div class="row">
    <button id="chainRun">${t('跑整链（含落盘与重建）')}</button>
    <span class="muted" id="chainState">${t('未运行')}</span>
  </div>
  <table id="chainTable" style="margin-top:8px"><thead><tr><th style="width:90px">${t('阶段')}</th><th style="width:150px">${t('结论')}</th><th style="width:80px">${t('耗时')}</th><th>${t('说明')}</th></tr></thead><tbody><tr><td>—</td><td>—</td><td>—</td><td>${t('还没跑过')}</td></tr></tbody></table>
  <p class="muted" id="chainVerdict" style="margin:6px 0 0"></p>
</div>

<div class="card">
  <h2>${t('⑤ 段 2 判断（进程内调宿主模型，不再需要 dsh headless）')}</h2>
  <p class="muted" style="margin:4px 0">${t('读本轮的 {items} 与健康/财务摘要 → 调宿主 {llm} 服务拿一份 JSON 判断 → 写 {out} → 用管线的 {apply} 校验（索引集合、话题合法性、专题父话题）→ 通过后才落盘并重建。', { items: '<code>update-new-items.json</code>', llm: '<code>llm</code>', out: '<code>sync/out/</code>', apply: '<code>apply-extraction.mjs</code>' })}</p>
  <div class="row">
    <button id="processDry">${t('只校验（dry-run，不落盘）')}</button>
    <button id="processApply">${t('跑并落盘 + 重建')}</button>
    <span class="muted" id="processState">${t('未运行')}</span>
  </div>
  <dl id="processMeta"><dt>—</dt><dd>—</dd></dl>
  <pre id="processLog">—</pre>
</div>

<script>
(function () {
  var PREFIX = ${JSON.stringify(prefix)};
  var POST = { 'x-dsh-kb-sync': '1', 'content-type': 'application/json' };
  var DICT = ${JSON.stringify(dict)};
  var timer = null;

  /* Browser-side translator: look up the inlined dictionary, fall back to the Chinese source
   * string, and substitute {name} placeholders from vars. */
  function T(text, vars) {
    var out = (DICT[text] !== undefined && DICT[text] !== '') ? DICT[text] : text;
    if (vars) out = out.replace(/\\{(\\w+)\\}/g, function (whole, key) {
      return (vars[key] === undefined || vars[key] === null) ? whole : String(vars[key]);
    });
    return out;
  }

  function el(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function pill(ok, text) { return '<span class="pill ' + (ok ? 'ok' : 'bad') + '">' + esc(text) + '</span>'; }
  function ts(ms) { return ms ? new Date(ms).toLocaleString() : '—'; }
  function get(path) { return fetch(PREFIX + path, { headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }); }
  function post(path, body) { return fetch(PREFIX + path, { method: 'POST', headers: POST, body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); }); }

  function renderToken(tok) {
    var state = !tok.available ? T('DSH 凭据服务不可用')
      : tok.configured ? pill(true, T('已保存')) : pill(false, T('未保存'));
    el('tokenState').innerHTML = T('当前：') + state + '　<code>' + esc(tok.ref) + '</code>';
  }

  function renderStatus(s) {
    var rows = [];
    function add(k, v) { rows.push('<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'); }
    add(T('已有同步脚本'), s.configured ? pill(true, T('已就绪')) : pill(false, T('未配置')));
    if (s.message) add(T('说明'), esc(s.message));
    add('root', esc(s.paths && s.paths.root || '—'));
    add(T('知识库目录'), esc(s.paths && s.paths.outDir || '—'));
    if (s.token) {
      add(T('token 文件'), s.token.present
        ? esc(s.token.file) + '　' + (s.token.old ? pill(false, T('偏旧（阈值 {days} 天）', { days: s.token.thresholdDays })) : pill(true, T('尚新'))) + T('　{days} 天', { days: s.token.ageDays })
        : esc(s.token.file) + '　' + pill(false, T('不存在')));
    }
    add(T('脚本运行中'), s.running ? pill(false, T('是（{at}）', { at: ts(s.runningSince) })) : pill(true, T('否')));
    add(T('拉取中'), s.pulling ? pill(false, T('是（{at}）', { at: ts(s.pullStartedAt) })) : pill(true, T('否')));
    if (s.lastResult) add(T('上次脚本'), (s.lastResult.ok ? pill(true, T('退出码 {code}', { code: s.lastResult.exitCode })) : pill(false, T('退出码 {code}', { code: s.lastResult.exitCode }))) + '　' + ts(s.lastResult.finishedAt));
    if (s.lastPull) add(T('上次拉取'), (s.lastPull.fatal ? pill(false, T('失败')) : pill(true, T('完成'))) + T('　新增 {added} / 续聊 {updated} / 跳过 {skipped}', { added: s.lastPull.added || 0, updated: s.lastPull.updated || 0, skipped: s.lastPull.skipped || 0 }) + '　' + ts(s.lastPull.finishedAt));
    if (s.lastSync && s.lastSync.length) add('LAST-SYNC', '<pre>' + esc(s.lastSync.join('\\n')) + '</pre>');
    el('status').innerHTML = rows.join('');
    el('log').textContent = (s.latestLog && s.latestLog.tail) || T('（没有日志）');

    var kbRows = [];
    function addKb(k, v) { kbRows.push('<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'); }
    var j = s.kb && s.kb.conversationsJsonl;
    addKb('conversations.jsonl', j ? (Math.round(j.bytes / 1024) + ' KB　' + ts(j.mtime)) : T('（还没有）'));
    addKb('catalog.json', s.kb && s.kb.catalog ? T('{rows} 行', { rows: s.kb.catalog.rows }) : T('（还没有）'));
    addKb(T('Markdown 会话'), s.kb ? T('{files} 个文件', { files: s.kb.markdown }) : '—');
    el('kb').innerHTML = kbRows.join('');

    el('run').disabled = !!s.running || !s.configured;
    el('doctor').disabled = !s.configured;
    el('pull').disabled = !!s.pulling;
    el('pull2').disabled = !!s.pulling;
    el('backfill').disabled = !!s.backfilling || !!s.pulling;
    el('backfill2').disabled = !!s.backfilling || !!s.pulling;
    renderProcess(s.process);
    renderChain(s.chain);
    el('pullState').textContent = s.pulling ? T('运行中…（页面每 3 秒自动刷新）') : T('未运行');
    el('backfillState').textContent = s.backfilling
      ? (T('运行中：') + ((s.backfill && s.backfill.phase) || '') + (s.backfill && s.backfill.exportStatus ? T('（服务端导出状态 {status}，已查询 {times} 次）', { status: s.backfill.exportStatus, times: s.backfill.attempts }) : ''))
      : (s.backfill && s.backfill.fatal ? T('上次失败：') + s.backfill.fatal : T('未运行'));
    if (s.backfill) {
      var bo = [];
      bo.push(T('阶段：') + (s.backfill.phase || '—') + (s.backfill.exportStatus ? T('　导出状态：{status}（第 {times} 次查询）', { status: s.backfill.exportStatus, times: s.backfill.attempts }) : ''));
      if (s.backfill.exportConversations) bo.push(T('导出包会话：') + s.backfill.exportConversations + (s.backfill.zipBytes ? T('　zip {mb} MB', { mb: Math.round(s.backfill.zipBytes / 1048576) }) : ''));
      if (s.backfill.finishedAt) bo.push(T('结果：新增 {added}，更新 {updated}，跳过 {skipped}', { added: s.backfill.added || 0, updated: s.backfill.updated || 0, skipped: s.backfill.skipped || 0 }));
      (s.backfill.files || []).slice(0, 10).forEach(function (f) { bo.push('  ' + f); });
      if ((s.backfill.files || []).length > 10) bo.push(T('  …还有 {n} 个', { n: s.backfill.files.length - 10 }));
      (s.backfill.errors || []).slice(0, 10).forEach(function (e) { bo.push('  ! ' + e.title + ': ' + e.message); });
      el('backfillOut').textContent = bo.join('\\n');
    }
    if (s.lastPull) {
      var out = [];
      out.push(T('本轮：列出 {listed}，新增 {added}，续聊 {updated}，跳过 {skipped}', { listed: s.lastPull.listed || 0, added: s.lastPull.added || 0, updated: s.lastPull.updated || 0, skipped: s.lastPull.skipped || 0 }));
      if (s.lastPull.noChanges) out.push(T('（没有需要更新的内容）'));
      if (s.lastPull.fatal) out.push(T('失败：') + s.lastPull.fatal);
      (s.lastPull.files || []).slice(0, 20).forEach(function (f) { out.push('  ' + f); });
      if ((s.lastPull.files || []).length > 20) out.push(T('  …还有 {n} 个', { n: s.lastPull.files.length - 20 }));
      (s.lastPull.errors || []).forEach(function (e) { out.push('  ! ' + e.title + ' (' + e.id + '): ' + e.message); });
      el('pullOut').textContent = out.join('\\n');
    }
    if (s.running || s.pulling || s.backfilling || (s.process && s.process.running) || (s.chain && s.chain.running)) { if (!timer) timer = setInterval(load, 3000); } else if (timer) { clearInterval(timer); timer = null; }
  }

  /* Full chain: per-stage table + verdict + the notice wording (same sentence as the retired toast). */
  function renderChain(c) {
    c = c || {};
    var busy = !!c.running;
    el('chainRun').disabled = busy;
    el('chainState').textContent = busy ? T('运行中：{phase}…（页面每 3 秒自动刷新）', { phase: c.phase || '' }) : T('未运行');
    var stages = (c.report && c.report.stages) || c.stages || [];
    var body = el('chainTable').tBodies[0];
    if (!stages.length) {
      body.innerHTML = '<tr><td>—</td><td>—</td><td>—</td><td>' + T('还没跑过') + '</td></tr>';
      el('chainVerdict').textContent = '';
      return;
    }
    body.innerHTML = stages.map(function (st) {
      var mark = st.ok ? pill(true, '✅ ' + esc(st.code || 'ok')) : pill(false, '❌ ' + esc(st.code || 'failed'));
      var secs = st.ms >= 1000 ? ((st.ms / 1000).toFixed(1) + ' s') : (st.ms + ' ms');
      return '<tr><td><code>' + esc(st.stage) + '</code></td><td>' + mark + '</td><td>' + esc(secs) + '</td><td>' + esc(st.message || '') + '</td></tr>';
    }).join('');
    var r = c.report;
    if (r) {
      var line = (r.ok ? T('✅ 整链成功') : T('❌ 整链失败：') + (r.reason || '')) + T('　总耗时 {sec} s', { sec: (r.ms / 1000).toFixed(1) });
      if (r.warnings && r.warnings.length) line += T('　⚠️ {list}', { list: r.warnings.join('；') });
      if (r.notify) line += T('　（通知：{title} — {body}）', { title: r.notify.title, body: r.notify.body });
      el('chainVerdict').textContent = line;
    }
  }

  function renderProcess(p) {
    p = p || {};
    var busy = !!p.running;
    el('processDry').disabled = busy;
    el('processApply').disabled = busy;
    var route = p.route ? (p.route.provider + ' / ' + p.route.model) : ((p.provider && p.model) ? (p.provider + ' / ' + p.model + T('（来自配置）')) : T('自动选择'));
    var rows = [];
    function add(k, v) { rows.push('<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'); }
    add(T('模型'), esc(route));
    add(T('状态'), busy ? pill(false, T('进行中：') + (p.phase || '')) : (p.result && p.result.ok ? pill(true, T('上次成功')) : (p.result ? pill(false, T('上次失败')) : T('未运行'))));
    if (p.result) {
      if (p.result.counts) add(T('上次结果'), T('归类 {assign} / 健康 {facts} / 财务候选 {candidates} / 专题 {suggestions}', { assign: p.result.counts.assignments, facts: p.result.counts.facts, candidates: p.result.counts.candidates, suggestions: p.result.counts.suggestions }) + (p.result.applied ? '　' + pill(true, T('已落盘')) : '　' + T('（未落盘）')));
      if (p.result.skipped) add(T('跳过'), esc(p.result.message || p.result.skipped));
      if (p.result.error) add(T('错误'), pill(false, p.result.error) + '　' + esc(p.result.message || ''));
    }
    el('processMeta').innerHTML = rows.join('');
    el('processState').textContent = busy ? T('运行中…（页面每 3 秒自动刷新）') : T('未运行');
    var lines = [];
    if (p.result && p.result.validation) lines.push(T('[校验输出]'), p.result.validation.trim());
    if (p.result && p.result.applyLog) lines.push(T('[应用输出]'), p.result.applyLog.trim());
    if (p.result && p.result.raw) lines.push(T('[模型原始输出片段]'), String(p.result.raw).slice(0, 1500));
    if ((p.log || []).length) lines.push(T('[阶段]'), p.log.join('\\n'));
    el('processLog').textContent = lines.length ? lines.join('\\n') : '—';
  }

  function load() {
    get('/status').then(renderStatus).catch(function (e) { el('hint').textContent = T('读取状态失败：') + e; });
    get('/token').then(renderToken).catch(function () { el('tokenState').textContent = T('凭据状态读取失败'); });
  }

  function doPull() {
    el('hint').textContent = T('已提交拉取…');
    post('/pull', {}).then(function (j) {
      el('hint').textContent = j.ok ? T('拉取完成：新增 {added}、续聊 {updated}', { added: j.added, updated: j.updated }) : (T('未能拉取：') + (j.error || '') + ' ' + (j.message || ''));
      load();
    }).catch(function (e) { el('hint').textContent = T('拉取请求失败：') + e; });
  }

  el('refresh').onclick = load;
  el('pull').onclick = doPull;
  el('pull2').onclick = doPull;

  function doBackfill() {
    if (!confirm(T('全量回填：让 DeepSeek 生成一次完整导出并下载解析（可能要等几分钟）。已有会话只在导出内容更多时才更新。继续？'))) return;
    el('hint').textContent = T('已提交全量回填…');
    post('/backfill', {}).then(function (j) {
      el('hint').textContent = j.ok ? T('回填已在后台开始（见下方进度）') : (T('未能开始：') + (j.error || '') + ' ' + (j.message || ''));
      load();
    }).catch(function (e) { el('hint').textContent = T('回填请求失败：') + e; });
  }
  el('backfill').onclick = doBackfill;
  el('backfill2').onclick = doBackfill;

  el('tokenSave').onclick = function () {
    var value = el('token').value.trim();
    if (!value) { el('hint').textContent = T('请先粘贴 userToken'); return; }
    post('/token', { token: value }).then(function (j) {
      el('token').value = '';
      el('hint').textContent = j.ok ? T('token 已保存到 DSH 凭据服务') : (T('保存失败：') + (j.error || ''));
      load();
    }).catch(function (e) { el('hint').textContent = T('保存请求失败：') + e; });
  };

  el('tokenClear').onclick = function () {
    if (!confirm(T('清除已保存的 userToken？'))) return;
    post('/token/clear', {}).then(function (j) { el('hint').textContent = j.ok ? T('已清除') : (T('清除失败：') + (j.error || '')); load(); });
  };

  el('search').onclick = function () {
    var q = el('q').value.trim();
    if (!q) return;
    el('searchMeta').textContent = T('搜索中…');
    get('/search?q=' + encodeURIComponent(q) + '&role=' + el('role').value).then(function (j) {
      if (!j.ok) { el('searchMeta').textContent = T('失败：') + (j.error || ''); return; }
      el('searchMeta').textContent = T('扫描 {scanned} 个会话，命中 {hits} 个', { scanned: j.scanned, hits: j.hits.length });
      el('hits').innerHTML = j.hits.map(function (hit) {
        var head = '<div class="hit-title">' + esc(hit.title || T('(无标题)')) + (hit.titleHit ? ' <span class="pill ok">' + T('标题命中') + '</span>' : '') + '</div>';
        var meta = '<div class="muted" style="font-size:12px">' + esc(hit.updated_at || '') + '　' + esc(hit.file || '') + '</div>';
        var body = (hit.matches || []).map(function (m) { return '<div class="snip">' + esc(m.role === 'user' ? '👤 ' : '🤖 ') + esc(m.snippet) + '</div>'; }).join('');
        var open = '<div><a href="#" class="open" data-id="' + esc(hit.id) + '">' + T('展开全文') + '</a></div>';
        return '<li>' + head + meta + body + open + '</li>';
      }).join('') || '<li class="muted">' + T('没有命中') + '</li>';
    }).catch(function (e) { el('searchMeta').textContent = T('搜索失败：') + e; });
  };
  el('q').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') el('search').onclick(); });

  el('hits').addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a.open') : null;
    if (!a) return;
    ev.preventDefault();
    var box = el('convOut');
    box.style.display = 'block';
    box.textContent = T('读取中…');
    get('/conversation?id=' + encodeURIComponent(a.getAttribute('data-id'))).then(function (j) {
      box.textContent = j.ok ? j.markdown : (T('读取失败：') + (j.error || ''));
    }).catch(function (e) { box.textContent = T('读取失败：') + e; });
  });

  el('run').onclick = function () {
    if (!confirm(T('运行你已有的同步脚本？（与触发器 trigger.cmd 走的是同一条命令）'))) return;
    post('/run', {}).then(function (j) { el('hint').textContent = j.ok ? T('已开始运行') : (T('未能运行：') + (j.error || '') + ' ' + (j.message || '')); load(); });
  };

  el('doctor').onclick = function () {
    el('doctorOut').textContent = T('正在运行…');
    post('/doctor', {}).then(function (j) {
      el('doctorOut').textContent = (j.stdout || '') + (j.stderr ? '\\n[stderr]\\n' + j.stderr : '') + '\\n[exit=' + j.exitCode + (j.error ? ' error=' + j.error : '') + ']';
    }).catch(function (e) { el('doctorOut').textContent = T('体检请求失败：') + e; });
  };

  function doProcess(apply) {
    if (apply && !confirm(T('会落盘：归类写入 final-topics 输入、健康事实进 health-facts、财务只进候选区，然后重建知识库与健康档案。继续？'))) return;
    el('processLog').textContent = apply ? T('已提交（应用 + 重建）…') : T('已提交（dry-run，只校验）…');
    post('/process', { apply: !!apply }).then(function (j) {
      if (!j.ok) el('processLog').textContent = T('失败：') + (j.error || '') + '\\n' + (j.message || '');
      load();
    }).catch(function (e) { el('processLog').textContent = T('请求失败：') + e; });
  }
  el('processDry').onclick = function () { doProcess(false); };
  el('processApply').onclick = function () { doProcess(true); };

  el('chainRun').onclick = function () {
    if (!confirm(T('跑整链：抓取 + 段 2 判断 + 落盘 + 重建知识库与健康档案（消耗额度）。继续？'))) return;
    el('chainVerdict').textContent = T('已提交整链，正在运行…');
    post('/pipeline', { apply: true, force: true }).then(function (j) {
      if (!j.ok) el('chainVerdict').textContent = T('整链失败：') + (j.reason || j.error || '') + '　' + (j.message || '');
      load();
    }).catch(function (e) { el('chainVerdict').textContent = T('整链请求失败：') + e; });
  };

  load();
})();
</script>
</body>
</html>`
}
