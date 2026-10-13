import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { createPortal } from 'react-dom'
import {
  clearNativeSelection,
  copyText,
  readSelectionSnapshot,
  type SelectionSnapshot,
} from './dom/selection.ts'
import { focusComposer } from './dom/composer-host.ts'
import { placePopover } from './dom/popoverPlacement.ts'
import { setRuntimeSession, runtime } from './runtime.ts'
import { getAnnotations, saveAnnotation } from './state/annotation-store.ts'
import { addNote, NotesRequestError } from './state/notes-store.ts'
import { ensureToolbarStyles, styles } from './styles.ts'
import { LucideIcon } from './ui/icons.tsx'

export interface SelectionToolbarProps {
  sessionId?: string
}

type Phase = 'idle' | 'comment'

export function SelectionToolbar({ sessionId }: SelectionToolbarProps): ReactNode {
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const commentWrapRef = useRef<HTMLDivElement | null>(null)
  const commentRef = useRef<HTMLTextAreaElement | null>(null)
  const [active, setActive] = useState<SelectionSnapshot | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const activeRef = useRef<SelectionSnapshot | null>(null)
  activeRef.current = active

  useEffect(() => {
    ensureToolbarStyles()
    if (sessionId) setRuntimeSession(sessionId)
  }, [sessionId])

  /**
   * 提示条的托管计时器。'已保存为笔记' 这类成功提示可能出现在 hide() 之后
   * （hide 会清空 status、并把 active 归零导致整个 portal 提前 return null），
   * 因此必须由 clearStatusTimer 与 hide 分开管理，否则提示会被自己抹掉。
   */
  const statusTimerRef = useRef<number | null>(null)
  /** 同步的「正在提交」闸门：见 commitNote 里对 disabled 局限性的说明。 */
  const noteInFlightRef = useRef(false)
  /**
   * 当前提示是否由 flashStatus 托管。refresh() 会随选区变化清掉临时提示，
   * 但不能顺手清掉错误提示（用户需要读它，且保留选区就是为了重试）。
   */
  const flashRef = useRef(false)

  const clearStatusTimer = useCallback(() => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current)
      statusTimerRef.current = null
    }
    flashRef.current = false
  }, [])

  /**
   * 提示条的锚点。成功保存后选区已被清除，active 会归零，但提示仍需留在
   * 原处 —— 记下最后一次工具条位置，供「只剩提示」的那一帧定位。
   */
  const anchorRef = useRef<{ left: number; top: number } | null>(null)

  /** 显示一条会自动消失的提示（hide() 之外的独立生命周期）。 */
  const flashStatus = useCallback(
    (message: string) => {
      clearStatusTimer()
      flashRef.current = true
      setStatus(message)
      statusTimerRef.current = window.setTimeout(() => {
        statusTimerRef.current = null
        flashRef.current = false
        setStatus(null)
      }, 2000)
    },
    [clearStatusTimer],
  )

  useEffect(() => clearStatusTimer, [clearStatusTimer])

  /** 显示一条不自动消失的提示（错误与前置校验失败）。 */
  const pinStatus = useCallback(
    (message: string) => {
      clearStatusTimer()
      setStatus(message)
    },
    [clearStatusTimer],
  )
  const hide = useCallback(() => {
    clearStatusTimer()
    setActive(null)
    setPhase('idle')
    setComment('')
    setStatus(null)
    setBusy(false)
  }, [clearStatusTimer])

  const refresh = useCallback(() => {
    const next = readSelectionSnapshot(toolbarRef.current)
    if (!next) {
      // Keep an open comment popover; only drop idle toolbar when selection dies.
      if (phaseRef.current === 'idle') setActive(null)
      return
    }
    // 选区变了：上一个选区的临时提示不应继续挂在新选区旁边。错误提示是
    // pinStatus 钉住的，刻意保留，方便用户对着同一段选区重试。
    if (flashRef.current) {
      clearStatusTimer()
      setStatus(null)
    }
    setActive((prev) => {
      // New text while commenting → drop back to idle toolbar for the new range.
      if (phaseRef.current === 'comment' && prev && prev.text !== next.text) {
        setPhase('idle')
        setComment('')
      }
      if (prev && prev.text === next.text && prev.left === next.left && prev.top === next.top) {
        return prev
      }
      return next
    })
  }, [])

  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    const schedule = () => window.setTimeout(refresh, 0)
    // The toolbar waits for the drag to end: selectionchange fires continuously
    // mid-drag, so it must not raise the toolbar — pointerup does.
    let dragging = false

    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      const inToolbar = toolbarRef.current?.contains(target) === true
      const inComment = commentWrapRef.current?.contains(target) === true
      if (inToolbar || inComment) return
      // Any outside press may start a new selection drag.
      dragging = true

      // Outside click: cancel comment mode entirely so the next selection
      // shows the idle toolbar again.
      if (phaseRef.current === 'comment') {
        hide()
        return
      }

      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        schedule()
        return
      }
      hide()
    }

    const onPointerUp = () => {
      dragging = false
      schedule()
    }

    const onSelectionChange = () => {
      if (dragging) return
      schedule()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('keyup', schedule, true)
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('resize', hide)
    document.addEventListener('scroll', hide, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('keyup', schedule, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('resize', hide)
      document.removeEventListener('scroll', hide, true)
    }
  }, [hide, refresh])

  // Flip the comment popover when the preferred side lacks room, and center it
  // on the selection (the CSS transform shifts it back by half its width).
  const placeCommentPop = useCallback(() => {
    const toolbar = toolbarRef.current
    const pop = commentWrapRef.current
    if (!toolbar || !pop) return
    const anchor = toolbar.getBoundingClientRect()
    pop.style.display = 'flex'
    pop.style.visibility = 'hidden'
    const panel = { width: pop.offsetWidth || 320, height: pop.offsetHeight || 180 }
    pop.style.visibility = ''
    const { top } = placePopover(anchor, panel, 'bottom')
    const half = panel.width / 2 + 8
    const center = Math.min(
      Math.max(anchor.left + anchor.width / 2, half),
      Math.max(half, window.innerWidth - half),
    )
    pop.style.top = `${top}px`
    pop.style.left = `${center}px`
  }, [])

  useEffect(() => {
    if (phase === 'comment') {
      placeCommentPop()
      commentRef.current?.focus()
    }
  }, [phase, placeCommentPop])

  const handleToolbarPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleCopy = useCallback(async () => {
    const snapshot = activeRef.current
    if (!snapshot) return
    try {
      await copyText(snapshot.text)
      clearNativeSelection()
      hide()
    } catch {
      setStatus('复制失败')
    }
  }, [hide])

  const openComment = useCallback(() => {
    if (!activeRef.current) return
    setPhase('comment')
    setComment('')
    setStatus(null)
  }, [])

  /** Quick-add without opening the comment step (double-tap / “暂不评论”). */
  const commitAnnotation = useCallback(
    (body: string | undefined) => {
      const snapshot = activeRef.current
      if (!snapshot) {
        hide()
        return
      }
      saveAnnotation(undefined, {
        text: snapshot.text,
        ...(body && body.trim() ? { comment: body.trim() } : {}),
        sources: snapshot.source
          ? [
              {
                text: snapshot.text,
                messageId: snapshot.source.messageId,
                messageKind: snapshot.source.messageKind,
                startOffset: snapshot.source.startOffset,
                endOffset: snapshot.source.endOffset,
              },
            ]
          : undefined,
      })
      const count = getAnnotations().length
      clearNativeSelection()
      hide()
      setStatus(null)
      window.setTimeout(focusComposer, 16)
      // Transient confirmation near the composer is owned by AnnotationPanel.
      void count
    },
    [hide],
  )

  /**
   * 一键保存笔记：只存选区原文，不进入评论阶段（不调用 openComment），
   * 因此没有输入弹层也没有聚焦。
   *
   * 与「引用」的两点关键差别：
   * 1) 归属必须是真实会话，不能用 annotationStoreKey() 的 'pending' 兜底键；
   * 2) 锚点（messageId + 偏移）是必需的，宿主缺字段会直接 400，因此解析不出
   *    来源时本地就中止并提示，不发注定失败的请求。
   */
  const commitNote = useCallback(async () => {
    // disabled={busy} 只能挡住「已重渲染」之后的重复点击；同一帧内的两次点击
    // 都会读到旧的 busy=false，因此必须用 ref 做同步去重，否则会存出两条重复笔记。
    if (noteInFlightRef.current) return

    const snapshot = activeRef.current
    if (!snapshot) {
      hide()
      return
    }

    // 先做纯本地的前置校验，避免「已经在飞」的状态被后面的失败覆盖。
    const source = snapshot.source
    if (!source) {
      setPhase('idle')
      setComment('')
      pinStatus('这段选区没有落在消息正文里，无法定位，未保存笔记')
      return
    }
    const session = runtime.sessionId
    if (!session) {
      setPhase('idle')
      setComment('')
      pinStatus('当前没有会话，暂时无法保存笔记')
      return
    }

    setPhase('idle')
    setComment('')
    noteInFlightRef.current = true
    setBusy(true)
    pinStatus('正在保存笔记…')
    try {
      await addNote({
        sessionId: session,
        messageId: source.messageId,
        startOffset: source.startOffset,
        endOffset: source.endOffset,
        text: snapshot.text,
      })
      clearNativeSelection()
      hide()
      flashStatus('已保存为笔记')
    } catch (error) {
      // 复制/引用在失败时会清空选区，这里故意保留：用户可能要重试同一段选区。
      setBusy(false)
      pinStatus(
        error instanceof NotesRequestError ? `保存笔记失败：${error.message}` : '保存笔记失败',
      )
    } finally {
      noteInFlightRef.current = false
    }
  }, [flashStatus, hide, pinStatus])

  // 只记住「非空选区」的位置：hide() 之后 active 归零，但成功提示要留在原处。
  if (active) anchorRef.current = { left: active.left, top: active.top }
  const anchor = active ?? anchorRef.current
  if (!anchor) return null

  const toolbarStyle: CSSProperties = { left: anchor.left, top: anchor.top }

  return createPortal(
    jsxs(Fragment, {
      children: [
        // 成功保存笔记后 active 已归零，此时只保留提示条，避免「空工具条」留在页面上。
        active
          ? jsx('div', {
              ref: toolbarRef,
              className: styles.toolbar,
              style: toolbarStyle,
              role: 'toolbar',
              'aria-label': '划词操作',
              'data-dsq-toolbar': 'true',
              onPointerDown: handleToolbarPointerDown,
              children:
                phase === 'comment'
                  ? jsx('div', {
                      style: { display: 'inline-flex', alignItems: 'center', gap: 2 },
                      children: jsx('span', {
                        style: { padding: '0 8px', fontSize: 13, opacity: 0.8 },
                        children: '添加批注…',
                      }),
                    })
                  : jsxs('div', {
                      style: { display: 'inline-flex', alignItems: 'center', gap: 2 },
                      children: [
                        jsx('button', {
                          type: 'button',
                          className: styles.button,
                          onClick: () => void handleCopy(),
                          children: [
                            jsx(LucideIcon, { name: 'copy', size: 14 }),
                            '复制',
                          ],
                        }),
                        // 一键引用：直接走「暂不评论」那条快速提交路径（comment 字段不写入），
                        // 因此不进入 comment 阶段，也就不会有评论输入弹层与聚焦。
                        jsx('button', {
                          type: 'button',
                          className: styles.button,
                          onClick: () => commitAnnotation(undefined),
                          children: [
                            jsx(LucideIcon, { name: 'quote', size: 14 }),
                            '引用',
                          ],
                        }),
                        // 一键笔记：与「引用」同为无输入的一步提交，但落到宿主侧文件、
                        // 且必须携带会话与偏移锚点（详见 commitNote）。
                        jsx('button', {
                          type: 'button',
                          className: styles.button,
                          disabled: busy,
                          onClick: () => void commitNote(),
                          children: [
                            jsx(LucideIcon, { name: 'notebook-pen', size: 14 }),
                            '笔记',
                          ],
                        }),
                        jsx('span', { className: styles.divider, 'aria-hidden': true }),
                        jsx('button', {
                          type: 'button',
                          className: styles.button,
                          onClick: openComment,
                          children: [
                            jsx(LucideIcon, { name: 'plus', size: 14 }),
                            '添加到任务',
                          ],
                        }),
                      ],
                    }),
            })
          : null,
        phase === 'comment'
          ? jsxs('div', {
              ref: commentWrapRef,
              className: styles.commentPop,
              style: undefined,
              role: 'dialog',
              'aria-label': '添加可选评论',
              onPointerDown: handleToolbarPointerDown,
              children: [
                jsx('textarea', {
                  ref: commentRef,
                  className: styles.commentInput,
                  placeholder: '添加可选评论…',
                  value: comment,
                  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value),
                  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      hide()
                      return
                    }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      commitAnnotation(comment)
                    }
                  },
                }),
                jsxs('div', {
                  className: styles.commentActions,
                  children: [
                    jsx('button', {
                      type: 'button',
                      className: styles.button,
                      onClick: () => commitAnnotation(undefined),
                      children: '暂不评论',
                    }),
                    jsx('button', {
                      type: 'button',
                      className: styles.button,
                      disabled: !comment.trim(),
                      onClick: () => commitAnnotation(comment),
                      children: '添加评论',
                    }),
                  ],
                }),
              ],
            })
          : null,
        status
          ? jsx('div', {
              className: styles.status,
              style: toolbarStyle,
              role: 'status',
              children: status,
            })
          : null,
      ],
    }),
    document.body,
  )
}
