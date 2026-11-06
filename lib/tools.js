/**
 * 工具注册表读取。
 *
 * 注意两个视角的区别：
 *  - 全局视角（无 scope）只包含插件在根上下文注册的工具；
 *  - agent 视角还会包含 preset 作用域里注册的工具（官方与 dsh-ops 的基础工具就在这里）。
 *
 * `tools.restrict()` 只能遮蔽全局工具，所以隔离区用「deny = 全局 − 白名单」。
 */

/** 当前进程里已注册的所有全局工具名。 */
export function registeredToolNames(ctx) {
  try {
    return ctx.tools.schemas().map((schema) => schema.name)
  } catch {
    return []
  }
}
