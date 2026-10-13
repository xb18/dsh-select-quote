/**
 * 把一条笔记锚点定位到会话内的可见位置。
 *
 * 定位策略（严格「先精确、后模糊」）：
 * 1) messageId → `[data-chat-flow-key="<id>"]`（平台自己的消息标识，最可靠）。
 * 2) 找到消息后按 clean-text 偏移标出区间；偏移若被后续重渲染/编辑打乱，
 *    annotate-text 内部会自动在同一消息内退化为按文本搜索。
 * 3) messageId 缺失或消息未挂载时，退化为全文档按文本搜索。
 *
 * 时序很重要：切会话后目标消息往往尚未挂载。本模块因此把「等待挂载」独立成
 * waitAndLocateNote，并且绝不无限等待 —— 平台没有「按 messageId 加载历史消息」
 * 的公开 API，等不到就必须能明确告诉用户，而不是卡住。
 */

import {
  dropAnnotationJobs,
  findAnnotationMarkById,
  flashAnnotationMark,
  upsertAnnotationJobs,
} from './annotate-text.ts'
import { findElementByText } from './scrollToAnnotation.ts'
import type { Note } from '../state/notes-store.ts'

/** 等待目标消息挂载的默认时限（切会话后历史需要时间渲染）。 */
export const DEFAULT_LOCATE_TIMEOUT_MS = 6000

/** 高亮保留时长：够看清，之后撤掉临时标记，不长期污染正文 DOM。 */
const HIGHLIGHT_MS = 2600

/** 笔记的临时标记前缀：与批注（用 annotation id 作 markId）区分开。 */
const MARK_PREFIX = 'dsq_note_'

/**
 * 文本兜底搜索必须排除「笔记自己的列表界面」：列表里就有同一段原文，否则
 * 「找不到正文」会变成「滚到自己的列表项」，看起来像定位成功，实际什么都没发生。
 *
 * 两处都要排除，且第一处最容易漏：点击设置页的笔记时，`jumpToNote` 会在关闭设置
 * 面板**之前**先发起定位（顺序不能反，见 locate-queue 的说明），所以这一次同步尝试
 * 发生时设置页仍在 DOM 里；只排除会话视图就会命中设置页的列表。
 */
const TEXT_SKIP = '[data-dsq-notes-view], [data-dsq-settings-notes], [data-dsq-locate-notice]'

export type LocateOutcome =
  | { readonly status: 'located'; readonly messageFound: boolean }
  | { readonly status: 'timeout' }
  | { readonly status: 'not-found' }

function attrValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

function messageElement(messageId: string): HTMLElement | null {
  if (!messageId) return null
  const node = document.querySelector(`[data-chat-flow-key="${attrValue(messageId)}"]`)
  return node instanceof HTMLElement ? node : null
}


function scrollTo(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/** 在消息内标记 `note` 的文本区间；标记是临时的，HIGHLIGHT_MS 后自动撤掉。 */
function markRange(note: Note): HTMLElement | null {
  const markId = `${MARK_PREFIX}${note.id}`
  upsertAnnotationJobs([
    {
      markId,
      messageId: note.messageId,
      // 笔记不在批注编号体系内：showIndex=false 会抑制序号徽标，避免用户
      // 误以为这是「第 1 条批注」。
      index: 1,
      showIndex: false,
      text: note.text,
      startOffset: note.startOffset,
      endOffset: note.endOffset,
    },
  ])
  const mark = findAnnotationMarkById(markId)
  window.setTimeout(() => dropAnnotationJobs([markId]), HIGHLIGHT_MS)
  return mark
}

/**
 * 尝试定位一次（不等待挂载）。返回 timeout 表示「锚点已知但消息没挂载」，
 * 调用方可用 waitAndLocateNote 继续等。
 */
export function locateNote(note: Note): LocateOutcome {
  const message = messageElement(note.messageId)
  if (message) {
    const mark = markRange(note)
    if (mark) {
      flashAnnotationMark(mark)
      return { status: 'located', messageFound: true }
    }
    // 消息在，但文本区间标不出来（原文已被编辑等）→ 至少把该消息滚到视野中央。
    scrollTo(message)
    return { status: 'located', messageFound: true }
  }

  const byText = findElementByText(note.text, TEXT_SKIP)
  if (byText) {
    scrollTo(byText)
    return { status: 'located', messageFound: false }
  }
  return note.messageId ? { status: 'timeout' } : { status: 'not-found' }
}

/**
 * 带等待的定位：用 MutationObserver + 有限时限等待 `[data-chat-flow-key]` 出现。
 * 等不到就明确返回 timeout，由调用方给出可见提示。
 */
export function waitAndLocateNote(
  note: Note,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<LocateOutcome> {
  const immediate = locateNote(note)
  if (immediate.status === 'located') return Promise.resolve(immediate)

  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCATE_TIMEOUT_MS
  return new Promise<LocateOutcome>((resolve) => {
    let settled = false
    let observer: MutationObserver | null = null
    let timer = 0

    const finish = (outcome: LocateOutcome): void => {
      if (settled) return
      settled = true
      observer?.disconnect()
      window.clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }

    const attempt = (): void => {
      if (settled) return
      const outcome = locateNote(note)
      if (outcome.status === 'located') finish(outcome)
    }

    function onAbort(): void {
      finish({ status: 'not-found' })
    }

    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(attempt)
      observer.observe(document.body, { childList: true, subtree: true })
    }
    timer = window.setTimeout(() => finish({ status: 'timeout' }), timeoutMs)
    options.signal?.addEventListener('abort', onAbort)

    // observer 只对「之后的变更」生效，目标可能在首次尝试与 observe 之间就已
    // 挂载（竞态窗口），因此这里再补一次同步尝试。
    attempt()
  })
}
