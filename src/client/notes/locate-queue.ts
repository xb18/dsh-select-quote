/**
 * 笔记 → 会话内位置的跳转/定位管线。
 *
 * 为什么不写在笔记视图组件里：`conversation.view` 是 list 槽位，渲染时带
 * `{ only: viewId }`，**同一时刻只渲染激活的那一个条目**。点击笔记必然要把视图切回
 * 正文，而这一步会让笔记视图自己卸载；在组件内等待目标消息挂载，必然等到超时（组件
 * 已不在），或 setState 落到已卸载组件上。
 *
 * 因此「等待 + 高亮」放在模块作用域：MutationObserver 挂在 document.body 上，不随
 * 组件卸载而失效。组件只负责「发起请求」和「切视图」。
 *
 * 另一个约束来自 verify-bundle：期望贡献数必须恰好是 7（新增 1 个 conversation.view）。
 * 若把等待托管给一个常驻槽位组件（例如 shell.overlay 再加一条），就会多出注册数。
 * 用模块作用域既更简单，也恰好守住了这个计数。
 */

import { waitAndLocateNote } from '../dom/locateNote.ts'
import type { Note } from '../state/notes-store.ts'
import { styles } from '../styles.ts'
import { uiWorkspace } from '../services.ts'
import { sessionExists, type SessionIndex } from './session-lookup.ts'

let pending: Note | null = null

/** 每次新请求递增：回调据此判断自己是否已被后来的请求取代。 */
let generation = 0
let controller: AbortController | null = null
const listeners = new Set<() => void>()

/**
 * sessionId → 「把该会话切回 chat 视图」的回调。
 *
 * 只有该会话自己的 `conversation.view` 条目能拿到 owner prop `openView`
 * （`conversation.session` 的 inject 面把它注入给 view 槽位），所以只能自报。
 */
const chatActivators = new Map<string, () => void>()

function notifyRequest(): void {
  for (const listener of [...listeners]) listener()
}

export function subscribeLocateRequests(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 当前待处理/进行中的跳转（笔记视图据此把该行显示为「定位中」）。 */
export function peekLocateRequest(): Note | null {
  return pending
}

/**
 * 登记本会话的「切回 chat 视图」回调。
 *
 * 除登记外还做一次补偿触发：若此刻正有一条指向本会话的待处理跳转（典型是用户从
 * 别的会话点过来），说明目标会话刚挂载、之前无人能切它的视图，这里立即补切。
 */
export function registerChatActivator(sessionId: string, activate: () => void): () => void {
  chatActivators.set(sessionId, activate)
  if (pending !== null && pending.sessionId === sessionId) {
    try {
      activate()
    } catch {
      // 切视图失败不致命：目标会话若本来就停在正文，等待仍会成功。
    }
  }
  return () => {
    if (chatActivators.get(sessionId) === activate) chatActivators.delete(sessionId)
  }
}

const TOAST_MS = 5000

/**
 * 视图级提示浮层（定位失败、跨会话不可用、删除失败等）。
 *
 * 不能依赖组件渲染：跳转会把界面切成正文视图（笔记视图随之卸载），所以直接挂一个
 * 固定浮层，无论当前在哪个视图/会话都看得见。只保留最新一条，避免连续点击刷屏。
 */
export function showNotesToast(message: string): void {
  if (typeof document === 'undefined') return
  for (const stale of document.querySelectorAll('[data-dsq-locate-notice]')) stale.remove()
  const toast = document.createElement('div')
  toast.className = styles.notesToast
  toast.setAttribute('data-dsq-locate-notice', 'true')
  toast.setAttribute('role', 'status')
  toast.textContent = message
  document.body.appendChild(toast)
  window.setTimeout(() => toast.remove(), TOAST_MS)
}

/** 放弃进行中的定位（视图卸载时调用，避免回调打到已卸载的组件）。 */
export function cancelLocate(): void {
  generation += 1
  controller?.abort()
  controller = null
  pending = null
  notifyRequest()
}

/**
 * 请求定位一条笔记，并同步启动等待。
 *
 * 调用顺序必须是「先 requestNoteLocate，后 openView / openSession」：等待的
 * MutationObserver 要先挂上，才能观察到切换过程中发生的挂载变更。
 */
export function requestNoteLocate(note: Note): void {
  generation += 1
  const current = generation
  controller?.abort()
  const nextController = new AbortController()
  controller = nextController
  pending = note
  notifyRequest()

  // 同一会话的视图若已挂载，先补一次「切回正文」；跨会话时目标视图尚不存在，
  // 由 registerChatActivator 的补偿触发兜住。
  const activate = chatActivators.get(note.sessionId)
  if (activate !== undefined) {
    try {
      activate()
    } catch {
      // 交给下面的等待逻辑兜底。
    }
  }

  void waitAndLocateNote(note, { signal: nextController.signal }).then((outcome) => {
    if (current !== generation) return
    pending = null
    controller = null
    notifyRequest()
    if (outcome.status === 'located') {
      if (!outcome.messageFound) {
        showNotesToast('已按文本内容定位到大致位置（原消息可能已被改动）。')
      }
      return
    }
    if (outcome.status === 'timeout') {
      showNotesToast('无法定位：这条笔记所属的消息还没有出现在当前会话里。')
      return
    }
    showNotesToast('无法定位：当前会话里找不到这段文本。')
  })
}

/** 跳转结果：是否已发起（未发起时 `showNotesToast` 已给出可见原因）。 */
export interface JumpOutcome {
  readonly started: boolean
  /** 需要切换会话（调用方据此决定是否也要切自己的视图）。 */
  readonly crossSession: boolean
}

/**
 * 「跳到这条笔记」的完整编排，供会话标签页与设置页共用。
 *
 * 两处的差别只在「要不要切回 chat 视图」：会话标签页必须切（它自己占着视图区），
 * 而这一步由 `registerChatActivator` 登记的补偿回调自动完成 —— `requestNoteLocate`
 * 会调用它，所以设置页无需、也无法自己碰那个视图。除这点外，校验顺序、提示文案、
 * 定位等待完全一致 —— 抽在这里避免两份实现漂移。
 *
 * 顺序关键：**先** requestNoteLocate（挂上 MutationObserver），**再** openSession，
 * 否则会漏掉切换过程中发生的挂载。
 */
export function jumpToNote(
  note: Note,
  options: {
    /** 当前所在会话；与笔记会话不同即跨会话跳转。 */
    readonly currentSessionId?: string
    /** 会话列表镜像；用于跳转前校验目标会话是否还存在。 */
    readonly sessionIndex?: SessionIndex
  } = {},
): JumpOutcome {
  const crossSession = note.sessionId !== options.currentSessionId
  const workspace = uiWorkspace()

  if (crossSession) {
    if (!workspace) {
      showNotesToast('无法定位：缺少跨会话跳转能力。')
      return { started: false, crossSession: true }
    }
    if (!sessionExists(note.sessionId, options.sessionIndex)) {
      showNotesToast('无法定位：这条笔记所属的会话不存在或已归档。')
      return { started: false, crossSession: true }
    }
  }

  requestNoteLocate(note)

  if (crossSession) {
    try {
      workspace?.openSession(note.sessionId)
    } catch {
      cancelLocate()
      showNotesToast('无法定位：切换到目标会话失败。')
      return { started: false, crossSession: true }
    }
  }
  return { started: true, crossSession }
}
