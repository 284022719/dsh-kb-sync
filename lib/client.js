/**
 * dsh-kb-sync —— 客户端半部（手写，无需构建步骤）。
 *
 * 形态照 `@deepseek-ai/dsh-client-*` 的模块表约定：宿主 Web 端用
 * `window.__ModuleLoader__.load({ id, factory })` 加载，factory 里 `require('react')`
 * （react 是平台种子模块，不是依赖），返回一个 cordis 插件对象 `{ name, inject, apply }`。
 *
 * 它只做一件事：在 **设置 → dsh-kb-sync** 注册一个分节，把插件状态摊在应用内，并给出
 * 两个动作按钮（抓取新对话 / 更新知识库）。所有请求都打插件自己的同源路由，
 * 写操作必须带 `x-dsh-kb-sync: 1`（与页面同一套守卫）。
 *
 * **不提供"打开控制页"**（2026-10-15 起）：那个按钮指向插件的直连地址，而"进哪一页"
 * 只该有一个答案 —— 控制台的「同步」页签（它嵌的就是这张页面）。多给一个入口 = 多记一个地址、
 * 多一处可能失效的链接。
 *
 * 为什么不做成"完整设置页"：`settings.section` 只投影 `id` / `order` / `label`，
 * 第三方分节拿不到自定义图标（外壳用默认齿轮），所以这里把信息密度做在分区内容里，
 * 而不是去改外壳结构。
 *
 * 测试缝：`exports.__internals` 只给单测用（宿主只看 `apply` / `inject`）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-kb-sync',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /** 与 `lib/index.js` 的 GUARD_HEADER 必须一致：写操作缺它会被 403。 */
    const GUARD_HEADER = 'x-dsh-kb-sync'
    /** 插件路由前缀（与 ROUTE_PREFIX 一致）。 */
    const PREFIX = '/__dsh-kb-sync'
    /** 字典命名空间 = 插件名。 */
    const NS = 'dsh-kb-sync'

    const zh = {
      'nav.label': '对话知识库',
      'section.title': 'dsh-kb-sync',
      'section.hint': '把 DeepSeek 网页端对话同步到本地知识库，并编排你自己的同步/体检命令。',
      'row.status': '配置',
      'row.root': '流水线根目录',
      'row.outDir': '知识库目录',
      'row.token': '凭据文件',
      'row.kb': '知识库规模',
      'row.activity': '运行状态',
      'status.configured': '已配置',
      'status.unconfigured': '未配置（缺 root，见控制页提示）',
      'status.ageDays': '{days} 天前更新（阈值 {threshold} 天）',
      'status.old': '偏旧，建议换新 token',
      'status.missing': '文件不存在',
      'status.kb': '{rows} 条会话 · {size}',
      'status.idle': '空闲',
      'status.busy': '正在跑：{what}',
      'act.pull': '抓取新对话',
      'act.chain': '更新知识库',
      'act.refresh': '刷新',
      'busy.pull': '抓取中…',
      'busy.chain': '更新中…',
      'result.pull': '抓取完成：新增 {added}、更新 {updated}、跳过 {skipped}',
      'result.chainOk': '更新完成：{stages}',
      'result.chainSkipped': '更新跳过：{reason}',
      'result.chainFail': '更新失败：{reason}',
      'result.fail': '请求失败：{error}',
      'error.noService': '宿主没有提供该路由（插件可能未启用）',
    }
    const en = {
      'nav.label': 'KB sync',
      'section.title': 'dsh-kb-sync',
      'section.hint': 'Pull DeepSeek web conversations into a local knowledge base and orchestrate your own sync / integrity command.',
      'row.status': 'Configuration',
      'row.root': 'Pipeline root',
      'row.outDir': 'Knowledge base',
      'row.token': 'Credential file',
      'row.kb': 'Knowledge base size',
      'row.activity': 'Activity',
      'status.configured': 'configured',
      'status.unconfigured': 'not configured (no root — the control page says what to set)',
      'status.ageDays': 'updated {days} days ago (threshold {threshold} days)',
      'status.old': 'getting old — fetch a new token',
      'status.missing': 'file not found',
      'status.kb': '{rows} conversations · {size}',
      'status.idle': 'idle',
      'status.busy': 'running: {what}',
      'act.pull': 'Fetch new chats',
      'act.chain': 'Update knowledge base',
      'act.refresh': 'Refresh',
      'busy.pull': 'fetching…',
      'busy.chain': 'updating…',
      'result.pull': 'Fetch done: {added} added, {updated} updated, {skipped} skipped',
      'result.chainOk': 'Update done: {stages}',
      'result.chainSkipped': 'Update skipped: {reason}',
      'result.chainFail': 'Update failed: {reason}',
      'result.fail': 'Request failed: {error}',
      'error.noService': 'the host does not serve this route (is the plugin enabled?)',
    }

    /** 字节 → 人类可读（与页面同一套口径，最小实现）。 */
    function humanBytes(n) {
      if (!Number.isFinite(n) || n <= 0) return '0 B'
      if (n < 1024) return `${n} B`
      if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / 1048576).toFixed(1)} MB`
    }

    /**
     * 把 `/status` 折成"设置页要看的那几行"（纯函数，便于单测）。
     * @param {object|null} s - `/status` 的 JSON；取不到就传 null。
     * @returns {{configured: boolean, root: string, outDir: string, token: string, tokenOld: boolean, kb: string, activity: string|null}}
     */
    function summarizeStatus(s) {
      const st = s && typeof s === 'object' ? s : {}
      const paths = st.paths ?? {}
      const token = st.token
      const kb = st.kb
      const busy = []
      if (st.chain && st.chain.running) busy.push('chain')
      if (st.process && st.process.running) busy.push('segment2')
      if (st.pulling) busy.push('pull')
      if (st.backfilling) busy.push('backfill')
      return {
        configured: Boolean(st.configured),
        root: paths.root ?? '',
        outDir: paths.outDir ?? '',
        token: token ? `${token.ageDays} ${token.thresholdDays}` : '',
        tokenOld: Boolean(token && token.old),
        tokenPresent: Boolean(token && token.present),
        tokenAgeDays: token ? token.ageDays : null,
        tokenThresholdDays: token ? token.thresholdDays : null,
        kbRows: kb && kb.catalog ? kb.catalog.rows : null,
        kbBytes: kb && kb.conversationsJsonl ? kb.conversationsJsonl.bytes : null,
        activity: busy.length ? busy.join(' + ') : null,
      }
    }

    /** 同源请求：写操作带守卫头，非 2xx 也把 JSON 读回来（路由的失败体是 JSON）。 */
    async function request(path, init) {
      const options = Object.assign({ headers: {} }, init ?? {})
      options.headers = Object.assign({ accept: 'application/json' }, options.headers)
      if (options.method && options.method !== 'GET') {
        options.headers[GUARD_HEADER] = '1'
        if (options.body === undefined) {
          options.body = '{}'
          options.headers['content-type'] = 'application/json'
        }
      }
      const res = await fetch(`${PREFIX}${path}`, options)
      let payload = null
      try {
        payload = await res.json()
      } catch {
        payload = null
      }
      if (payload === null) throw new Error(`HTTP ${res.status}`)
      return payload
    }

    const styles = {
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        fontSize: '13px',
        lineHeight: 1.5,
      },
      hint: { opacity: 0.75 },
      table: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 14px' },
      key: { opacity: 0.6 },
      mono: { fontFamily: 'ui-monospace, Consolas, monospace', wordBreak: 'break-all' },
      row: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
      button: {
        padding: '5px 12px',
        borderRadius: '6px',
        border: '1px solid currentColor',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
      },
      note: { opacity: 0.85 },
    }

    /** 设置分节主体。`t` 由注册时的 inject 注入（ctx.locale.bind(NS)）。 */
    function KbSyncSection(props) {
      const t = props && typeof props.t === 'function' ? props.t : (k) => k
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [note, setNote] = React.useState(null)

      const refresh = React.useCallback(async () => {
        try {
          setStatus(await request('/status'))
        } catch (error) {
          setStatus(null)
          setNote(t('result.fail').replace('{error}', String(error && error.message ? error.message : error)))
        }
      }, [t])

      React.useEffect(() => {
        void refresh()
      }, [refresh])

      const act = async (kind) => {
        setBusy(kind)
        setNote(null)
        try {
          if (kind === 'pull') {
            const r = await request('/pull', { method: 'POST' })
            if (r.ok === false) throw new Error(r.error ?? r.message ?? 'pull failed')
            setNote(
              t('result.pull')
                .replace('{added}', String(r.added ?? 0))
                .replace('{updated}', String(r.updated ?? 0))
                .replace('{skipped}', String(r.skipped ?? 0)),
            )
          } else if (kind === 'chain') {
            const r = await request('/pipeline', {
              method: 'POST',
              body: JSON.stringify({ apply: true, force: true }),
            })
            if (r.skipped) setNote(t('result.chainSkipped').replace('{reason}', String(r.reason ?? '')))
            else if (r.ok === false) setNote(t('result.chainFail').replace('{reason}', String(r.reason ?? r.error ?? '')))
            else setNote(t('result.chainOk').replace('{stages}', String((r.stages ?? []).length)))
          }
          await refresh()
        } catch (error) {
          setNote(t('result.fail').replace('{error}', String(error && error.message ? error.message : error)))
        } finally {
          setBusy(null)
        }
      }

      const info = summarizeStatus(status)
      const rows = []
      rows.push(h('div', { key: 'st', style: styles.key }, t('row.status')))
      rows.push(
        h(
          'div',
          { key: 'stv' },
          info.configured ? t('status.configured') : t('status.unconfigured'),
        ),
      )
      if (info.root) {
        rows.push(h('div', { key: 'root', style: styles.key }, t('row.root')))
        rows.push(h('div', { key: 'rootv', style: styles.mono }, info.root))
      }
      if (info.outDir) {
        rows.push(h('div', { key: 'out', style: styles.key }, t('row.outDir')))
        rows.push(h('div', { key: 'outv', style: styles.mono }, info.outDir))
      }
      rows.push(h('div', { key: 'tok', style: styles.key }, t('row.token')))
      rows.push(
        h(
          'div',
          { key: 'tokv' },
          info.tokenPresent
            ? t('status.ageDays')
                .replace('{days}', String(info.tokenAgeDays))
                .replace('{threshold}', String(info.tokenThresholdDays)) + (info.tokenOld ? ` · ${t('status.old')}` : '')
            : status === null
              ? t('status.idle')
              : t('status.missing'),
        ),
      )
      if (info.kbRows !== null) {
        rows.push(h('div', { key: 'kb', style: styles.key }, t('row.kb')))
        rows.push(
          h(
            'div',
            { key: 'kbv' },
            t('status.kb').replace('{rows}', String(info.kbRows)).replace('{size}', humanBytes(info.kbBytes)),
          ),
        )
      }
      rows.push(h('div', { key: 'act', style: styles.key }, t('row.activity')))
      rows.push(
        h('div', { key: 'actv' }, info.activity ? t('status.busy').replace('{what}', info.activity) : t('status.idle')),
      )

      return h('div', { style: styles.card }, [
        h('div', { key: 'hint', style: styles.hint }, t('section.hint')),
        h('div', { key: 'table', style: styles.table }, rows),
        h('div', { key: 'row', style: styles.row }, [
          h(
            'button',
            { key: 'pull', type: 'button', style: styles.button, disabled: busy !== null, onClick: () => act('pull') },
            busy === 'pull' ? t('busy.pull') : t('act.pull'),
          ),
          h(
            'button',
            { key: 'chain', type: 'button', style: styles.button, disabled: busy !== null, onClick: () => act('chain') },
            busy === 'chain' ? t('busy.chain') : t('act.chain'),
          ),
          h(
            'button',
            { key: 'refresh', type: 'button', style: styles.button, disabled: busy !== null, onClick: () => void refresh() },
            t('act.refresh'),
          ),
        ]),
        note ? h('div', { key: 'note', style: styles.note }, note) : null,
      ])
    }

    const plugin = {
      name: 'ui-dsh-kb-sync',
      inject: ['slots', 'locale'],
      apply(ctx) {
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-kb-sync: dictionaries')
        } else {
          ctx.locale.register(NS, { zh, en })
        }
        const dispose = ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'kb-sync',
              // 80 是 trust-check 用的号位；这里排在它后面一点，避免争位。
              order: 90,
              locale: NS,
              label: () => ctx.locale.bind(NS)('nav.label'),
              inject: () => ({ t: ctx.locale.bind(NS) }),
            },
            KbSyncSection,
          ),
        )
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => dispose, 'dsh-kb-sync: settings section')
        }
      },
    }

    // 单测缝：宿主只读 apply / inject，其余字段不影响加载。
    plugin.__internals = { GUARD_HEADER, PREFIX, NS, zh, en, summarizeStatus, humanBytes, request, KbSyncSection }

    return plugin
  },
})
