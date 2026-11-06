/**
 * 客户端与宿主之间的 HTTP 接口。
 *
 * 路由走 webServer 前缀注册，和页面同源；用一个自定义请求头做跨站防护：
 * 浏览器对带自定义头的跨域请求会先发预检，而本路由不返回 CORS 头，跨站页面因此发不出来。
 */
export const API_PATH = '/dsh-quarantine'
export const API_HEADER = 'x-dsh-quarantine'

function sendJson(response, code, value) {
  response.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

/** op → service 方法。未列出的 op 一律拒绝。 */
function dispatch(service, op, payload) {
  switch (op) {
    case 'status':
      return service.status()
    case 'ensure':
      return service.ensureWorkspace().then((workspace) => ({ workspace }))
    case 'save':
      return { settings: service.saveSettings(payload?.settings ?? {}) }
    case 'list':
      return service.listSessions().then((sessions) => ({ sessions }))
    case 'delete':
      return service.deleteSession(String(payload?.sessionId ?? '')).then((result) => ({ result }))
    case 'clear':
      return service.clearSessions()
    case 'openDir':
      return { path: service.revealDirectory() }
    default:
      return Promise.reject(new Error(`未知操作：${String(op)}`))
  }
}

export function createHttpHandler(service) {
  return function handler(request, response) {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: '只接受 POST' })
      return
    }
    if (String(request.headers[API_HEADER] ?? '') !== '1') {
      sendJson(response, 403, { ok: false, error: '缺少调用标头' })
      return
    }

    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let payload = {}
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        payload = raw ? JSON.parse(raw) : {}
      } catch {
        sendJson(response, 400, { ok: false, error: '请求体不是合法 JSON' })
        return
      }
      Promise.resolve()
        .then(() => dispatch(service, String(payload?.op ?? ''), payload))
        .then((value) => sendJson(response, 200, { ok: true, ...value }))
        .catch((error) =>
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
    })
  }
}
