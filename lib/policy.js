/**
 * 每个隔离区 agent 的策略：工具白名单 + 提示段落剔除。
 *
 * 判定口径是「会话 cwd 是否位于隔离区目录下」，与工作区分组无关，
 * 所以用户在隔离区目录里新建、或者把会话挪进这个目录，行为都一致。
 *
 * 两层执行：
 *  - `tools.restrict({ allow })` 装在 agent 自己的 ctx 上，决定模型能看见什么；
 *  - 一个全局 `tools.guard`，按执行方的 agent 判定，兜住 restrict 拿不到的服务、
 *    以及后来才注册的工具（guard 是单调的，任何匹配的 guard 都能拒绝）。
 */
import { isUnder } from './paths.js'
import { registeredToolNames } from './tools.js'
import { describeError, logLine } from './log.js'

export function installQuarantinePolicy(ctx, getSettings, report = () => {}) {
  /** 已判定为隔离区的 agent 与其 ctx，供 guard 与 system-prompt/assemble 比对。 */
  const quarantineScopes = new WeakSet()

  function safeCount(fn) {
    try {
      return fn().length
    } catch (error) {
      return `err:${error instanceof Error ? error.message : String(error)}`
    }
  }

  function sessionCwd(agent) {
    try {
      return ctx.workingDirectory.get(agent.session)
    } catch {
      return agent.session?.header?.cwd
    }
  }

  /**
   * 判定要动态做：插件加载前就已经存在的 agent 不在 WeakSet 里，
   * 但只要它还在隔离区目录下，就要受约束。
   */
  function isQuarantineAgent(agent) {
    if (quarantineScopes.has(agent)) return true
    const cwd = sessionCwd(agent)
    return cwd !== undefined && isUnder(getSettings().root, cwd)
  }

  function applyAgentPolicy(agent, cwd) {
    quarantineScopes.add(agent)
    if (agent.ctx) quarantineScopes.add(agent.ctx)

    agent.ctx.effect(() => {
      const disposers = []
      const diag = {}
      try {
        const tools = agent.ctx.tools ?? agent.ctx.get('tools')
        const allow = new Set(getSettings().allowedTools)
        // 只能遮蔽「全局」工具（插件工具都在全局注册），preset 作用域里的工具遮不掉，
        // 所以用 deny = 全局 − 白名单，而不是 allow = 白名单 ∩ 全局。
        const deny = registeredToolNames(ctx).filter((name) => !allow.has(name) && name !== 'run_code')
        diag.denyCount = deny.length
        diag.schemasBefore = safeCount(() => tools.schemas(agent))
        if (tools && deny.length > 0) {
          disposers.push(tools.restrict({ deny }))
        }
        diag.schemasAfter = safeCount(() => tools.schemas(agent))
        diag.rootViewCount = safeCount(() => ctx.tools.schemas(agent))
        diag.globalCount = safeCount(() => ctx.tools.schemas())
        const prompt = agent.ctx.get('systemPrompt')
        if (prompt && typeof prompt.suppressRuntimeContext === 'function') {
          disposers.push(prompt.suppressRuntimeContext())
        }
        report({ sessionId: agent.id, cwd, applied: true, diag })
      } catch (error) {
        report({ sessionId: agent.id, cwd, applied: false, diag, error: describeError(error) })
        logLine(`[policy] 安装失败 session=${agent.id} cwd=${cwd}\n${describeError(error)}`)
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* 已经释放 */
          }
        }
      }
    }, 'dsh-quarantine: quarantine agent policy')
  }

  function filterAssembly(result, context) {
    const settings = getSettings()
    if (!settings.stripPluginContext || settings.stripNames.length === 0) return result
    const scope = context?.scope
    if (!scope || !isQuarantineAgent(scope)) return result
    const denied = (name) =>
      settings.stripNames.some((needle) => String(name).toLowerCase().includes(String(needle).toLowerCase()))
    try {
      return {
        ...result,
        sections: result.sections.filter((section) => !denied(section.name)),
        contexts: result.contexts.filter((entry) => !denied(entry.name)),
      }
    } catch {
      return result
    }
  }

  const disposers = []

  // 全局兜底：按执行方 agent 判定，不依赖 per-agent 注册是否成功。
  try {
    disposers.push(
      ctx.tools.guard((execution) => {
        const agent = execution.agent
        if (!agent || !isQuarantineAgent(agent)) return undefined
        const allow = getSettings().allowedTools
        return allow.includes(execution.name) ? undefined : `隔离区不允许调用工具 ${execution.name}`
      }),
    )
  } catch (error) {
    logLine(`[policy] 全局 guard 安装失败\n${describeError(error)}`)
  }

  disposers.push(
    ctx.on('agent/created', (payload) => {
      const agent = payload?.agent
      if (!agent) return
      const cwd = sessionCwd(agent)
      const matched = cwd !== undefined && isUnder(getSettings().root, cwd)
      report({ sessionId: agent.id, cwd, matched, applied: false })
      if (!matched) return
      applyAgentPolicy(agent, cwd)
    }),
  )

  disposers.push(
    ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      const result = await next()
      return filterAssembly(result, context)
    }),
  )

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* 已经释放 */
      }
    }
  }
}
