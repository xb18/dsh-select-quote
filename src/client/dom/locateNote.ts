/**
 * 把一条笔记锚点定位到会话内的可见位置。
 *
 * 定位策略（严格「先精确、后模糊」）：
 * 1) messageId → 正文流里的消息行（先 `data-chat-node-key`，再 `data-chat-flow-key`）。
 * 2) 找到消息后按 clean-text 偏移标出区间；偏移若被后续重渲染/编辑打乱，
 *    annotate-text 内部会自动在同一消息内退化为按文本搜索。
 * 3) 消息不在 DOM 里时**先主动加载更早历史**把它拉进来（见 session-history.ts），
 *    加载预算用尽后才允许按文本降级，且必须让调用方知道这是降级。
 *
 * 两个曾经真实出错的点，务必保留其修法：
 * - **不得**在「锚点已知但消息没挂载」时直接做全文档文本搜索并宣告 located：
 *   那会命中文档里第一处相同文本（侧栏、旧消息、插件自己的列表），滚过去却
 *   没停在那句话 —— 用户看到的就是「滚动了但没停在那句话」。
 * - 文本兜底的扫描范围必须收窄到正文流条目内部，而不是整个 document.body。
 *
 * 时序很重要：切会话后目标消息往往尚未挂载。本模块因此把「等待挂载」独立成
 * waitAndLocateNote，并且绝不无限等待 —— 有加载预算与总时限两道上界，
 * 到点就必须能明确告诉用户，而不是卡住或假装成功。
 */

import {
  dropAnnotationJobs,
  findAnnotationMarkById,
  flashAnnotationMark,
  upsertAnnotationJobs,
} from './annotate-text.ts'
import { findElementByText } from './scrollToAnnotation.ts'
import { sessionHistory, type SessionHistory } from './session-history.ts'
import type { Note } from '../state/notes-store.ts'

/**
 * 定位总时限。包含「自动加载更早历史」的时间：真实案例里目标在 2 页之外，
 * 每页都是一次网络往返，所以这个值不能只按「等渲染」来估。
 */
export const DEFAULT_LOCATE_TIMEOUT_MS = 12000

/** 主动加载更早历史的次数上限：真实案例需 2 页，留足余量但绝不无限翻。 */
export const DEFAULT_HISTORY_BUDGET = 12

/**
 * 平台没有暴露「加载更早历史」能力时，只剩「等渲染」这一条路可走。
 *
 * 这种情况下保留改动前的等待时长：等再久也不会等出新的历史（压根翻不了），
 * 而把用户晾在当前这个更长的总时限上纯属白等。
 */
const MOUNT_ONLY_TIMEOUT_MS = 6000

/** 每加载一页后给渲染留的时间；之后立即重新尝试定位。 */
const HISTORY_PAGE_SETTLE_MS = 600

/**
 * 第一次加载前的宽限时间。
 *
 * 点击笔记到「切回正文视图」是一次 React 状态更新，提交是异步的；而
 * waitAndLocateNote 是紧接着 activate() 同步发起的，此刻正文还没挂载。若直接开始
 * 翻历史，就会出现「目标明明已经在当前窗口里，却仍然白拉了一页（最多 500 条）」
 * 的浪费。先给渲染一拍机会，再来决定要不要翻。
 */
const HISTORY_FIRST_GRACE_MS = 250

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

/**
 * 与平台自己的定位保持一致的「可见行」过滤：排除 `[hidden]` 自身与其后代。
 * 平台在 ChatView 的 anchor 查询里用的就是这个组合，插件漏掉它就会命中
 * 折叠隐藏行 —— 报告成功，用户却什么都看不见。
 */
const VISIBLE_ROW = ':not([hidden]):not([hidden] *)'

export type LocateOutcome =
  /** 定位成功。`messageFound` 为 false 表示这是「按文本」的降级定位，不是精确锚点。 */
  | {
      readonly status: 'located'
      readonly messageFound: boolean
      /** 该结果是在「已加载更早历史仍没等到锚点」之后靠文本降级得到的。 */
      readonly degradedAfterHistory: boolean
    }
  /**
   * 锚点已知，但没有把目标拉进窗口。
   *
   * `historyAttempted` 区分两种失败，因为它们的解释完全不同：
   * true = 真的翻过历史却没等到（该让用户手动往上翻）；false = 平台压根没暴露
   * 加载口，一条都翻不了（说「已尝试加载更早历史」就是假话）。
   */
  | { readonly status: 'exhausted'; readonly historyAttempted: boolean }
  /** 无锚点，且正文流里也找不到这段文本。 */
  | { readonly status: 'not-found' }

function attrValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

/** 按属性查可见行；两个候选属性见 messageElement 的说明。 */
function queryRow(attribute: string, key: string, visibleOnly: boolean): HTMLElement | null {
  if (!key) return null
  const selector = `[${attribute}="${attrValue(key)}"]${visibleOnly ? VISIBLE_ROW : ''}`
  const node = document.querySelector(selector)
  return node instanceof HTMLElement ? node : null
}

/**
 * 找 messageId 对应的正文行。
 *
 * 为什么要两个属性：`data-chat-flow-key` 在 `groupPart === 'reasoning'` 时被平台写成
 * `JSON.stringify([key, 'reasoning'])`（数组形态的字符串），此时恒等比较永远匹配不上；
 * 而 `data-chat-node-key` 恒为裸 key，平台自己的定位正是拿它兜底。所以顺序是
 * node-key 优先、flow-key 次之。
 *
 * `visibleOnly` 先试可见行；只有找不到时才去看折叠行（随后由 revealHidden 揭示）。
 */
function messageElement(messageId: string, visibleOnly: boolean): HTMLElement | null {
  return (
    queryRow('data-chat-node-key', messageId, visibleOnly) ??
    queryRow('data-chat-flow-key', messageId, visibleOnly)
  )
}

/**
 * 取一行真正的 `data-chat-flow-key`（标记机制的唯一识别依据）。
 *
 * 不能直接用笔记里的 messageId：`groupPart === 'reasoning'` 时两者的值不同，
 * 用笔记的值去标记会永远命中不到任何行。
 */
function flowKeyOf(row: HTMLElement): string | undefined {
  const key = row.getAttribute('data-chat-flow-key')
  return key === null || key === '' ? undefined : key
}

/**
 * 揭示 `hidden="until-found"` 折叠容器。
 *
 * 平台的折叠不是 `display:none`，而是在容器上设 `hidden="until-found"` 并监听
 * `beforematch` 来展开（dsh-client-ui-chat 的 ChatView 内）。命中这类内容时必须先
 * 派发该事件，否则又是「报告成功但用户什么都看不见」。
 *
 * 只派发事件、**不直接改属性**：`hidden` 是平台自己的属性，由平台的监听器决定何时摘掉；
 * 插件越权删属性会与平台的折叠状态机打架。
 */
function revealHidden(element: HTMLElement): void {
  let node: HTMLElement | null = element
  while (node !== null) {
    if (node.hasAttribute('hidden')) {
      node.dispatchEvent(new Event('beforematch', { bubbles: true }))
    }
    node = node.parentElement
  }
}

/** 等平台把折叠容器展开的窗口：展开走 React 状态更新，跨帧完成。 */
const RESCROLL_DELAY_MS = 200

/**
 * 元素是否真的渲染出来了。
 *
 * 注意这条判据对折叠内容**失效**：`hidden="until-found"` 的布局语义是
 * `content-visibility: hidden` 而不是 `display: none`，实测折叠状态下
 * `getClientRects().length === 1`（元素本身仍有 rect）。因此折叠必须另行判断
 * （见 isCollapsed），本函数只用来排除「未挂载/被 display:none 拿掉」。
 */
function isRendered(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0
}

/** 平台 `useSearchableHidden` 折叠容器时写入的属性值（勿凭印象改）。 */
const COLLAPSED_ATTR = 'until-found'

/**
 * 元素是否仍被折叠容器藏着（祖先上有 `hidden="until-found"`）。
 *
 * **不能拿几何信息当判据**：`hidden="until-found"` 的布局语义是
 * `content-visibility: hidden` 而非 `display: none`，实测折叠状态下该行
 * `getClientRects().length === 1`、`offsetHeight === 48` —— 元素照样有 rect，从几何上
 * 完全看不出被折叠。但它此时 `scrollIntoView` 是空操作：实测 `scrollTop` 保持 0，
 * 揭示之后同一次调用才真正滚到 724。所以「折叠了没有」只能查属性。
 *
 * **只认 `until-found` 而不认任意 `hidden`**：`hidden` 还被平台用于视图切换等与折叠
 * 无关的场合，若一并当成「未揭示」，正常定位会集体退回失败。
 */
function isCollapsed(element: HTMLElement): boolean {
  let node: HTMLElement | null = element
  while (node !== null) {
    if (node.getAttribute('hidden') === COLLAPSED_ATTR) return true
    node = node.parentElement
  }
  return false
}

/**
 * 排一次延迟补滚：折叠的展开是异步的，紧随其后的那次同步滚动可能落在仍带
 * `hidden="until-found"` 的元素上而毫无效果，必须等它真的渲染出来再滚一次。
 *
 * 文本路径与 mark 路径**共用这一份实现**：本轮缺陷的成因正是同一个需求在两条路径上
 * 各写了一份 —— mark 路径只调了 flashAnnotationMark 的那一次同步滚动，于是折叠分组下
 * 「没有发生有效滚动，却上报定位成功」。
 */
function scheduleRescroll(element: HTMLElement): void {
  const rescroll = (): void => {
    if (isRendered(element) && !isCollapsed(element)) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }
  window.requestAnimationFrame(rescroll)
  window.setTimeout(rescroll, RESCROLL_DELAY_MS)
}

/** 揭示折叠容器、滚动一次、并排上延迟补滚。 */
function revealAndScroll(element: HTMLElement): void {
  revealHidden(element)
  element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  scheduleRescroll(element)
}

/** 文本兜底路径的滚动。无 mark 可闪，只求把元素带进视野。 */
function scrollTo(element: HTMLElement): void {
  revealAndScroll(element)
}

/** 目标行此刻是否已在 DOM 里（含折叠中的行）。 */
function anchorMounted(note: Note): boolean {
  if (!note.messageId) return false
  return (
    messageElement(note.messageId, true) !== null ||
    messageElement(note.messageId, false) !== null
  )
}

/**
 * 在消息内标记 `note` 的文本区间；标记是临时的，HIGHLIGHT_MS 后自动撤掉。
 *
 * `messageIdOverride` 传**实际命中的那一行**的 flow-key：批注标记机制只认
 * `data-chat-flow-key`，而锚点匹配允许走 `data-chat-node-key`。当两者不一致时
 * （`groupPart === 'reasoning'` 的数组形态 flow-key），直接沿用笔记里的
 * messageId 会导致「行找到了、也滚到了，却一个高亮都打不出来」。
 */
function markRange(note: Note, messageIdOverride?: string): HTMLElement | null {
  const markId = `${MARK_PREFIX}${note.id}`
  upsertAnnotationJobs([
    {
      markId,
      messageId: messageIdOverride ?? note.messageId,
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
 * 按锚点把消息定位到视野内。**不做**文本兜底 —— 文本兜底只在
 * locateNote（允许降级的入口）与预算耗尽后的收尾里发生。
 */
function locateByAnchor(note: Note): LocateOutcome | null {
  const visible = messageElement(note.messageId, true)
  const message = visible ?? messageElement(note.messageId, false)
  if (message === null) return null

  // 命中折叠行时**不能**就此上报成功。revealHidden 只是「请求展开」，平台要等 React
  // 状态更新提交后才真正摘掉 hidden；在那之前对该行 scrollIntoView 是空操作（实测
  // scrollTop 保持 0）。若这里照样标记并返回 located，用户得到的就是「滚了，但没停在
  // 那句话上」—— 正是本轮要修的缺陷。如实返回 null，交给 waitAndLocateNote 等展开结算。
  if (isCollapsed(message)) {
    revealHidden(message)
    return null
  }

  // 标记机制只认 flow-key，故把**实际命中的那行**的 flow-key 交给它。
  const mark = markRange(note, flowKeyOf(message))
  if (mark) {
    flashAnnotationMark(mark)
    // 与文本路径共用同一份延迟补滚：两条路径各写一份正是缺陷成因。
    scheduleRescroll(mark)
    return { status: 'located', messageFound: true, degradedAfterHistory: false }
  }
  // 消息在，但文本区间标不出来（原文已被编辑等）→ 至少把该消息滚到视野中央。
  scrollTo(message)
  return { status: 'located', messageFound: true, degradedAfterHistory: false }
}

/**
 * 在**正文流条目内部**按文本查找，而不是整个 document.body。
 *
 * 收窄范围是必须的：全文档搜索会命中侧栏、旧消息、插件自己的列表等非正文区域，
 * 于是滚到一个与笔记无关的地方还报告成功。
 */
function findTextInTranscript(text: string): HTMLElement | null {
  const entries = document.querySelectorAll('[data-chat-flow-key]')
  for (const entry of entries) {
    if (!(entry instanceof HTMLElement)) continue
    const hit = findElementByText(text, TEXT_SKIP, entry)
    if (hit) return hit
  }
  return null
}

/**
 * 尝试定位一次（不等待、不加载历史）。
 *
 * `allowTextFallback` 决定「锚点已知但未挂载」时能否按文本降级：
 * - false（默认）：只能返回 null，把「等/加载」交给 waitAndLocateNote。
 * - true：预算已耗尽后的收尾，允许明确标注的降级。
 *
 * `historyAttempted` 决定降级结果该怎么**描述**：只有真的翻过历史，才能说「已尝试
 * 加载更早历史」；平台没暴露加载口时一条都没翻，那样说就是假话。
 *
 * messageId 缺失时文本是唯一线索，不受该开关限制。
 */
export function locateNote(
  note: Note,
  allowTextFallback = false,
  historyAttempted = false,
): LocateOutcome | null {
  const byAnchor = note.messageId ? locateByAnchor(note) : null
  if (byAnchor) return byAnchor

  const mayUseText = !note.messageId || allowTextFallback
  if (!mayUseText) return null

  const byText = findTextInTranscript(note.text)
  if (byText) {
    scrollTo(byText)
    return {
      status: 'located',
      messageFound: false,
      degradedAfterHistory: historyAttempted,
    }
  }
  return null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/**
 * 从 messageId 解出目标 turn；解不出返回 null。
 *
 * messageId 的真实构造（已查证）：`<kind 长度>:<kind><turn>:<step>`。
 * 例如 `14:assistant-step28:82` → kind = "assistant-step"（长度 14）、turn = 28、step = 82。
 * （来源：dsh-client-ui-conversation 的 `conversationContextKey(kind, id)` 返回
 * `${kind.length}:${kind}${id}`，而 dsh-client-ui-chat 里 assistant-step 的 id 是
 * `${turn}:${step}`。已用队长的窗口数据交叉验证：解出的 turn=28 与「目标 turn 28」吻合。）
 *
 * 有了它就能判断「还要不要继续翻」：正文行带 `data-chat-turn`，
 * 一旦窗口里最小的 turn 已经 ≤ 目标 turn，目标所在 turn 就进来了。
 */
export function targetTurnOf(messageId: string): number | null {
  if (!messageId) return null

  const lengthMatch = messageId.match(/^(\d+):/)
  if (lengthMatch === null) return null

  const kindLength = Number(lengthMatch[1])
  const kindStart = lengthMatch[1].length + 1
  // kind 长度必须与服务端给的数字一致，否则说明格式已变，宁可不猜。
  const kind = messageId.slice(kindStart, kindStart + kindLength)
  if (kind.length !== kindLength) return null

  const turnMatch = messageId.slice(kindStart + kindLength).match(/^(\d+):(\d+)$/)
  return turnMatch === null ? null : Number(turnMatch[1])
}

/** 当前正文窗口里最小的 turn（行都带 `data-chat-turn`）；取不到返回 null。 */
function oldestLoadedTurn(): number | null {
  const rows = document.querySelectorAll('[data-chat-turn]')
  let oldest: number | null = null
  for (const row of rows) {
    const raw = row.getAttribute('data-chat-turn')
    if (raw === null) continue
    const turn = Number(raw)
    if (!Number.isFinite(turn)) continue
    if (oldest === null || turn < oldest) oldest = turn
  }
  return oldest
}

/**
 * 带等待与「主动加载更早历史」的定位。
 *
 * 两道上界，缺一不可：
 * - `historyBudget` 限制 loadOlder 的次数（真实案例 2 页足够；绝不无限翻）；
 * - `timeoutMs` 限制总耗时（含网络往返），到点即收尾。
 *
 * 收尾时若锚点仍不在 DOM 里，只有在**预算确已用尽/无法继续加载**的前提下才允许
 * 一次明确标注的文本降级；否则诚实返回 exhausted，由调用方给出可操作提示。
 */
export function waitAndLocateNote(
  note: Note,
  options: {
    timeoutMs?: number
    signal?: AbortSignal
    historyBudget?: number
    /** 注入点（测试用）；缺省取当前会话的加载口。 */
    history?: SessionHistory | null
  } = {},
): Promise<LocateOutcome> {
  const immediate = locateNote(note)
  if (immediate) return Promise.resolve(immediate)

  const budget = options.historyBudget ?? DEFAULT_HISTORY_BUDGET
  const history =
    options.history !== undefined
      ? options.history
      : note.messageId
        ? sessionHistory(note.sessionId)
        : null

  // 能不能翻历史决定等多久才合理：能翻时总时限要含网络往返；翻不了就只剩「等渲染」，
  // 沿用改动前的 6s —— 等再久也等不出新的历史。显式传入的 timeoutMs 优先。
  const timeoutMs =
    options.timeoutMs ?? (history === null ? MOUNT_ONLY_TIMEOUT_MS : DEFAULT_LOCATE_TIMEOUT_MS)

  return new Promise<LocateOutcome>((resolve) => {
    let settled = false
    let observer: MutationObserver | null = null
    let safetyTimer = 0
    let pagesLoaded = 0

    const finish = (outcome: LocateOutcome): void => {
      if (settled) return
      settled = true
      observer?.disconnect()
      window.clearTimeout(safetyTimer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }

    /** 仅按锚点尝试；文本降级不在这里发生。 */
    const attemptAnchor = (): void => {
      if (settled) return
      const outcome = locateNote(note)
      if (outcome) finish(outcome)
    }

    /** 预算用尽后的诚实收尾：允许一次明确标注的文本降级。 */
    const settle = (): void => {
      if (settled) return
      const attemptedHistory = pagesLoaded > 0
      const final = locateNote(note, true, attemptedHistory)
      if (final) {
        finish(final)
        return
      }
      if (!note.messageId) {
        finish({ status: 'not-found' })
        return
      }
      finish({ status: 'exhausted', historyAttempted: attemptedHistory })
    }

    function onAbort(): void {
      finish({ status: 'not-found' })
    }

    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(attemptAnchor)
      // 必须同时观察 `hidden` 属性：折叠行的揭示（平台 useSearchableHidden）只摘掉容器上的
      // hidden 属性，**没有** childList 变更，只看 childList 会永远等不到那次展开，
      // 于是明明能定位的笔记被拖到超时才收尾。attributeFilter 把噪声挡在外面。
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden'],
      })
    }
    safetyTimer = window.setTimeout(settle, timeoutMs)
    options.signal?.addEventListener('abort', onAbort)

    // observer 只对「之后的变更」生效，目标可能在首次尝试与 observe 之间就已
    // 挂载（竞态窗口），因此这里再补一次同步尝试。
    attemptAnchor()
    if (settled) return

    void (async () => {
      const targetTurn = targetTurnOf(note.messageId)
      const deadline = Date.now() + timeoutMs

      // 先给「切回正文视图」这一拍渲染机会，避免目标已在窗口里还白翻一页。
      // 这一步对「没有加载口」的情况同样必要：视图切换本身是异步提交的，
      // 立刻收尾会在正文挂载之前就宣告失败。
      await delay(HISTORY_FIRST_GRACE_MS)
      if (settled) return
      attemptAnchor()
      if (settled) return

      if (history === null) {
        // 平台没有暴露加载口（旧版本/该会话无此能力）：一条历史都翻不了，这里唯一还能
        // 做的是「等渲染」。不能立刻收尾 —— 视图切换是异步提交的，马上收尾会在正文挂载
        // 之前就宣告失败，连「切过去其实能看到」的情况都会误报。
        // 后续交给 MutationObserver 与 safetyTimer（MOUNT_ONLY_TIMEOUT_MS）收尾。
        return
      }

      if (anchorMounted(note)) {
        // 目标行已经在 DOM 里，只是仍被折叠容器藏着。**绝不能去翻历史**：更早的历史
        // 不会让这一行展开，只会白拉十来页网络往返，还把它挤出窗口。真正缺的是那次
        // 展开结算 —— 平台的 reveal 是 React 状态更新，MutationObserver（已观察 hidden）
        // 会在 hidden 被摘掉时立刻重试，safetyTimer 兜底。
        return
      }

      while (!settled && pagesLoaded < budget && Date.now() < deadline) {
        pagesLoaded += 1
        const ok = await history.loadOlder()
        if (settled) return
        if (!ok) break // 加载失败或已到历史顶部：再翻也没有意义
        await delay(HISTORY_PAGE_SETTLE_MS)
        if (settled) return
        attemptAnchor()
        if (settled) return

        // 早退：目标 turn 已经进窗口却仍找不到锚点，说明这条消息真的不在了
        // （被删除/压缩等）。继续翻到预算上限只会让用户白等十几次网络往返。
        if (targetTurn !== null) {
          const oldest = oldestLoadedTurn()
          if (oldest !== null && oldest <= targetTurn) break
        }
      }
      // 到点/到量就地收尾：迟到回调不会写状态，settle 有 settled 守卫。
      if (!settled) settle()
    })()
  })
}
