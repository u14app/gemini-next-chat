### 使用 Cloudflare Worker 代理 Multimodal Live API

使用 Cloudflare 仪表板创建您的第一个 Worker：

1. 登录 Cloudflare 仪表板并选择您的帐户。
2. 选择 Compute(Workers) > 创建应用程序。
3. 选择 创建 Worker > 部署。

### Worker 脚本

复制以下代码替换原有的 `worker.js` 代码，然后点击 部署。
以下代码来源于 [gemini-proxy](https://github.com/tech-shrimp/gemini-proxy/blob/main/worker.js)。

```javascript
export default {
  async fetch(request, env, ctx) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket connection', { status: 400 })
    }

    const url = new URL(request.url)
    const pathAndQuery = url.pathname + url.search
    const targetUrl = `wss://generativelanguage.googleapis.com${pathAndQuery}`

    console.log('Target URL:', targetUrl)

    const [client, proxy] = new WebSocketPair()
    proxy.accept()

    // 用于存储在连接建立前收到的消息
    let pendingMessages = []

    const connectPromise = new Promise((resolve, reject) => {
      const targetWebSocket = new WebSocket(targetUrl)

      console.log('Initial targetWebSocket readyState:', targetWebSocket.readyState)

      targetWebSocket.addEventListener('open', () => {
        console.log('Connected to target server')
        console.log('targetWebSocket readyState after open:', targetWebSocket.readyState)

        // 连接建立后，发送所有待处理的消息
        console.log(`Processing ${pendingMessages.length} pending messages`)
        for (const message of pendingMessages) {
          try {
            targetWebSocket.send(message)
            console.log('Sent pending message:', message.slice(0, 100))
          } catch (error) {
            console.error('Error sending pending message:', error)
          }
        }
        pendingMessages = [] // 清空待处理消息队列
        resolve(targetWebSocket)
      })

      proxy.addEventListener('message', async (event) => {
        console.log('Received message from client:', {
          dataPreview: typeof event.data === 'string' ? event.data.slice(0, 200) : 'Binary data',
          dataType: typeof event.data,
          timestamp: new Date().toISOString(),
        })

        if (targetWebSocket.readyState === WebSocket.OPEN) {
          try {
            targetWebSocket.send(event.data)
            console.log('Successfully sent message to gemini')
          } catch (error) {
            console.error('Error sending to gemini:', error)
          }
        } else {
          // 如果连接还未建立，将消息加入待处理队列
          console.log('Connection not ready, queueing message')
          pendingMessages.push(event.data)
        }
      })

      targetWebSocket.addEventListener('message', (event) => {
        console.log('Received message from gemini:', {
          dataPreview: typeof event.data === 'string' ? event.data.slice(0, 200) : 'Binary data',
          dataType: typeof event.data,
          timestamp: new Date().toISOString(),
        })

        try {
          if (proxy.readyState === WebSocket.OPEN) {
            proxy.send(event.data)
            console.log('Successfully forwarded message to client')
          }
        } catch (error) {
          console.error('Error forwarding to client:', error)
        }
      })

      targetWebSocket.addEventListener('close', (event) => {
        console.log('Gemini connection closed:', {
          code: event.code,
          reason: event.reason || 'No reason provided',
          wasClean: event.wasClean,
          timestamp: new Date().toISOString(),
          readyState: targetWebSocket.readyState,
        })
        if (proxy.readyState === WebSocket.OPEN) {
          proxy.close(event.code, event.reason)
        }
      })

      proxy.addEventListener('close', (event) => {
        console.log('Client connection closed:', {
          code: event.code,
          reason: event.reason || 'No reason provided',
          wasClean: event.wasClean,
          timestamp: new Date().toISOString(),
        })
        if (targetWebSocket.readyState === WebSocket.OPEN) {
          targetWebSocket.close(event.code, event.reason)
        }
      })

      targetWebSocket.addEventListener('error', (error) => {
        console.error('Gemini WebSocket error:', {
          error: error.message || 'Unknown error',
          timestamp: new Date().toISOString(),
          readyState: targetWebSocket.readyState,
        })
      })
    })

    ctx.waitUntil(connectPromise)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  },
}
```

### 设置自定义域名（可选）

由于在部分国家无法正常访问 `workers.dev` 域名，可以通过设置自定义域名来解决这个问题。

1. 选择 Workers 和 Pages > [您的 Worker 脚本]。
2. 选择 设置 > 触发器。
3. 选择 添加自定义域。
