# dsh-quarantine

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的隔离区工作区插件。

DSH 的插件是**进程级**的：装进 profile 之后对每个会话都生效。这个插件另开一个工作区当「隔离区」，里面的对话：

- 只保留你放行的工具，已装插件注册的工具默认**看不见**；
- **不进入归档**，会话菜单里的「归档」换成「彻底删除」；
- 删除是真删：把 `sessions/` 下那个会话目录从磁盘移除，而不是加进归档列表。

## 能力与边界

| 需求 | 是否做到 | 手段 |
| --- | --- | --- |
| 独立工作区 | ✅ | 按会话 `cwd` 是否位于隔离区目录下判定 |
| 不用已装插件的工具 | ✅ | `tools.restrict({ deny })` 遮蔽全局工具 + `tools.guard` 执行层兜底 |
| 插件不自动写记忆 | ✅（模型侧） | `mnemon_*` 这类工具既不可见也调不动 |
| 不进归档 | ✅ | 覆盖会话「…」菜单与行尾按钮的 `archive` |
| 直接删除对话 | ✅ | 摘登记 → 删会话目录 → 清投影缓存 |
| 隐藏已装插件的 UI | ❌ | 面板图标、皮肤、宠物是全局 UI，同进程无法按会话隐藏 |
| 拦住插件后台写盘 | ❌ | 成本账本、后台任务这类不经过工具的写入拦不住 |

### 关于「看不见」的准确含义

`tools.restrict()` 只能遮蔽**全局注册**的工具（插件都在根上下文注册，所以插件工具能被遮掉）。
官方与 `dsh-ops` 的基础工具是在 **agent preset 作用域**里注册的，`restrict` 遮不掉——但它们本来就在白名单里，属于要保留的能力。
万一以后有第三方工具也注册进 preset 作用域，它会对模型可见，但**执行时仍会被 guard 拒绝**。

> 想要「连进程都独立」的版本，得另起一个 DSH 实例（独立 `DSH_HOME` + 干净 profile），那是另一套实现；本插件走的是同进程路线。

## 安装

```bash
# 方式一：在 DSH 里让 agent 调 plugin_manager
#   action: install_bundle
#   target: <本仓库的绝对路径>

# 方式二：CLI
dsh plugin --profile desktop add <本仓库的绝对路径>
```

装完无需重启：侧边栏底部会出现「隔离区」入口，设置里会出现「隔离区」页。

## 使用

1. 点侧边栏底部的「隔离区」图标，或 设置 → 隔离区；
2. 面板里点「新建对话」，第一次会自动创建隔离区目录和工作区；
3. 隔离区里的对话，在会话「…」菜单和行尾悬停按钮里只有「彻底删除」；
4. 「清空全部」会逐个删除，正在运行的会话会被跳过并报告。

## 配置

设置页写入 `<DSH_HOME>/dsh-quarantine.json`（Windows 默认 `C:\Users\<你>\.dsh\dsh-quarantine.json`）：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `root` | `D:\dshworking\quarantine` | 隔离区目录，必须是绝对路径 |
| `title` | `隔离区` | 工作区显示名 |
| `allowedTools` | 见 `lib/settings.js` | 放行名单：官方基础工具 + `dsh-ops` 的 `ops_*`。名单外的全局工具一律禁止 |
| `stripPluginContext` | `true` | 是否剔除提示段落 |
| `stripNames` | `["mnemon", "persona"]` | 按段落名「包含」匹配剔除 |

设置页的「插件工具」列表列出的是**已装插件在全局注册的工具**，默认全部不勾选；勾选即放行。

## 目录结构

```
dsh-quarantine/
├── index.js              # 宿主入口：装配 service / policy / HTTP
├── client.js             # 客户端单文件 bundle（DSH 限制，见下）
├── cordis.patch.yml      # bundle patch：插入一行 dsh-quarantine
├── lib/
│   ├── api.js            # HTTP 路由与 op 派发
│   ├── log.js            # 诊断日志（<DSH_HOME>/dsh-quarantine.log）
│   ├── paths.js          # DSH_HOME、projectKey、会话目录
│   ├── policy.js         # agent 白名单 + 提示段落剔除
│   ├── service.js        # 领域服务：status/list/delete/clear
│   ├── sessions.js       # 会话列表、彻底删除、批量清空
│   ├── settings.js       # 默认值 + 设置文件读写
│   ├── tools.js          # 工具注册表读取
│   └── workspace.js      # 隔离区工作区查找/创建
├── locale/{zh,en}.json   # 插件管理页的标题与描述
└── icon.svg
```

客户端为什么只有一个文件：DSH 的 Module Loader 每个包只加载一个 `./client` bundle，chunk 只服务于编译器生成的 `require.async`，普通多文件相对 import 不被支持。所以 `client.js` 内部按 `§1…§9` 分节。

## 工作原理

**判定**：取会话 cwd，落在 `root` 之下即视为隔离区。判定在每次工具调用和提示装配时动态做，插件加载前就已存在的 agent 也覆盖。

**工具白名单**：

- `tools.restrict({ deny })` 装在 agent 自己的 ctx 上，`deny = 全局工具 − 放行名单`；
- 一个全局 `tools.guard` 按执行方 agent 判定，名单外一律拒绝（覆盖预设作用域里的工具、以及后来才注册的工具）。

两者都挂在 `agent.ctx.effect` / 插件 effect 上，agent 销毁或插件卸载自动摘除。

**提示剔除**：监听 `system-prompt/assemble`，只对隔离区 agent 生效，按名字包含匹配删掉对应 section / context。

**删除**（`lib/sessions.js`）：

1. 校验 cwd 属于隔离区、会话没在运行；
2. `unarchiveSession` / `unpinSession` / `workspace.detachSession` 摘掉登记；
3. 删 `<DSH_HOME>/sessions/<projectKey(cwd)>/<sessionId>/`；
4. 删投影缓存里的单会话文件。

**接口**：宿主用 `webServer.register` 注册 `/dsh-quarantine` 前缀路由，客户端同源 `fetch`。跨站防护靠自定义请求头 `x-dsh-quarantine: 1`——跨域请求会先触发预检，而本路由不返回 CORS 头。

## 已知限制

- **同进程**：已装插件的 UI 无法按会话隐藏；它们的后台写入（账本、定时任务）也拦不住。
- **预设作用域的工具遮不掉**：只遮全局；这类工具执行时由 guard 拒绝，但模型仍会看到它。
- **删「当前正打开」的会话会留一行幽灵**：日志确实删了，但宿主内存里还挂着它的 agent，侧边栏那一行要等页面重载 / 重启才消失（本插件面板已经过滤掉这类幽灵）。先切到别的会话再删就没这个问题。
- **归档行是覆盖实现**：复用 `archive` 这个 id，并给一个比官方更低的 `priority`（list 槽按 priority 升序、最低者渲染）。DSH 若改了菜单机制，这一行可能失效。
- **删除运行中的会话会被拒绝**，需要先停止。
- Windows 上如果日志文件仍被占用，删除会报错而不是强删。

排查问题看 `<DSH_HOME>/dsh-quarantine.log`；设置页的 `/dsh-quarantine` `status` 里也带最近处理过的 agent 诊断（`policy`）。

## 开发

无构建步骤，改完直接装上试：

```bash
node --check index.js
node --check client.js
for f in lib/*.js; do node --check "$f"; done
```

宿主代码改动需要重新激活 bundle（关掉再打开，或重启 DSH）；客户端产物改动需要 DSH 重新扫描 bundle 后刷新页面。

## License

MIT
