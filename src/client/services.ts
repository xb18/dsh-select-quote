/**
 * 槽位组件对宿主 `ctx` 的只读访问口。
 *
 * 槽位条目的 `inject` 面只能声明 hooks/props，拿不到宿主 ctx；而「笔记」视图需要
 * 跨会话跳转（`uiWorkspace.openSession`）。`apply()` 启动时把 ctx 记在这里供组件按需读取。
 *
 * 关键陷阱（已用 cordis 4.0.2 实测确认）：**对未在 `inject` 里声明的服务做属性读取会
 * 直接抛错** `cannot get property "X" without inject`，而 `ctx.get("X")` 只返回 `undefined`。
 * 本插件刻意不把 `uiWorkspace` 加进 `inject` —— 那会让整个插件（含选区工具条）在缺少该
 * 服务的部署上直接不加载。所以这里一律走不抛错的 `ctx.get()`。
 */

import type { Context } from '@deepseek-ai/cordis'

let current: Context | undefined

export function setClientContext(ctx: Context): void {
  current = ctx
}

/** 取宿主 ctx；未初始化时返回 undefined（调用方据此降级而不是抛错）。 */
export function clientContext(): Context | undefined {
  return current
}

interface WorkspaceFace {
  openSession(target: string): void
}

/**
 * 会话导航口。缺失时返回 undefined，由调用方给出可见提示。
 *
 * 只用 `ctx.get`：属性读取对未声明注入的服务会抛错，而 UI 降级路径不该抛异常。
 */
export function uiWorkspace(): WorkspaceFace | undefined {
  const ctx = current
  if (!ctx) return undefined
  let resolved: unknown
  try {
    resolved = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
  } catch {
    return undefined
  }
  if (!resolved || typeof resolved !== 'object') return undefined
  const face = resolved as { openSession?: unknown }
  return typeof face.openSession === 'function' ? (resolved as WorkspaceFace) : undefined
}
