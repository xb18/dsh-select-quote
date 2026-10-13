/**
 * 会话标识解析：把笔记里的 `sessionId` 变成能给人看的名字，并区分「会话已不存在」。
 *
 * 输入是客户端会话列表镜像 `sessions.list.getSnapshot().byId`。该表由 Session
 * Controller 投影，条目上的 `displayTitle` 已是「durable title → 项目目录名 → 原始
 * id」三级回退的结果，比 `title` 更稳（`title` 可能不存在）。设置页是 root 作用域
 * 槽位，可以经官方 `useSessions` 标准 hook 订阅这张表，所以本模块只做纯函数变换、
 * 不碰 ctx。
 *
 * 会话可能已被删除或归档：那时表里查不到。必须显式标注「会话不存在」而不是抛异常
 * 或整页崩掉 —— 用户需要知道为什么这条笔记点不开。
 */

/** 会话列表条目里本插件读取的字段（其余字段与展示无关）。 */
export interface SessionSummary {
  readonly id?: string
  readonly displayTitle?: string
  readonly title?: string
  readonly blank?: boolean
}

/** `byId` 镜像。查不到的键在 JS 里天然是 undefined，故值可为 undefined。 */
export type SessionIndex = Readonly<Record<string, SessionSummary | undefined>>

export interface SessionLabel {
  /** 展示用的名字（标题或 id）。 */
  readonly name: string
  /** 列表里查不到这个会话（已删除/归档/不在当前工作区）。 */
  readonly missing: boolean
}

/**
 * 会话展示名。列表不可用（`index` 为 undefined）时退化为 id 且**不**标注缺失：
 * 拿不到列表不等于会话不存在，误报会吓到用户。
 */
export function sessionLabel(sessionId: string, index: SessionIndex | undefined): SessionLabel {
  if (!index) return { name: sessionId, missing: false }
  const summary = index[sessionId]
  if (summary === undefined) return { name: sessionId, missing: true }
  const title = summary.displayTitle?.trim() || summary.title?.trim()
  return { name: title && title.length > 0 ? title : sessionId, missing: false }
}

/** 会话是否确定存在。列表不可用时返回 true（不拦），避免误拦正常跳转。 */
export function sessionExists(sessionId: string, index: SessionIndex | undefined): boolean {
  if (!index) return true
  return index[sessionId] !== undefined
}
