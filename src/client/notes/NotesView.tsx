/**
 * 会话内「笔记」标签页（`conversation.view` 槽位，id: 'notes'）。
 *
 * 三个必须理解的设计点：
 *
 * 1) 只渲染激活项。`conversation.view` 是 list 槽位，官方以 `{ only: viewId }` 渲染，
 *    所以本组件出现时聊天正文一定已卸载。点击笔记的「等待 + 高亮」因此交给模块作用
 *    域的定位管线（notes/locate-queue.ts），本组件只负责发起请求并把视图切回正文。
 *
 * 2) 自带错误边界。槽位渲染器虽然给每个条目套了 SlotErrorBoundary，但先例教训表明
 *    条目自身抛异常会把宿主块变成空白；笔记页是用户主动打开的面板，不能因此白屏。
 *
 * 3) 数据以服务端为准。列表来自宿主 /api/select-quote-notes（经 notes-store），
 *    新增/删除后都以后端返回为准更新缓存，本地不伪造 id。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import {
  jumpToNote,
  peekLocateRequest,
  registerChatActivator,
  showNotesToast,
  subscribeLocateRequests,
} from '../notes/locate-queue.ts'
import {
  EMPTY_NOTES,
  formatTime,
  NotesBoundary,
  sortNotes,
} from '../notes/notes-common.tsx'
import {
  deleteNote,
  getNotes,
  loadNotes,
  subscribeNotes,
  type Note,
} from '../state/notes-store.ts'
import type { SessionIndex } from '../notes/session-lookup.ts'
import { ensureToolbarStyles, styles } from '../styles.ts'
import { LucideIcon } from '../ui/icons.tsx'

/** 视图收到的 owner prop：由 `conversation.session` 注入给 view 槽位。 */
export interface NotesViewProps {
  /** 会话作用域标准 prop。 */
  readonly sessionId?: string
  /** 切回某个视图（官方 owner prop；`chat` 不在标签环里就静默返回）。 */
  readonly openView?: (view: string, focus?: unknown) => void
  /** 根作用域标准 hook：会话列表镜像，用于跳转前校验目标会话存在。 */
  readonly useSessions?: (selector: (state: unknown) => unknown) => unknown
  /** 会话作用域标准 hook；本视图不用，但保留声明以免被误当作未声明的注入。 */
  readonly useProjection?: unknown
}

const EMPTY = EMPTY_NOTES

/** 会话列表不可用时的占位 hook，保证 hook 调用次数恒定。 */
const NO_SESSIONS = (() => undefined) as unknown as NonNullable<NotesViewProps['useSessions']>

type Phase = 'loading' | 'ready' | 'error'

function NotesPanel({ sessionId, openView, useSessions = NO_SESSIONS }: NotesViewProps): ReactNode {
  const sessionList = useSessions((state) => state) as { byId?: SessionIndex } | undefined

  const [notes, setNotes] = useState<readonly Note[]>(EMPTY)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [locatingId, setLocatingId] = useState<string | null>(null)
  const zoneRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(() => {
    setNotes(getNotes(sessionId))
  }, [sessionId])

  const reload = useCallback(async () => {
    if (!sessionId) {
      setNotes(EMPTY)
      setPhase('ready')
      return
    }
    setPhase('loading')
    setError('')
    try {
      await loadNotes(sessionId)
      setPhase('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取笔记失败')
      setPhase('error')
    }
  }, [sessionId])

  useEffect(() => {
    ensureToolbarStyles()
    refresh()
    void reload()
    return subscribeNotes(refresh)
  }, [refresh, reload])

  // 视图存活期间把自己登记为「本会话可切回正文」的执行者，供跨会话跳转补偿触发。
  useEffect(() => {
    if (!sessionId || typeof openView !== 'function') return
    return registerChatActivator(sessionId, () => openView('chat'))
  }, [sessionId, openView])

  // 「定位中」只反映视觉状态；真正的等待在模块作用域，不随本组件卸载而中断。
  useEffect(() => {
    const sync = (): void => setLocatingId(peekLocateRequest()?.id ?? null)
    sync()
    return subscribeLocateRequests(sync)
  }, [])

  const onLocate = useCallback(
    (note: Note) => {
      const crossSession = note.sessionId !== sessionId
      // 同会话跳转必须先切回正文，而这一步只能由本视图的 owner prop 完成；
      // 跨会话时目标会话会自己注册补偿回调，不依赖本实例。
      if (!crossSession && typeof openView !== 'function') {
        showNotesToast('无法定位：当前会话没有可用的视图切换接口。')
        return
      }
      jumpToNote(note, { currentSessionId: sessionId, sessionIndex: sessionList?.byId })
    },
    [openView, sessionId, sessionList],
  )

  const onDelete = useCallback(
    async (note: Note) => {
      if (!sessionId || deletingId !== null) return
      setDeletingId(note.id)
      try {
        await deleteNote(note.sessionId || sessionId, note.id)
        refresh()
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '删除失败'
        showNotesToast(`删除笔记失败：${message}`)
      } finally {
        setDeletingId(null)
      }
    },
    [deletingId, refresh, sessionId],
  )

  const visible = useMemo(() => sortNotes(notes), [notes])

  const head = jsx('div', {
    className: styles.notesHead,
    children: [
      jsx('span', {
        key: 'count',
        className: styles.notesCount,
        children: visible.length > 0 ? `共 ${visible.length} 条笔记` : '暂无笔记',
      }),
    ],
  })

  let body: ReactNode
  if (!sessionId) {
    body = jsx('div', {
      className: styles.notesEmpty,
      children: [
        jsx('div', {
          key: 'title',
          className: styles.notesEmptyTitle,
          children: '当前没有会话',
        }),
        jsx('div', {
          key: 'hint',
          className: styles.notesEmptyHint,
          children: '打开一个会话后，在这里可以看到该会话保存的全部笔记。',
        }),
      ],
    })
  } else if (phase === 'loading' && visible.length === 0) {
    body = jsx('div', {
      className: styles.notesEmpty,
      children: jsx('div', {
        className: styles.notesEmptyHint,
        children: '正在读取笔记…',
      }),
    })
  } else if (phase === 'error') {
    body = jsx('div', {
      className: `${styles.notesNotice} ${styles.notesError}`,
      children: [
        jsx('div', { key: 'msg', children: `读取笔记失败：${error}` }),
        jsx('button', {
          key: 'retry',
          type: 'button',
          className: styles.noteDelete,
          onClick: () => void reload(),
          children: '重试',
        }),
      ],
    })
  } else if (visible.length === 0) {
    body = jsx('div', {
      className: styles.notesEmpty,
      children: [
        jsx('div', {
          key: 'title',
          className: styles.notesEmptyTitle,
          children: '这个会话还没有笔记',
        }),
        jsx('div', {
          key: 'hint',
          className: styles.notesEmptyHint,
          children: '选中消息里的任意文字，点浮出的「笔记」按钮即可保存到这里。',
        }),
      ],
    })
  } else {
    body = jsx('ul', {
      className: styles.notesList,
      children: visible.map((note) =>
        jsxs('li', {
          className: styles.noteRow,
          'data-dsq-note-id': note.id,
          children: [
            jsx('button', {
              key: 'main',
              type: 'button',
              className: styles.noteMain,
              title: '点击定位到这段文字在会话中的位置',
              onClick: () => onLocate(note),
              children: [
                jsx('span', {
                  key: 'text',
                  className: styles.noteText,
                  children: note.text,
                }),
                jsx('span', {
                  key: 'meta',
                  className: styles.noteMeta,
                  children: [
                    jsx('span', {
                      key: 'time',
                      children: formatTime(note.createdAt),
                    }),
                    locatingId === note.id
                      ? jsx('span', { key: 'state', children: '定位中…' })
                      : null,
                  ].filter(Boolean),
                }),
              ],
            }),
            jsx('button', {
              key: 'delete',
              type: 'button',
              className: styles.noteDelete,
              disabled: deletingId === note.id,
              title: '删除这条笔记',
              'aria-label': '删除这条笔记',
              onClick: () => void onDelete(note),
              children: [
                jsx(LucideIcon, { key: 'icon', name: 'trash-2', size: 14 }),
                jsx('span', { key: 'label', children: deletingId === note.id ? '删除中' : '删除' }),
              ],
            }),
          ],
        }, note.id),
      ),
    })
  }

  return jsx('div', {
    ref: zoneRef,
    className: styles.notesView,
    'data-dsq-notes-view': 'true',
    // 官方 opt-in：本视图自带滚动容器，请宿主隐藏正文列宽把手并让视图区独占高度。
    'data-conversation-composer-overlay': '',
    children: [head, body],
  })
}

/**
 * 会话内「笔记」标签页。
 *
 * 错误边界实现在共用的 `NotesBoundary` 里：两个笔记界面必须同样降级，
 * 只是提示文案不同。
 */
export function NotesView(props: NotesViewProps): ReactNode {
  return jsx(NotesBoundary, {
    failureText: '笔记面板渲染出错，已降级显示。切换标签页后重试。',
    rootProps: {
      className: styles.notesView,
      'data-dsq-notes-view': 'true',
      // 降级态同样是自带滚动容器的 full-bleed 视图，仍要声明这个 opt-in。
      'data-conversation-composer-overlay': '',
    },
    children: jsx(NotesPanel, props),
  })
}
