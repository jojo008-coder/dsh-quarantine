/**
 * 隔离区工作区：查找与创建。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { samePath } from './paths.js'

export function createWorkspaceAccess(ctx, getSettings) {
  /** 设置里那个目录对应的工作区，没有就是 null。 */
  function find() {
    const root = getSettings().root
    try {
      return ctx.workspaceRegistry.list().find((workspace) => samePath(workspace.path, root)) ?? null
    } catch {
      return null
    }
  }

  /** 建目录 + 建工作区（幂等）。 */
  async function ensure() {
    const settings = getSettings()
    const root = resolve(settings.root)
    if (!existsSync(root)) mkdirSync(root, { recursive: true })
    const existing = find()
    if (existing) {
      return { workspaceId: existing.id, title: existing.title, path: existing.path, created: false }
    }
    const created = await ctx.workspaceRegistry.create(root, settings.title)
    return { workspaceId: created.id, title: created.title, path: created.path, created: true }
  }

  return { find, ensure }
}
