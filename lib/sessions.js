/**
 * 隔离区会话的列表、彻底删除、批量清空。
 *
 * DSH 没有「删除会话」的 API（只有归档），所以删除分四步：
 *   1. 校验：会话 cwd 必须在隔离区目录下，且会话没有在运行；
 *   2. 摘登记：unarchive / unpin / workspace.detachSession；
 *   3. 删日志：rm -rf sessions/<projectKey>/<sessionId>；
 *   4. 清缓存：删掉投影缓存的单会话文件（可选）。
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isUnder, projectionCacheFile, sessionDirectory } from './paths.js'

/** 会话摘要里的显示标题（标题是会话投影，不是 summary 的顶层字段）。 */
export function summaryTitle(summary) {
  const values = summary?.projections?.values
  if (values && typeof values === 'object') {
    const candidate = values.title ?? values.sessionTitle ?? values.name
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

export function createSessionStore(ctx, { getSettings, findWorkspace }) {
  async function cwdOf(sessionId) {
    try {
      const snapshot = await ctx.sessionPersistence.stat(sessionId, { signal: new AbortController().signal })
      return snapshot?.header?.cwd
    } catch {
      return undefined
    }
  }

  function bytesOf(cwd, sessionId) {
    const directory = sessionDirectory(cwd, sessionId)
    if (!existsSync(directory)) return 0
    let bytes = 0
    try {
      for (const entry of readdirSync(directory)) {
        if (!entry.startsWith('session.')) continue
        try {
          bytes += statSync(join(directory, entry)).size
        } catch {
          /* 文件正在被重写 */
        }
      }
    } catch {
      /* 目录不可读 */
    }
    return bytes
  }

  /** 隔离区目录下的会话，按最后活动倒序。 */
  async function list() {
    const root = getSettings().root
    let items = []
    try {
      const value = await ctx.sessionController.list({}, new AbortController().signal)
      items = Array.isArray(value?.items) ? value.items : []
    } catch {
      items = []
    }
    const rows = []
    for (const item of items) {
      if (item.origin === 'subagent') continue
      if (!item.cwd || !isUnder(root, item.cwd)) continue
      const onDisk = existsSync(sessionDirectory(item.cwd, item.sessionId))
      // 刚建的空会话还没落盘；被删掉但宿主内存里仍挂着的会话则两者都不是，过滤掉。
      if (!onDisk && item.blank !== true) continue
      rows.push({
        sessionId: item.sessionId,
        title: summaryTitle(item),
        cwd: item.cwd,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
        running: item.running === true,
        bytes: bytesOf(item.cwd, item.sessionId),
        onDisk,
      })
    }
    rows.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
    return rows
  }

  async function remove(sessionId) {
    const settings = getSettings()
    const cwd = await cwdOf(sessionId)
    if (!cwd) throw new Error('找不到这个会话的日志，可能已经被删除')
    if (!isUnder(settings.root, cwd)) throw new Error('这个会话不属于隔离区，拒绝删除')
    // 打开着的会话也有 agent，但只要不在跑，日志就是可删的（实测空闲时目录不锁）。
    const agent = ctx.agents.get(sessionId)
    if (agent && agent.status === 'running') throw new Error('会话正在运行，请先停止再删除')

    try {
      await ctx.workspaceRegistry.unarchiveSession(sessionId)
    } catch {
      /* 本来就没归档 */
    }
    try {
      await ctx.workspaceRegistry.unpinSession(sessionId)
    } catch {
      /* 本来就没置顶 */
    }
    try {
      const workspace = findWorkspace()
      if (workspace) await workspace.detachSession(sessionId)
    } catch {
      /* 登记已经不在 */
    }

    const directory = sessionDirectory(cwd, sessionId)
    let removed = false
    try {
      if (existsSync(directory)) {
        rmSync(directory, { recursive: true, force: true })
        removed = true
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`会话日志删除失败（可能仍被占用）：${message}`)
    }

    try {
      rmSync(projectionCacheFile(sessionId), { force: true })
    } catch {
      /* 缓存不是必需 */
    }

    return { sessionId, removed, cwd }
  }

  /** 清空隔离区：运行中的会话跳过并报告。 */
  async function clear() {
    const sessions = await list()
    const ids = sessions.map((session) => session.sessionId).filter((id, index, all) => all.indexOf(id) === index)
    const deleted = []
    const failed = []
    for (const sessionId of ids) {
      try {
        await remove(sessionId)
        deleted.push(sessionId)
      } catch (error) {
        failed.push({ sessionId, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { deleted, failed }
  }

  return { list, remove, clear }
}
