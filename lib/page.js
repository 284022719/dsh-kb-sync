/**
 * 同源控制页：一句话结论 → 收新对话 / 找内容 / 整理 → 运行详情与诊断。
 *
 * 依赖为零：一个 HTML、内联 CSS、内联 JS，不请求任何外部资源。脚本只调用插件自己的
 * 同源路由；写操作都带 `x-dsh-kb-sync` 自定义头（跨站表单伪造不出来）。
 *
 * **版式约定（2026-10-15 重排，别再退回那一版）**：
 * - 首屏只回答"现在正常吗、要动手点什么"：结论条 + 主按钮，其余收进 `<details>`。
 * - 分区按**任务**分（收新对话 / 找内容 / 整理 / 诊断），**不用 ① ② ③ 编号**；
 *   编号本身不携带信息，却把"哪块重要"这件事说糊了。
 * - **界面里不出现内部术语**：管线里的"段 1 / 段 2 / 整链 / 阶段 3 / dry-run / 落盘 / dsh headless"
 *   是开发者视角，用户看到的是「抓取 / 整理 / 更新知识库 / 试运行 / 写入」。
 *   步骤表里的 `token/recon/fetch/process/doctor` 也只当 `title` 提示，正文用中文名（见 STAGE_LABEL）。
 * - 同一个动作**只有一个按钮**（以前工具栏和卡片里各摆一个，重复且互相抢焦点）。
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
<title>${t('知识库同步')}</title>
<style>
  :root {
    color-scheme: light dark;
    --line: rgba(128,128,128,.32);
    --soft: rgba(128,128,128,.12);
    --dim: rgba(128,128,128,1);
    --ok: #2e9e5b; --warn: #c98600; --bad: #cf3f3f; --accent: #3b6fd4;
  }
  * { box-sizing: border-box; }
  body { font: 14px/1.65 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0 auto; padding: 20px 22px 44px; max-width: 1080px; }
  h1 { font-size: 19px; margin: 0; }
  h2 { font-size: 14.5px; margin: 0 0 10px; }
  h3 { font-size: 13px; margin: 16px 0 6px; opacity: .75; font-weight: 600; }
  h3:first-of-type { margin-top: 8px; }
  header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 2px; }
  header .sp { flex: 1; }
  .muted { opacity: .68; }
  .small { font-size: 12.5px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 10px 0; }
  button { font: inherit; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button:hover { background: var(--soft); }
  button[disabled] { opacity: .45; cursor: default; }
  button.primary { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  button.primary:hover { background: rgba(59,111,212,.1); }
  input, select { font: inherit; padding: 6px 9px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; }
  input[type=password] { width: 320px; }
  input[type=search] { width: 280px; }
  code { font: 12px/1.5 ui-monospace, Consolas, monospace; background: var(--soft); padding: 1px 5px; border-radius: 5px; }
  pre { margin: 6px 0 0; padding: 10px; overflow: auto; max-height: 320px; border-radius: 8px; background: var(--soft); font: 12px/1.55 ui-monospace, Consolas, monospace; white-space: pre-wrap; }
  .card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin: 14px 0; }
  /* verdict bar: the one "how are things right now" block; the left border carries the state */
  .verdict { border: 1px solid var(--line); border-left-width: 4px; border-radius: 12px; padding: 12px 16px; margin: 14px 0; }
  .verdict.ok { border-left-color: var(--ok); }
  .verdict.warn { border-left-color: var(--warn); }
  .verdict.bad { border-left-color: var(--bad); }
  .verdict-line { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .verdict-line b { font-size: 15px; }
  details { margin: 10px 0 0; }
  details > summary { cursor: pointer; font-weight: 600; list-style: none; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  details > summary::-webkit-details-marker { display: none; }
  details > summary::before { content: '▸'; opacity: .55; }
  details[open] > summary::before { content: '▾'; }
  details.card > summary { font-size: 14.5px; }
  details .body { padding-top: 4px; }
  .hline { border: 0; border-top: 1px solid var(--line); margin: 14px 0; }
  .note { border: 1px solid var(--warn); border-radius: 10px; padding: 9px 12px; margin-top: 10px; }
  .note.bad { border-color: var(--bad); }
  .note ul { margin: 0; padding-left: 18px; }
  .pill { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px; border: 1px solid var(--line); white-space: nowrap; }
  .pill.ok { border-color: var(--ok); color: var(--ok); }
  .pill.warn { border-color: var(--warn); color: var(--warn); }
  .pill.bad { border-color: var(--bad); color: var(--bad); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0; }
  dt { opacity: .68; }
  dd { margin: 0; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; opacity: .75; }
  ul.hits { list-style: none; margin: 0; padding: 0; }
  ul.hits li { border-top: 1px solid var(--line); padding: 9px 0; }
  ul.hits li:first-child { border-top: 0; }
  .hit-title { font-weight: 600; }
  .snip { font: 12px/1.55 ui-monospace, Consolas, monospace; opacity: .85; margin-top: 3px; word-break: break-word; }
  .hide { display: none; }
</style>
</head>
<body>
<header>
  <h1>${t('知识库同步')}</h1>
  <span class="muted small">dsh-kb-sync</span>
  <span class="sp"></span>
  <span class="muted small">${langSwitcher(language)}</span>
</header>
<p class="muted small" style="margin:2px 0 0">${t('把 DeepSeek 网页端的对话收进本地知识库，然后在这里检索它。')}</p>
<p class="muted small" id="boot" style="margin:4px 0 0">${boot}</p>

<section class="verdict" id="verdict">
  <div class="verdict-line">
    <span id="verdictPill" class="pill">${t('读取中…')}</span>
    <b id="verdictText">${t('正在读取状态…')}</b>
    <span class="muted small" id="verdictMeta"></span>
  </div>
  <div class="row" style="margin-bottom:0">
    <button id="chainRun" class="primary">${t('更新知识库')}</button>
    <span class="muted small">${t('= 抓取新对话 → 整理 → 体检（会消耗模型额度）')}</span>
    <span class="sp"></span>
    <button id="refresh">${t('刷新')}</button>
    <span class="muted small" id="chainState">${t('未运行')}</span>
    <span class="muted small" id="hint"></span>
  </div>
  <div id="todo" class="note hide"></div>
</section>

<details class="card">
  <summary>${t('网页端登录态')}<span class="muted small" id="tokenState">${t('读取中…')}</span></summary>
  <div class="body">
    <p class="muted small" style="margin:6px 0 0">${t('抓取要用网页端的 userToken。取法：浏览器登录 chat.deepseek.com → F12 → Application → Local Storage → 复制 {token} 的值（整段粘贴即可）。它只进 DSH 凭据服务，不写进任何文件。', { token: '<code>userToken</code>' })}</p>
    <div class="row">
      <input id="token" type="password" placeholder="${t('粘贴 userToken')}" autocomplete="off" spellcheck="false">
      <button id="tokenSave">${t('保存')}</button>
      <button id="tokenClear">${t('清除')}</button>
    </div>
  </div>
</details>

<section class="card">
  <h2>${t('收新对话')}</h2>
  <div class="row">
    <button id="pull2">${t('抓取新对话')}</button>
    <span class="muted small" id="pullState">${t('未运行')}</span>
  </div>
  <pre id="pullOut">—</pre>
  <details>
    <summary>${t('补齐全量历史（只在需要时用）')}</summary>
    <div class="body">
      <p class="muted small" style="margin:6px 0 0">${t('走官方导出包：服务端先生成一次完整导出，再下载解析。对话列表接口最多只回最新 100 条、也翻不了页，所以中间缺的历史只能用它补。')}</p>
      <div class="row">
        <button id="backfill2">${t('补齐全量历史（官方导出包）')}</button>
        <span class="muted small" id="backfillState">${t('未运行（只在第一次需要完整历史时用，之后用增量）')}</span>
      </div>
      <pre id="backfillOut">—</pre>
    </div>
  </details>
</section>

<section class="card">
  <h2>${t('找内容')}</h2>
  <div class="row">
    <input id="q" type="search" placeholder="${t('关键词（标题与正文）')}">
    <select id="role"><option value="any">${t('全部发言')}</option><option value="user">${t('只看用户说的话')}</option></select>
    <button id="search">${t('搜索')}</button>
    <span class="muted small" id="searchMeta"></span>
  </div>
  <ul class="hits" id="hits"></ul>
  <pre id="convOut" style="display:none">—</pre>
</section>

<section class="card">
  <h2>${t('整理（模型归类与提炼）')}</h2>
  <p class="muted small" style="margin:0 0 4px">${t('把抓进来的新对话交给宿主模型判断一次：话题归属、健康事实、财务候选。它只产出判断，由管线脚本先校验（索引集合、话题合法性、专题父话题）——校验不过整批不写入。')}</p>
  <div class="row">
    <button id="processDry">${t('试运行（只看会改什么，不写入）')}</button>
    <button id="processApply">${t('写入并重建')}</button>
    <span class="muted small" id="processState">${t('未运行')}</span>
  </div>
  <dl id="processMeta"><dt>—</dt><dd>—</dd></dl>
  <pre id="processLog">—</pre>
</section>

<details class="card">
  <summary>${t('运行详情与诊断')}</summary>
  <div class="body">
    <h3>${t('上次更新的每一步')}</h3>
    <table id="chainTable"><thead><tr><th style="width:110px">${t('步骤')}</th><th style="width:150px">${t('结论')}</th><th style="width:80px">${t('耗时')}</th><th>${t('说明')}</th></tr></thead><tbody><tr><td>—</td><td>—</td><td>—</td><td>${t('还没跑过')}</td></tr></tbody></table>
    <p class="muted small" id="chainVerdict" style="margin:6px 0 0"></p>

    <hr class="hline">
    <h3>${t('当前状态')}</h3>
    <dl id="status"><dt>—</dt><dd>${t('正在读取…')}</dd></dl>

    <h3>${t('知识库')}</h3>
    <dl id="kb"><dt>—</dt><dd>—</dd></dl>

    <h3>${t('最近日志')}</h3>
    <pre id="log">—</pre>

    <h3>${t('体检')}</h3>
    <div class="row">
      <button id="doctor">${t('跑体检')}</button>
      <button id="run">${t('运行我配置的同步脚本')}</button>
      <span class="muted small">${t('体检只报告、不修改；同步脚本是你在配置里指定的那条命令。')}</span>
    </div>
    <pre id="doctorOut">${t('未运行')}</pre>
  </div>
</details>

<script>
(function () {
  var PREFIX = ${JSON.stringify(prefix)};
  var POST = { 'x-dsh-kb-sync': '1', 'content-type': 'application/json' };
  var DICT = ${JSON.stringify(dict)};
  var timer = null;

  /* Pipeline stage ids (token/recon/fetch/process/doctor) are developer-facing: the table shows a
   * plain-language label and keeps the raw id only in the title tooltip (for matching logs).
   * NOTE: comments inside this inline script must stay ASCII — test/locale.test.mjs renders the
   * English page and fails on any leftover CJK outside the translation table. */
  var STAGE_LABEL = {
    token: T('登录态'),
    recon: T('查有没有新内容'),
    fetch: T('抓取'),
    process: T('整理'),
    doctor: T('体检')
  };

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
    var state = !tok.available ? T('凭据服务不可用')
      : tok.configured ? pill(true, T('已登录')) : pill(false, T('未登录'));
    el('tokenState').innerHTML = state + '　<code>' + esc(tok.ref) + '</code>';
  }

  function renderStatus(s) {
    /* Headline first (is it fine?), then three key numbers, then — only when something needs a
     * human — a single "needs your attention" block. */
    var last = s.lastSync && s.lastSync.length ? String(s.lastSync[0]).trim() : '';
    var lastCode = last ? (last.split(/\\s+/)[2] || '') : '';
    var okState = !s.configured ? 'warn' : (lastCode && !/ok|done/.test(lastCode) ? 'bad' : (last ? 'ok' : 'warn'));
    el('verdict').className = 'verdict ' + okState;
    el('verdictPill').innerHTML = okState === 'ok' ? pill(true, T('正常')) : okState === 'warn' ? '<span class="pill warn">' + esc(T('需要看一眼')) + '</span>' : pill(false, T('上次没成功'));
    el('verdictText').textContent = !s.configured ? T('还没配置同步目录')
      : last ? T('最近一次更新：{at}', { at: last.split(/\\s+/).slice(0, 2).join(' ') }) + '　' + lastCode
      : T('还没有更新记录');
    var meta = [];
    if (s.kb && s.kb.catalog) meta.push(T('知识库 {rows} 个会话', { rows: Number(s.kb.catalog.rows).toLocaleString() }));
    if (s.token && s.token.present) meta.push(T('登录态 {days} 天前更新', { days: s.token.ageDays }));
    if (s.pulling) meta.push(T('正在抓取'));
    if (s.backfilling) meta.push(T('正在补齐历史'));
    if (s.running) meta.push(T('同步脚本在跑'));
    if (s.chain && s.chain.running) meta.push(T('正在更新知识库：{phase}', { phase: (s.chain.phase || '') }));
    if (s.process && s.process.running) meta.push(T('正在整理'));
    el('verdictMeta').textContent = meta.join('　·　');

    var todo = [];
    if (!s.configured && s.message) todo.push(esc(s.message));
    if (s.token && s.token.present && s.token.old) todo.push(T('网页端登录态已经 {days} 天没更新（阈值 {threshold} 天），过期后抓取会失败 —— 在上面「网页端登录态」里重新粘一次。', { days: s.token.ageDays, threshold: s.token.thresholdDays }));
    if (s.token && !s.token.present) todo.push(T('找不到网页端登录态文件 {file} —— 抓取会失败。', { file: s.token.file }));
    if (lastCode && !/ok|done/.test(lastCode)) todo.push(T('上次更新没有成功（{code}）：逐段结论见下面「运行详情与诊断」。', { code: lastCode }));
    var todoBox = el('todo');
    if (todo.length) {
      todoBox.className = 'note' + (okState === 'bad' ? ' bad' : '');
      todoBox.innerHTML = '<b>' + T('需要你处理') + '</b><ul>' + todo.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    } else {
      todoBox.className = 'note hide';
      todoBox.innerHTML = '';
    }

    var rows = [];
    function add(k, v) { rows.push('<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'); }
    add(T('同步目录'), s.configured ? pill(true, T('已就绪')) : pill(false, T('未配置')));
    if (s.message) add(T('说明'), esc(s.message));
    add('root', esc(s.paths && s.paths.root || '—'));
    add(T('知识库目录'), esc(s.paths && s.paths.outDir || '—'));
    if (s.token) {
      add(T('登录态文件'), s.token.present
        ? esc(s.token.file) + '　' + (s.token.old ? pill(false, T('偏旧（阈值 {days} 天）', { days: s.token.thresholdDays })) : pill(true, T('尚新'))) + T('　{days} 天', { days: s.token.ageDays })
        : esc(s.token.file) + '　' + pill(false, T('不存在')));
    }
    add(T('同步脚本在跑'), s.running ? pill(false, T('是（{at}）', { at: ts(s.runningSince) })) : pill(true, T('否')));
    add(T('抓取中'), s.pulling ? pill(false, T('是（{at}）', { at: ts(s.pullStartedAt) })) : pill(true, T('否')));
    if (s.lastResult) add(T('上次同步脚本'), (s.lastResult.ok ? pill(true, T('退出码 {code}', { code: s.lastResult.exitCode })) : pill(false, T('退出码 {code}', { code: s.lastResult.exitCode }))) + '　' + ts(s.lastResult.finishedAt));
    if (s.lastPull) add(T('上次抓取'), (s.lastPull.fatal ? pill(false, T('失败')) : pill(true, T('完成'))) + T('　新增 {added} / 续聊 {updated} / 跳过 {skipped}', { added: s.lastPull.added || 0, updated: s.lastPull.updated || 0, skipped: s.lastPull.skipped || 0 }) + '　' + ts(s.lastPull.finishedAt));
    if (s.lastSync && s.lastSync.length) add(T('更新记录（末几行）'), '<pre>' + esc(s.lastSync.join('\\n')) + '</pre>');
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
    el('pull2').disabled = !!s.pulling;
    el('backfill2').disabled = !!s.backfilling || !!s.pulling;
    renderProcess(s.process);
    renderChain(s.chain);
    el('pullState').textContent = s.pulling ? T('抓取中…（页面每 3 秒自动刷新）') : T('未运行');
    el('backfillState').textContent = s.backfilling
      ? (T('运行中：') + ((s.backfill && s.backfill.phase) || '') + (s.backfill && s.backfill.exportStatus ? T('（服务端导出状态 {status}，已查询 {times} 次）', { status: s.backfill.exportStatus, times: s.backfill.attempts }) : ''))
      : (s.backfill && s.backfill.fatal ? T('上次失败：') + s.backfill.fatal : T('未运行'));
    if (s.backfill) {
      var bo = [];
      bo.push(T('进度：') + (s.backfill.phase || '—') + (s.backfill.exportStatus ? T('　导出状态：{status}（第 {times} 次查询）', { status: s.backfill.exportStatus, times: s.backfill.attempts }) : ''));
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

  /* One row per step of "update knowledge base"; label in plain language (see STAGE_LABEL). */
  function renderChain(c) {
    c = c || {};
    var busy = !!c.running;
    el('chainRun').disabled = busy;
    el('chainState').textContent = busy ? T('更新中：{phase}…（页面每 3 秒自动刷新）', { phase: c.phase || '' }) : T('未运行');
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
      var label = STAGE_LABEL[st.stage] || st.stage;
      return '<tr><td title="' + esc(st.stage) + '">' + esc(label) + '</td><td>' + mark + '</td><td>' + esc(secs) + '</td><td>' + esc(st.message || '') + '</td></tr>';
    }).join('');
    var r = c.report;
    if (r) {
      var line = (r.ok ? T('✅ 更新完成') : T('❌ 更新失败：') + (r.reason || '')) + T('　总耗时 {sec} s', { sec: (r.ms / 1000).toFixed(1) });
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
      if (p.result.counts) add(T('上次结果'), T('归类 {assign} / 健康 {facts} / 财务候选 {candidates} / 专题 {suggestions}', { assign: p.result.counts.assignments, facts: p.result.counts.facts, candidates: p.result.counts.candidates, suggestions: p.result.counts.suggestions }) + (p.result.applied ? '　' + pill(true, T('已写入')) : '　' + T('（未写入）')));
      if (p.result.skipped) add(T('跳过'), esc(p.result.message || p.result.skipped));
      if (p.result.error) add(T('错误'), pill(false, p.result.error) + '　' + esc(p.result.message || ''));
    }
    el('processMeta').innerHTML = rows.join('');
    el('processState').textContent = busy ? T('进行中…（页面每 3 秒自动刷新）') : T('未运行');
    var lines = [];
    if (p.result && p.result.validation) lines.push(T('[校验输出]'), p.result.validation.trim());
    if (p.result && p.result.applyLog) lines.push(T('[写入输出]'), p.result.applyLog.trim());
    if (p.result && p.result.raw) lines.push(T('[模型原始输出片段]'), String(p.result.raw).slice(0, 1500));
    if ((p.log || []).length) lines.push(T('[步骤]'), p.log.join('\\n'));
    el('processLog').textContent = lines.length ? lines.join('\\n') : '—';
  }

  function load() {
    get('/status').then(renderStatus).catch(function (e) { el('hint').textContent = T('读取状态失败：') + e; });
    get('/token').then(renderToken).catch(function () { el('tokenState').textContent = T('凭据状态读取失败'); });
  }

  function doPull() {
    el('hint').textContent = T('已提交抓取…');
    post('/pull', {}).then(function (j) {
      el('hint').textContent = j.ok ? T('抓取完成：新增 {added}、续聊 {updated}', { added: j.added, updated: j.updated }) : (T('未能抓取：') + (j.error || '') + ' ' + (j.message || ''));
      load();
    }).catch(function (e) { el('hint').textContent = T('抓取请求失败：') + e; });
  }

  el('refresh').onclick = load;
  el('pull2').onclick = doPull;

  function doBackfill() {
    if (!confirm(T('补齐历史：让 DeepSeek 生成一次完整导出并下载解析（可能要等几分钟）。已有会话只在导出内容更多时才更新。继续？'))) return;
    el('hint').textContent = T('已提交补齐历史…');
    post('/backfill', {}).then(function (j) {
      el('hint').textContent = j.ok ? T('已在后台开始（见下方进度）') : (T('未能开始：') + (j.error || '') + ' ' + (j.message || ''));
      load();
    }).catch(function (e) { el('hint').textContent = T('请求失败：') + e; });
  }
  el('backfill2').onclick = doBackfill;

  el('tokenSave').onclick = function () {
    var value = el('token').value.trim();
    if (!value) { el('hint').textContent = T('请先粘贴 userToken'); return; }
    post('/token', { token: value }).then(function (j) {
      el('token').value = '';
      el('hint').textContent = j.ok ? T('已保存到 DSH 凭据服务') : (T('保存失败：') + (j.error || ''));
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
        var meta = '<div class="muted small">' + esc(hit.updated_at || '') + '　' + esc(hit.file || '') + '</div>';
        var body = (hit.matches || []).map(function (m) { return '<div class="snip">' + esc(m.role === 'user' ? '👤 ' : '🤖 ') + esc(m.snippet) + '</div>'; }).join('');
        var open = '<div style="margin-top:4px"><a href="#" class="open" data-id="' + esc(hit.id) + '">' + T('展开全文') + '</a></div>';
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
    if (!confirm(T('运行你在配置里指定的那条同步命令？'))) return;
    post('/run', {}).then(function (j) { el('hint').textContent = j.ok ? T('已开始运行') : (T('未能运行：') + (j.error || '') + ' ' + (j.message || '')); load(); });
  };

  el('doctor').onclick = function () {
    el('doctorOut').textContent = T('正在运行…');
    post('/doctor', {}).then(function (j) {
      el('doctorOut').textContent = (j.stdout || '') + (j.stderr ? '\\n[stderr]\\n' + j.stderr : '') + '\\n[exit=' + j.exitCode + (j.error ? ' error=' + j.error : '') + ']';
    }).catch(function (e) { el('doctorOut').textContent = T('体检请求失败：') + e; });
  };

  function doProcess(apply) {
    if (apply && !confirm(T('会写入：归类进话题输入、健康事实进 health-facts、财务只进候选区，然后重建知识库与健康档案。继续？'))) return;
    el('processLog').textContent = apply ? T('已提交（写入 + 重建）…') : T('已提交（试运行，只校验）…');
    post('/process', { apply: !!apply }).then(function (j) {
      if (!j.ok) el('processLog').textContent = T('失败：') + (j.error || '') + '\\n' + (j.message || '');
      load();
    }).catch(function (e) { el('processLog').textContent = T('请求失败：') + e; });
  }
  el('processDry').onclick = function () { doProcess(false); };
  el('processApply').onclick = function () { doProcess(true); };

  el('chainRun').onclick = function () {
    if (!confirm(T('更新知识库：抓取新对话 → 整理（归类与提炼）→ 写入并重建 → 体检（会消耗模型额度）。继续？'))) return;
    el('chainVerdict').textContent = T('已提交，正在更新…');
    post('/pipeline', { apply: true, force: true }).then(function (j) {
      if (!j.ok) el('chainVerdict').textContent = T('更新失败：') + (j.reason || j.error || '') + '　' + (j.message || '');
      load();
    }).catch(function (e) { el('chainVerdict').textContent = T('请求失败：') + e; });
  };

  load();
})();
</script>
</body>
</html>`
}
