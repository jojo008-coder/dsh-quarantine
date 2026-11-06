/**
 * 隔离区领域服务：把设置、工作区、会话、工具、提示段落聚成一个对象，
 * HTTP 层只负责把 op 映射到这里的某个方法。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { readSettings, writeSettings } from './settings.js'
import { registeredToolNames } from './tools.js'
import { createWorkspaceAccess } from './workspace.js'
import { createSessionStore } from './sessions.js'
import { openDirectory } from './paths.js'

export function createQuarantineService(ctx) {
  const getSettings = () => readSettings()
  const workspace = createWorkspaceAccess(ctx, getSettings)
  const sessions = createSessionStore(ctx, { getSettings, findWorkspace: workspace.find })

  /** 最近处理过的隔离区 agent，供 status 诊断用（只留最近 20 条）。 */
  const policyRecords = new Map()
  function notePolicy(info) {
    if (!info?.sessionId) return
    policyRecords.delete(info.sessionId)
    policyRecords.set(info.sessionId, { ...info, at: Date.now() })
    while (policyRecords.size > 20) policyRecords.delete(policyRecords.keys().next().value)
  }

  /** 当前装配里会出现哪些提示段落的名字（设置页用来做勾选项）。 */
  async function sectionNames() {
    try {
      const assembly = await ctx.systemPrompt.assemble({})
      const names = [
        ...assembly.sections.map((section) => section.name),
        ...assembly.contexts.map((entry) => entry.name),
      ]
      return names.filter((name, index, all) => all.indexOf(name) === index).sort()
    } catch {
      return []
    }
  }

  async function status() {
    const settings = getSettings()
    const current = workspace.find()
    const [sessionsList, sections] = await Promise.all([sessions.list(), sectionNames()])
    return {
      settings,
      workspace: current ? { workspaceId: current.id, title: current.title, path: current.path } : null,
      dirExists: existsSync(settings.root),
      sessions: sessionsList,
      allTools: registeredToolNames(ctx).sort(),
      sectionNames: sections,
      policy: [...policyRecords.values()],
    }
  }

  function ensureDirectory() {
    const settings = getSettings()
    if (!existsSync(settings.root)) mkdirSync(settings.root, { recursive: true })
    return settings.root
  }

  function revealDirectory() {
    const root = ensureDirectory()
    if (!openDirectory(root)) throw new Error('无法打开目录')
    return root
  }

  return {
    get settings() {
      return getSettings()
    },
    saveSettings: (patch) => writeSettings(patch),
    ensureWorkspace: () => workspace.ensure(),
    findWorkspace: () => workspace.find(),
    listSessions: () => sessions.list(),
    deleteSession: (sessionId) => sessions.remove(sessionId),
    clearSessions: () => sessions.clear(),
    sectionNames,
    status,
    notePolicy,
    ensureDirectory,
    revealDirectory,
  }
}
