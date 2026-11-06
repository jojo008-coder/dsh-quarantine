/**
 * 路径与命名：宿主侧所有文件系统位置都在这里推导，避免各处各算一套。
 *
 * 会话目录布局必须与 @deepseek-ai/dsh-session-persistence-jsonl 保持一致：
 *   <DSH_HOME>/sessions/<projectKey(cwd)>/<encodeSegment(sessionId)>/session.v4.jsonl.zstd
 */
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

/** DSH 数据根目录；桌面端与 CLI 都会设置 DSH_HOME。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 比较用的规范路径：绝对化、去尾部分隔符、Windows 下小写。 */
export function normalizePath(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  let out = resolve(value).replace(/[\\/]+$/, '')
  if (process.platform === 'win32') out = out.toLowerCase()
  return out
}

export function samePath(a, b) {
  const left = normalizePath(a)
  return left !== '' && left === normalizePath(b)
}

/** cwd 是否位于 root 之下（含 root 本身）。 */
export function isUnder(root, cwd) {
  const base = normalizePath(root)
  const target = normalizePath(cwd)
  if (!base || !target) return false
  const separator = process.platform === 'win32' ? '\\' : '/'
  return target === base || target.startsWith(base + separator)
}

/** 与 dsh-session-persistence-jsonl 的 projectKey 一致的目录名。 */
export function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index)
    const char = String.fromCharCode(code)
    if (char === '/' || char === '\\' || char === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (char !== '~' && /^[A-Za-z0-9._-]$/.test(char)) {
      readable += char
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/** 与 dsh-session-persistence-jsonl 的 encodeSegment 一致。 */
export function encodeSegment(raw) {
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index += 1) {
    const char = String.fromCharCode(raw.charCodeAt(index))
    if (char !== '~' && /^[A-Za-z0-9._-]$/.test(char)) out += char
    else out += `~${raw.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/** 一个会话在磁盘上的目录。 */
export function sessionDirectory(cwd, sessionId) {
  return join(dshHome(), 'sessions', projectKey(cwd), encodeSegment(sessionId))
}

/** 会话投影缓存的单会话文件（可选，存在就删）。 */
export function projectionCacheFile(sessionId) {
  return join(dshHome(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
}

/** 用系统文件管理器打开目录。 */
export function openDirectory(path) {
  try {
    if (process.platform === 'win32') spawn('explorer.exe', [path], { detached: true, stdio: 'ignore' }).unref()
    else if (process.platform === 'darwin') spawn('open', [path], { detached: true, stdio: 'ignore' }).unref()
    else spawn('xdg-open', [path], { detached: true, stdio: 'ignore' }).unref()
    return true
  } catch {
    return false
  }
}
