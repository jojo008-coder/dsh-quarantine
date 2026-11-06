/**
 * 插件设置：默认值 + 读写 <DSH_HOME>/dsh-quarantine.json。
 *
 * 设置不写进 cordis.patch.yml，因为用户要在设置页里改；见 README 的「配置」一节。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './paths.js'

/** 默认放行的工具：官方基础工具 + dsh-ops 的 shell/file 工具。缺失的名字在生效前会被过滤掉。 */
export const DEFAULT_TOOLS = [
  'bash', 'read', 'write', 'edit', 'glob', 'grep', 'read_image', 'present', 'todo_write',
  'ops_bash', 'ops_read_files', 'ops_glob', 'ops_grep', 'ops_inspect_local_file', 'ops_result', 'ops_discover_tools',
  'web_search', 'web_fetch',
  'ask_user_question', 'exit_plan_mode',
  'subagent', 'subagent_fork', 'list_agents', 'send_message', 'interrupt_agent', 'list_subagent_models',
  'job_list', 'job_output', 'job_kill',
  'workflow', 'create_goal', 'get_goal', 'update_goal',
  'schedule_create', 'schedule_list', 'schedule_update', 'schedule_delete',
  'skill',
]

export const DEFAULT_SETTINGS = {
  root: 'D:\\dshworking\\quarantine',
  title: '隔离区',
  allowedTools: DEFAULT_TOOLS,
  stripPluginContext: true,
  stripNames: ['mnemon', 'persona'],
}

export function settingsPath() {
  return join(dshHome(), 'dsh-quarantine.json')
}

function toStringArray(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  return value.map((item) => String(item)).filter((item) => item.length > 0)
}

function normalize(candidate) {
  const merged = { ...DEFAULT_SETTINGS, ...candidate }
  merged.allowedTools = toStringArray(merged.allowedTools, DEFAULT_TOOLS)
  merged.stripNames = toStringArray(merged.stripNames, DEFAULT_SETTINGS.stripNames)
  merged.root = typeof merged.root === 'string' && merged.root.trim() ? merged.root.trim() : DEFAULT_SETTINGS.root
  merged.title = typeof merged.title === 'string' && merged.title.trim() ? merged.title.trim() : DEFAULT_SETTINGS.title
  merged.stripPluginContext = merged.stripPluginContext !== false
  return merged
}

export function readSettings() {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    if (parsed && typeof parsed === 'object') return normalize(parsed)
  } catch {
    /* 未初始化或文件损坏：用默认值 */
  }
  return normalize({})
}

export function writeSettings(patch) {
  const merged = normalize({ ...readSettings(), ...(patch ?? {}) })
  if (!merged.root) throw new Error('隔离区目录不能为空')
  if (!/^[A-Za-z]:[\\/]/.test(merged.root) && !merged.root.startsWith('\\\\')) {
    throw new Error('隔离区目录必须是绝对路径')
  }
  const target = settingsPath()
  mkdirSync(dshHome(), { recursive: true })
  if (!existsSync(dshHome())) throw new Error('无法创建 DSH 数据目录')
  writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  return merged
}
