/**
 * dsh-quarantine — 隔离区（宿主入口）。
 *
 * 一个「隔离区」就是一个普通工作区，区别只有四点：
 *  1. 目录固定/可配置，判定按会话 cwd 是否位于该目录之下；
 *  2. 该目录里的会话只保留白名单工具，其余已装插件的工具不可见、不可执行；
 *  3. 可配置地剔除指定提示段落（例如 MNEMON 记忆快照、persona）；
 *  4. 会话「…」菜单里的归档被换成彻底删除，删的是磁盘日志而不是加进归档。
 *
 * 宿主不注册任何工具、不改会话日志格式。各职责见 lib/ 下的模块。
 */
import { API_PATH, createHttpHandler } from './lib/api.js'
import { installQuarantinePolicy } from './lib/policy.js'
import { createQuarantineService } from './lib/service.js'

/** 缺任何一个都不激活，避免在别的 profile 组合里半死不活。 */
export const inject = [
  'tools',
  'webServer',
  'systemPrompt',
  'workspaceRegistry',
  'sessionController',
  'sessionPersistence',
  'agents',
  'workingDirectory',
]

export function apply(ctx) {
  const service = createQuarantineService(ctx)

  const disposePolicy = installQuarantinePolicy(ctx, () => service.settings, service.notePolicy)
  ctx.effect(() => disposePolicy, 'dsh-quarantine: policy')

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PATH,
        handler: createHttpHandler(service),
      }),
    'dsh-quarantine: http api',
  )
}
