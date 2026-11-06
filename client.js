/**
 * dsh-quarantine — 客户端半边（Module Loader 单文件 bundle）。
 *
 * DSH 的客户端插件每个包只加载一个 `client.js`（chunk 只服务于编译器生成的
 * require.async），所以这里按「节」划分，而不是拆文件：
 *
 *   §1 文案                  COPY / t()
 *   §2 宿主通信              api()
 *   §3 判定与格式化          工作区匹配、时间、大小
 *   §4 图形与样式            Glyph / CSS
 *   §5 内嵌面板              Panel —— main 槽 key=quarantine
 *   §6 设置页                SettingsPage —— settings.section
 *   §7 会话菜单行            MenuRow —— 覆盖官方 archive 行
 *   §8 侧边栏底部入口        FooterEntry —— sidebar.footer.action
 *   §9 注册                  apply()
 */
window.__ModuleLoader__.load({
  id: 'dsh-quarantine',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useState } = React
    const h = React.createElement

    const ROUTE = '/dsh-quarantine'
    const API_HEADER = 'x-dsh-quarantine'

    /** 跨组件共享的配置缓存；会话菜单行靠它判断某个会话是不是隔离区的。 */
    const STORE = { root: '', title: '隔离区', listeners: new Set() }

    let localeId = 'zh'

    // §1 文案 -------------------------------------------------------------

    const COPY = {
      zh: {
        title: '隔离区',
        open: '打开隔离区',
        newChat: '新建对话',
        openDir: '打开目录',
        refresh: '刷新',
        clear: '清空全部',
        empty: '隔离区里还没有对话。',
        missingDir: '隔离区目录还不存在：{path}',
        deleteOne: '彻底删除',
        archiveOne: '归档',
        unarchiveOne: '取消归档',
        confirmOne: '彻底删除这个对话？\n日志文件会从磁盘删除，无法恢复。',
        confirmClear: '清空隔离区里的全部对话？\n正在运行的会话会被跳过；其余日志从磁盘删除，无法恢复。',
        running: '运行中',
        settings: '设置',
        save: '保存',
        saved: '已保存',
        dirLabel: '隔离区目录',
        dirHint: '这个目录下的对话属于隔离区：只保留下面勾选的工具，不进入归档，只能彻底删除。',
        toolsLabel: '插件工具（默认禁止）',
        toolsHint: '这里列出的是已装插件在全局注册的工具；勾选 = 在隔离区里放行。官方基础工具（bash / 文件 / web / 子代理等）已默认放行，不在此列表。',
        stripLabel: '剔除提示段落',
        stripHint: '隔离区会话的 system prompt 里去掉这些段落（按名字包含匹配），例如 mnemon 的记忆快照、persona。',
        extra: '额外剔除（逗号分隔）',
        failed: '操作失败',
        emptyTitle: '（无标题）',
      },
      en: {
        title: 'Quarantine',
        open: 'Open quarantine',
        newChat: 'New conversation',
        openDir: 'Open folder',
        refresh: 'Refresh',
        clear: 'Clear all',
        empty: 'No conversations in quarantine yet.',
        missingDir: 'Quarantine folder does not exist: {path}',
        deleteOne: 'Delete forever',
        archiveOne: 'Archive',
        unarchiveOne: 'Unarchive',
        confirmOne: 'Delete this conversation forever?\nIts log is removed from disk and cannot be restored.',
        confirmClear: 'Delete every conversation in quarantine?\nRunning sessions are skipped; the rest is removed from disk and cannot be restored.',
        running: 'running',
        settings: 'Settings',
        save: 'Save',
        saved: 'Saved',
        dirLabel: 'Quarantine folder',
        dirHint: 'Conversations under this folder keep only the checked tools, never enter the archive, and can only be deleted for good.',
        toolsLabel: 'Plugin tools (denied by default)',
        toolsHint: 'These are the tools installed plugins register globally; checking one allows it inside quarantine. Built-in tools (bash / files / web / subagents) are allowed by default and are not listed here.',
        stripLabel: 'Strip prompt sections',
        stripHint: 'Remove these sections from quarantine system prompts (name contains match), e.g. the mnemon memory snapshot or persona.',
        extra: 'Extra names (comma separated)',
        failed: 'Operation failed',
        emptyTitle: '(untitled)',
      },
    }

    function t(key, vars) {
      const dict = COPY[localeId] ?? COPY.zh
      let text = dict[key] ?? COPY.zh[key] ?? key
      if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value))
      return text
    }

    // §2 宿主通信 ---------------------------------------------------------

    async function api(op, payload) {
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [API_HEADER]: '1' },
        body: JSON.stringify({ op, ...payload }),
      })
      const value = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (!value.ok) throw new Error(value.error || `HTTP ${response.status}`)
      return value
    }

    function publishConfig(settings) {
      STORE.root = settings.root
      STORE.title = settings.title
      for (const listener of STORE.listeners) listener()
    }

    // §3 判定与格式化 ------------------------------------------------------

    function normalizePath(value) {
      if (typeof value !== 'string' || value.length === 0) return ''
      return value.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
    }

    function samePath(left, right) {
      const normalized = normalizePath(left)
      return normalized !== '' && normalized === normalizePath(right)
    }

    function quarantineWorkspace(workspaces) {
      if (!STORE.root) return undefined
      return (workspaces?.items ?? []).find((item) => samePath(item.path, STORE.root))
    }

    function isQuarantineSession(workspaces, sessionId) {
      const workspace = quarantineWorkspace(workspaces)
      return workspace !== undefined && Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId)
    }

    function formatTime(ms) {
      if (!ms) return ''
      try {
        return new Date(ms).toLocaleString()
      } catch {
        return ''
      }
    }

    function formatBytes(bytes) {
      if (!bytes) return '0 B'
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    // §4 图形与样式 --------------------------------------------------------

    /** 自绘图标：一条竖直虚线的隔离舱。 */
    function Glyph(props) {
      const size = Number.isFinite(props?.size) ? props.size : 16
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('rect', { x: 2.2, y: 2.2, width: 11.6, height: 11.6, rx: 2.6 }),
        h('path', { d: 'M8 2.2v11.6', strokeDasharray: '1.6 1.6' }),
        h('circle', { cx: 5.2, cy: 8, r: 0.9, fill: 'currentColor', stroke: 'none' }),
      )
    }

    /** 行内动作图标：归档 / 取消归档 / 删除。 */
    function Icon(props) {
      const size = Number.isFinite(props?.size) ? props.size : 14
      const common = {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        style: { display: 'block' },
      }
      if (props?.name === 'trash') {
        return h(
          'svg',
          common,
          h('path', { d: 'M3 4.6h10' }),
          h('path', { d: 'M6.2 4.6V3.2h3.6v1.4' }),
          h('path', { d: 'M4.4 4.6 5 12.8h6l.6-8.2' }),
          h('path', { d: 'M6.6 7.2v3.4M9.4 7.2v3.4' }),
        )
      }
      if (props?.name === 'unarchive') {
        return h(
          'svg',
          common,
          h('rect', { x: 2.6, y: 3.2, width: 10.8, height: 3, rx: 1 }),
          h('path', { d: 'M3.6 6.2V13h8.8V6.2' }),
          h('path', { d: 'M8 12.2V8.4M6.4 10l1.6-1.6L9.6 10' }),
        )
      }
      return h(
        'svg',
        common,
        h('rect', { x: 2.6, y: 3.2, width: 10.8, height: 3, rx: 1 }),
        h('path', { d: 'M3.6 6.2V13h8.8V6.2' }),
        h('path', { d: 'M6.4 9h3.2' }),
      )
    }

    const CSS = `
.dshq-root{display:flex;flex-direction:column;gap:14px;padding:18px 22px 28px;height:100%;overflow:auto;color:var(--dsw-alias-label-primary);font-size:13px;box-sizing:border-box}
.dshq-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.dshq-head-text{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.dshq-title{margin:0;font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px}
.dshq-path{font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.dshq-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dshq-btn{display:inline-flex;align-items:center;gap:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;transition:border-color .12s ease,background .12s ease}
.dshq-btn:hover{border-color:var(--dsw-alias-brand-primary)}
.dshq-btn:disabled{opacity:.5;cursor:default}
.dshq-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dshq-btn.primary:hover{background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}
.dshq-btn.danger:hover{border-color:#e5484d;color:#e5484d}
.dshq-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.dshq-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dshq-row:last-child{border-bottom:none}
.dshq-row:hover{background:var(--dsw-alias-bg-layer-2)}
.dshq-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dshq-row-title{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshq-row-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);display:flex;gap:10px;flex-wrap:wrap}
.dshq-badge{font-size:11px;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary)}
.dshq-empty{padding:28px;text-align:center;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l1);border-radius:10px}
.dshq-error{padding:8px 12px;border-radius:8px;border:1px solid #e5484d;color:#e5484d;font-size:12px;background:color-mix(in srgb,#e5484d 10%,transparent)}
.dshq-note{padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.dshq-field{display:flex;flex-direction:column;gap:6px;max-width:760px}
.dshq-field label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dshq-input{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:7px 10px;font-size:13px;outline:none;width:100%;box-sizing:border-box}
.dshq-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dshq-tools{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px;max-height:280px;overflow:auto;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.dshq-check{display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer;padding:2px 4px;border-radius:6px}
.dshq-check:hover{background:var(--dsw-alias-bg-layer-2)}
.dshq-check code{font-size:12px;background:transparent}
.dshq-footer{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 10px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px}
.dshq-footer:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dshq-menu-item{display:flex;align-items:center;width:100%;gap:8px;background:transparent;border:none;color:var(--dsw-alias-label-primary);padding:6px 12px;font-size:13px;text-align:left;cursor:pointer;border-radius:6px}
.dshq-menu-item:hover{background:var(--dsw-alias-bg-layer-2)}
.dshq-menu-item.danger:hover{color:#e5484d}
.dshq-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshq-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dshq-icon-btn.danger:hover{color:#e5484d}
`

    // §5 内嵌面板 ----------------------------------------------------------

    function Panel(props) {
      const { ctx } = props
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)

      const refresh = useCallback(async () => {
        setBusy(true)
        try {
          const value = await api('status')
          publishConfig(value.settings)
          setState(value)
          setError('')
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        void refresh()
      }, [refresh])

      const run = useCallback(async (task) => {
        setBusy(true)
        try {
          await task()
          setError('')
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setBusy(false)
        }
      }, [])

      const newChat = () =>
        run(async () => {
          const ensured = await api('ensure')
          const workspaceId = ensured.workspace?.workspaceId
          const ui = ctx.get('uiWorkspace')
          if (workspaceId && ui) ui.startSession(workspaceId)
          await refresh()
        })

      const removeOne = (sessionId) => {
        if (!window.confirm(t('confirmOne'))) return undefined
        return run(async () => {
          await api('delete', { sessionId })
          await refresh()
        })
      }

      const clearAll = () => {
        if (!window.confirm(t('confirmClear'))) return undefined
        return run(async () => {
          await api('clear')
          await refresh()
        })
      }

      const openDir = () =>
        run(async () => {
          await api('openDir')
        })

      const settings = state?.settings
      const sessions = state?.sessions ?? []

      return h(
        'div',
        { className: 'dshq-root' },
        h(
          'div',
          { className: 'dshq-head' },
          h(
            'div',
            { className: 'dshq-head-text' },
            h('h2', { className: 'dshq-title' }, h(Glyph, { size: 18 }), settings?.title || STORE.title),
            h('div', { className: 'dshq-path' }, settings?.root ?? ''),
          ),
          h(
            'div',
            { className: 'dshq-actions' },
            h('button', { className: 'dshq-btn primary', disabled: busy, onClick: newChat }, t('newChat')),
            h('button', { className: 'dshq-btn', disabled: busy, onClick: openDir }, t('openDir')),
            h('button', { className: 'dshq-btn', disabled: busy, onClick: () => refresh() }, t('refresh')),
            sessions.length > 0
              ? h('button', { className: 'dshq-btn danger', disabled: busy, onClick: clearAll }, t('clear'))
              : null,
          ),
        ),
        error ? h('div', { className: 'dshq-error' }, `${t('failed')}：${error}`) : null,
        state && state.dirExists === false
          ? h('div', { className: 'dshq-note' }, t('missingDir', { path: settings?.root ?? '' }))
          : null,
        sessions.length === 0
          ? h('div', { className: 'dshq-empty' }, t('empty'))
          : h(
              'div',
              { className: 'dshq-list' },
              sessions.map((session) =>
                h(
                  'div',
                  { className: 'dshq-row', key: session.sessionId },
                  h(
                    'div',
                    { className: 'dshq-row-main' },
                    h('div', { className: 'dshq-row-title' }, session.title || t('emptyTitle')),
                    h(
                      'div',
                      { className: 'dshq-row-meta' },
                      h('span', null, formatTime(session.updatedAt)),
                      h('span', null, formatBytes(session.bytes)),
                      session.running ? h('span', { className: 'dshq-badge' }, t('running')) : null,
                      h('span', null, session.sessionId),
                    ),
                  ),
                  h(
                    'button',
                    {
                      className: 'dshq-btn danger',
                      disabled: busy,
                      title: session.running ? t('running') : t('deleteOne'),
                      onClick: () => removeOne(session.sessionId),
                    },
                    t('deleteOne'),
                  ),
                ),
              ),
            ),
      )
    }

    // §6 设置页 ------------------------------------------------------------

    function SettingsPage(props) {
      const [state, setState] = useState(null)
      const [draft, setDraft] = useState(null)
      const [extra, setExtra] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        setBusy(true)
        try {
          const value = await api('status')
          setState(value)
          setDraft({
            ...value.settings,
            allowedTools: [...value.settings.allowedTools],
            stripNames: [...value.settings.stripNames],
          })
          const known = new Set(value.sectionNames ?? [])
          setExtra(value.settings.stripNames.filter((name) => !known.has(name)).join(', '))
          setError('')
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      const toggleIn = (field, name) => {
        setDraft((current) => {
          if (!current) return current
          const next = new Set(current[field])
          if (next.has(name)) next.delete(name)
          else next.add(name)
          return { ...current, [field]: [...next] }
        })
      }

      const save = () => {
        if (!draft) return
        void (async () => {
          setBusy(true)
          try {
            const known = new Set(state?.sectionNames ?? [])
            const extras = extra.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
            const stripNames = [...draft.stripNames.filter((name) => known.has(name)), ...extras].filter(
              (name, index, all) => all.indexOf(name) === index,
            )
            const saved = await api('save', { settings: { ...draft, stripNames } })
            publishConfig(saved.settings)
            setNotice(t('saved'))
            setError('')
            setTimeout(() => setNotice(''), 2000)
          } catch (err) {
            setError(String(err?.message ?? err))
          } finally {
            setBusy(false)
          }
        })()
      }

      if (!draft || !state) {
        return h('div', { className: 'dshq-root' }, error ? h('div', { className: 'dshq-error' }, error) : null)
      }

      const sectionNames = state.sectionNames ?? []
      const allTools = state.allTools ?? []

      return h(
        'div',
        { className: 'dshq-root' },
        h(
          'h2',
          { className: 'dshq-title' },
          h(Glyph, { size: 18 }),
          t('title'),
          h('span', { className: 'dshq-path' }, `· ${t('settings')}`),
        ),
        error ? h('div', { className: 'dshq-error' }, `${t('failed')}：${error}`) : null,
        h(
          'div',
          { className: 'dshq-field' },
          h('label', null, t('dirLabel')),
          h('input', {
            className: 'dshq-input',
            value: draft.root,
            onChange: (event) => setDraft({ ...draft, root: event.target.value }),
          }),
          h('div', { className: 'dshq-note' }, t('dirHint')),
        ),
        h(
          'div',
          { className: 'dshq-field' },
          h('label', null, `${t('toolsLabel')}（${draft.allowedTools.filter((name) => allTools.includes(name)).length}/${allTools.length}）`),
          h('div', { className: 'dshq-note' }, t('toolsHint')),
          h(
            'div',
            { className: 'dshq-tools' },
            allTools.map((name) =>
              h(
                'label',
                { className: 'dshq-check', key: name },
                h('input', {
                  type: 'checkbox',
                  checked: draft.allowedTools.includes(name),
                  onChange: () => toggleIn('allowedTools', name),
                }),
                h('code', null, name),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dshq-field' },
          h(
            'label',
            null,
            h('input', {
              type: 'checkbox',
              checked: draft.stripPluginContext,
              onChange: () => setDraft({ ...draft, stripPluginContext: !draft.stripPluginContext }),
              style: { marginRight: 8 },
            }),
            t('stripLabel'),
          ),
          h('div', { className: 'dshq-note' }, t('stripHint')),
          h(
            'div',
            { className: 'dshq-tools' },
            sectionNames.map((name) =>
              h(
                'label',
                { className: 'dshq-check', key: name },
                h('input', {
                  type: 'checkbox',
                  checked: draft.stripNames.includes(name),
                  onChange: () => toggleIn('stripNames', name),
                }),
                h('code', null, name),
              ),
            ),
          ),
          h('input', {
            className: 'dshq-input',
            placeholder: t('extra'),
            value: extra,
            onChange: (event) => setExtra(event.target.value),
          }),
        ),
        h(
          'div',
          { className: 'dshq-actions' },
          h('button', { className: 'dshq-btn primary', disabled: busy, onClick: save }, t('save')),
          notice ? h('span', { className: 'dshq-path' }, notice) : null,
        ),
      )
    }

    // §7 会话菜单行 --------------------------------------------------------

    /**
     * 覆盖官方 `archive` 行（同一 id、更低 priority）。
     * 隔离区会话：显示「彻底删除」，删除磁盘日志；
     * 已归档会话：保留「取消归档」；
     * 其它会话：保持归档，走官方 uiWorkspace.archiveSession（含运行中确认与提示）。
     */
    function makeMenuRow(ctx) {
      return function MenuRow(props) {
        const { sessionId, displayTitle, useMenuOpenState, useWorkspaces } = props
        const snapshot = useWorkspaces ? useWorkspaces((value) => value) : undefined
        const [, setMenuOpen] = useMenuOpenState()
        const archived =
          Array.isArray(snapshot?.archivedSessionIds) && snapshot.archivedSessionIds.includes(sessionId)
        const quarantined = snapshot ? isQuarantineSession(snapshot, sessionId) : false

        const onClick = () => {
          setMenuOpen(false)
          const ui = ctx.get('uiWorkspace')
          if (quarantined) {
            if (!window.confirm(t('confirmOne'))) return
            void api('delete', { sessionId }).then(
              () => undefined,
              (err) => window.alert(`${t('failed')}：${err?.message ?? err}`),
            )
            return
          }
          if (!ui) return
          if (archived) void ui.unarchiveSession(sessionId)
          else void ui.archiveSession(sessionId)
        }

        const label = quarantined ? t('deleteOne') : archived ? t('unarchiveOne') : t('archiveOne')

        return h(
          'button',
          {
            role: 'menuitem',
            className: `dshq-menu-item${quarantined ? ' danger' : ''}`,
            title: quarantined ? displayTitle : undefined,
            onClick,
          },
          label,
        )
      }
    }

    // §8 侧边栏底部入口 ----------------------------------------------------

    /**
     * 覆盖行尾悬停按钮里的 `archive`（同一 id、更低 priority）。
     * 隔离区会话：变成删除按钮；已归档：取消归档；其它：归档。
     */
    function makeRowAction(ctx) {
      return function RowAction(props) {
        const { sessionId, useWorkspaces } = props
        const snapshot = useWorkspaces ? useWorkspaces((value) => value) : undefined
        const archived =
          Array.isArray(snapshot?.archivedSessionIds) && snapshot.archivedSessionIds.includes(sessionId)
        const quarantined = snapshot ? isQuarantineSession(snapshot, sessionId) : false
        const kind = quarantined ? 'trash' : archived ? 'unarchive' : 'archive'
        const label = quarantined ? t('deleteOne') : archived ? t('unarchiveOne') : t('archiveOne')

        const onClick = () => {
          if (quarantined) {
            if (!window.confirm(t('confirmOne'))) return
            void api('delete', { sessionId }).then(
              () => undefined,
              (err) => window.alert(`${t('failed')}：${err?.message ?? err}`),
            )
            return
          }
          const ui = ctx.get('uiWorkspace')
          if (!ui) return
          if (archived) void ui.unarchiveSession(sessionId)
          else void ui.archiveSession(sessionId)
        }

        return h(
          'button',
          {
            type: 'button',
            className: `dshq-icon-btn${quarantined ? ' danger' : ''}`,
            title: label,
            'aria-label': label,
            onClick,
          },
          h(Icon, { name: kind, size: 14 }),
        )
      }
    }

    function makeFooterEntry(ctx) {
      return function FooterEntry(props) {
        const wide = props?.wide !== false
        return h(
          'button',
          {
            className: 'dshq-footer',
            title: t('open'),
            onClick: () => {
              const layout = ctx.get('layout')
              if (layout?.selectPanel) layout.selectPanel('quarantine')
            },
          },
          h(Glyph, { size: 16 }),
          wide ? h('span', null, t('title')) : null,
        )
      }
    }

    // §9 注册 --------------------------------------------------------------

    const inject = ['slots']

    function apply(ctx) {
      try {
        const current = ctx.get('locale')?.getLocale?.()
        if (current?.id) localeId = String(current.id).startsWith('zh') ? 'zh' : 'en'
      } catch {
        localeId = 'zh'
      }

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-quarantine', '')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-quarantine: styles')

      // 预取配置给会话菜单行用；设置保存后会再刷新一次。
      void api('status').then(
        (value) => publishConfig(value.settings),
        () => undefined,
      )

      const MenuRow = makeMenuRow(ctx)
      const RowAction = makeRowAction(ctx)
      const FooterEntry = makeFooterEntry(ctx)

      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: 'quarantine', inject: () => ({ ctx }) }, Panel),
      )

      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'dsh-quarantine', order: 20, label: t('title') },
          FooterEntry,
        ),
      )

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'dsh-quarantine', order: 60, label: t('title'), inject: () => ({ ctx }) },
          SettingsPage,
        ),
      )

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: 'archive',
            order: 400,
            // list 槽按 priority 升序排，最低的那条渲染；官方是 0，所以用负数覆盖它。
            priority: -10,
            inject: () => ({ ctx }),
          },
          MenuRow,
        ),
      )

      ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.row.action',
            id: 'archive',
            order: 100,
            priority: -10,
            inject: () => ({ ctx }),
          },
          RowAction,
        ),
      )
    }

    return { apply, inject }
  },
})
