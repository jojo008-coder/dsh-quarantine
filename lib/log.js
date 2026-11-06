/**
 * 诊断日志：写到 <DSH_HOME>/dsh-quarantine.log。
 *
 * 插件跑在宿主进程里，界面只能看到「没生效」，看不到为什么；
 * 所以策略安装失败、删除失败这类事落一份文件，方便事后查。
 */
import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './paths.js'

const MAX_BYTES = 256 * 1024

export function logPath() {
  return join(dshHome(), 'dsh-quarantine.log')
}

export function logLine(message) {
  try {
    const home = dshHome()
    mkdirSync(home, { recursive: true })
    const file = logPath()
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`)
    } catch {
      /* 文件还不存在 */
    }
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    /* 日志失败不影响主流程 */
  }
}

export function describeError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack ?? ''}`
  return String(error)
}
