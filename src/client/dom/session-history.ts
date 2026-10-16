/**
 * 把更早的会话历史拉进渲染窗口 —— 平台没有「按 messageId 加载消息」的公开接口。
 *
 * 为什么必须有这个模块：会话历史按**分页窗口**下发（默认只含最近约 1-2 个 turn）。
 * 一条几天前存下的笔记，其目标消息早就落在窗口之外、DOM 里从未出现。以前的做法是
 * 等不到就直接做全文档文本搜索并宣告成功，于是「滚动了但没停在那句话」。要真正修好，
 * 就得主动把窗口往回扩，直到目标消息进入 DOM。
 *
 * ## 主路径为什么是 loadOlder 循环
 *
 * 平台自己的跳转用的是 `loadThrough(seq)`：`dsh-api-session-controller` 的 jump loader
 * 就是「向后翻页直到窗口覆盖 seq」（`lib/types/client/sessions/session.js` L370 的守卫
 * `this.jumpTargetSeq !== null && pending.beforeSeq > this.jumpTargetSeq`，配合 L374
 * `events.prepend({ beforeSeq: before, ...JUMP_PAGE_OPTIONS })`）。它比固定翻一页精准，
 * 且每页最小消息数高达 `JUMP_PAGE_MESSAGES = 200`（同文件 L22；普通历史翻页只有
 * `PAGE_MESSAGES = 50`，L19）—— 同样页数能覆盖更长的历史。
 *
 * 但 `loadThrough` 需要**绝对 seq** 作为下界，而本插件手上只有 messageId。messageId 的
 * 真实构造是 `<kind 长度>:<kind><turn>:<step>`（dsh-client-ui-conversation 的
 * `conversationContextKey`；`assistant-step` 的 id 为 `<turn>:<step>`），真实样本
 * `14:assistant-step28:82` 解出的是 turn=28、step=82 —— **末段是 step，不是 seq**。
 * DOM 上也没有任何 seq 属性（行只有 `data-chat-turn` / `data-chat-node-key` /
 * `data-chat-flow-key`），sessions 服务面同样没有 turn→seq 查询。
 *
 * 因此主路径刻意选择 `loadOlder()` 循环：每一页都是确定有效的回退，不需要猜 seq；
 * 再用**turn 进度**做早退判据（见 locateNote 的 waitAndLocateNote）—— 解析出目标 turn 后，
 * 一旦窗口最小 turn ≤ 目标 turn，目标所在 turn 就已经进来了，继续翻毫无意义。
 * 猜 seq 的代价是双向的：猜小拿不到目标，猜大白拉成百上千条历史。
 *
 * ## seq 的可得路径（后续优化项，非当前实现）
 *
 * seq 并非不可得，只是当前没有走通：会话投影 `turnOutline` 的每个条目就带 seq。
 * `dsh-session-turn-outline/lib/types/projection.js` 的条目 schema 是
 * `{ turn, seq, prompt, response }`（L54-58），由 `turn/start` 折叠而来
 * （L93 推入 `{ turn: event.data.turn, seq: event.seq, ... }`）。其模块注释（L7-10）
 * 明确指出选 `turn/start` 作锚点的理由正是「**its seq is the load-through target for a
 * jump**」—— 即这个 seq 与 `loadThrough` 需要的正是同一个东西。
 *
 * 官方取值先例（`dsh-client-ui-goal/lib/client.js` L543）：
 * `sessions.binding(sessionId)?.session.projections.faceOf("goal"))?.getSnapshot()`。
 * 把 `"goal"` 换成 `"turnOutline"` 即可按 turn 查出 seq，进而改用 loadThrough 一次
 * 精准翻到目标 turn，省掉「多翻几页 + 每页等 600ms」的开销。
 *
 * **未经验证的前提**：插件能否从 `conversation.view` 拿到的 `standardProps` 里取到
 * `useProjection`。全量检索 SDK 后发现 `useProjection("turnOutline")` 只出现在
 * dsh-client-ui-chat 自己的 ChatView 内部（该产物 L5130 / L5144），没有任何插件侧
 * 调用先例。因此这条路径**尚未证实可用**，落地前必须先验证取用方式；本模块的
 * `loadThrough` 探测保留，正是为了那一天不必重新调研。
 *
 * 降级原则与 services.ts 一致：会话服务缺失、方法不存在、或调用抛错时**不抛异常**，
 * 只返回「本页没加载成功」，让上层按预算继续或诚实失败。
 */

import { clientContext } from '../services.ts'

/** 单次加载调用的等待上限：加载是网络往返，卡住时要能继续而不是整条链路僵死。 */
const LOAD_CALL_TIMEOUT_MS = 4000

export interface SessionHistory {
  /** 拉取更早的一页历史；返回是否「确实发起了且成功返回」。 */
  loadOlder(): Promise<boolean>
  /**
   * 向后翻页直到窗口覆盖 `seq`。
   *
   * **当前定位链路不会调用它**：手上只有 messageId，从中解不出 seq（详见模块顶部）。
   * seq 可由 `turnOutline` 投影按 turn 查出，但插件侧取用方式尚未验证，属后续优化项；
   * 此处先探测并暴露能力，让那一天不必重新调研。
   */
  loadThrough(seq: number): Promise<boolean>
}

interface SessionFaceLike {
  readonly loadOlder?: unknown
  readonly loadThrough?: unknown
}

/** 与超时赛跑：平台返回值不关心，只要求「不再挂住等待循环」。 */
async function callWithTimeout(fn: () => unknown): Promise<boolean> {
  try {
    await Promise.race([
      Promise.resolve(fn()),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, LOAD_CALL_TIMEOUT_MS)
      }),
    ])
    return true
  } catch {
    // 加载失败不致命：可能已到历史顶部，或该会话暂时不可用。
    return false
  }
}

/**
 * 取某会话的「加载更早历史」能力。缺失时返回 null 而不是报错 ——
 * 定位失败应当由定位链路给出可见提示，而不是因为辅助能力缺席就抛异常。
 *
 * 用 `ctx.get('sessions')` 而非属性读取：属性读取对未 inject 的服务会抛错（见 services.ts）。
 */
export function sessionHistory(sessionId: string): SessionHistory | null {
  const ctx = clientContext()
  if (!ctx || !sessionId) return null

  let sessions: unknown
  try {
    sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
  } catch {
    return null
  }
  if (!sessions || typeof sessions !== 'object') return null

  const bindingFn = (sessions as { binding?: unknown }).binding
  if (typeof bindingFn !== 'function') return null

  let binding: unknown
  try {
    binding = (bindingFn as (id: string) => unknown).call(sessions, sessionId)
  } catch {
    return null
  }
  if (!binding || typeof binding !== 'object') return null

  const session = (binding as { session?: unknown }).session as SessionFaceLike | undefined
  const loadOlder = session?.loadOlder
  if (typeof loadOlder !== 'function') return null

  const loadThrough = session?.loadThrough

  return {
    loadOlder: () => callWithTimeout(() => (loadOlder as () => unknown).call(session)),
    loadThrough: (seq: number) => {
      if (typeof loadThrough !== 'function') return Promise.resolve(false)
      return callWithTimeout(() => (loadThrough as (s: number) => unknown).call(session, seq))
    },
  }
}
