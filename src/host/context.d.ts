/**
 * 本插件在宿主侧注入的 `connection` 服务的环境声明。
 *
 * `ctx.connection` 由运行中的 dsh 部署（`@deepseek-ai/dsh-client-connection`）
 * 提供，而它并不是本仓库的依赖 —— 客户端各 half 面对的 `ctx.slots` 等也是同样
 * 情况。这里重新声明一次 `Context` 增强，好让 `npm run typecheck` 不依赖完整的
 * 产品安装即可通过。
 */

import type { Context } from '@deepseek-ai/cordis'

/** Connection 注册表接受的一条精确 Fetch 路由。 */
export interface ConnectionFetchRoute {
  /** 绝对路径，必须位于 `/api/` 之下（Connection 会断言这一点）。 */
  path: string
  /** 非空且不重复的 HTTP 动词列表。 */
  methods: string[]
  /** `'buffered'` 才允许处理函数调用 `request.text()` / `.json()`。 */
  requestBody: 'buffered'
  /** 已被围栏化的处理函数：Connection 已经做完了 Host/Origin 校验。 */
  fetch: (request: Request) => Response | Promise<Response>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: {
      fetch: {
        register(route: ConnectionFetchRoute): () => void
      }
    }
  }
}
