/**
 * 设置面板的全局「笔记」页（`settings.section` 槽位条目）。
 *
 * 与会话内的「笔记」标签页的区别只有两点：数据范围是**全部会话**，以及每行要额外
 * 说明这条笔记属于哪个会话（否则跨会话列表无法解读）。列表渲染、排序、时间格式、
 * 错误边界都复用 `notes-common.tsx`，避免两处行为漂移。
 *
 * 搜索刻意在客户端做：官方的 `sessions.search` 只索引 Host 的消息正文索引，不覆盖
 * 插件自己的笔记文件，所以接了也搜不到笔记。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { jumpToNote, peekLocateRequest, showNotesToast, subscribeLocateRequests } from '../notes/locate-queue.ts'
import {
  EMPTY_NOTES,
  filterNotes,
  formatTime,
  NotesBoundary,
  sortNotes,
} from '../notes/notes-common.tsx'
import { sessionLabel, type SessionIndex } from '../notes/session-lookup.ts'
import {
  deleteNote,
  getAllNotes,
  loadAllNotes,
  subscribeNotes,
  type Note,
} from '../state/notes-store.ts'
import { styles } from '../styles.ts'
import { LucideIcon } from '../ui/icons.tsx'

/** 设置槽位传给条目的 props。 */
export interface NotesSettingsProps {
  /** 根作用域标准 hook：会话列表镜像，用于显示笔记所属会话。 */
  readonly useSessions?: (selector: (state: unknown) => unknown) => unknown
  /** 设置面板的关闭回调（`settings.section` 的 owner prop）。 */
  readonly close?: () => void
}

/** 会话列表不可用时的占位 hook，保证 hook 调用次数恒定。 */
const NO_SESSIONS = (() => undefined) as unknown as NonNullable<NotesSettingsProps['useSessions']>

type Phase = 'loading' | 'ready' | 'error'

/** 只取渲染需要的那部分 DOM 事件形状，避免为一行 onChange 引入 React 的事件类型。 */
interface InputEventLike {
  readonly currentTarget: { readonly value: string }
}

function NotesSettingsPanel({ useSessions = NO_SESSIONS, close }: NotesSettingsProps): ReactNode {
  const sessionList = useSessions((state) => state) as
    | { byId?: SessionIndex }
    | undefined
  const sessionIndex = sessionList?.byId

  const [notes, setNotes] = useState<readonly Note[]>(EMPTY_NOTES)
  const [query, setQuery] = useState('')
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [locatingId, setLocatingId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setNotes(getAllNotes())
  }, [])

  const reload = useCallback(async () => {
    setPhase('loading')
    setError('')
    try {
      await loadAllNotes()
      setPhase('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取笔记失败')
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    refresh()
    void reload()
    return subscribeNotes(refresh)
  }, [refresh, reload])

  // 「定位中」只反映视觉状态；真正的等待在模块作用域，不随本组件卸载而中断。
  useEffect(() => {
    const sync = (): void => setLocatingId(peekLocateRequest()?.id ?? null)
    sync()
    return subscribeLocateRequests(sync)
  }, [])

  const onLocate = useCallback(
    (note: Note) => {
      // 设置面板不知道当前会话，所以一律走「切到这条笔记所属会话」的路径；
      // 目标就是当前会话时 openSession 只是重复选中，不会产生副作用。
      const outcome = jumpToNote(note, { sessionIndex })
      // 跳转成功后关掉设置面板，否则用户看不到刚定位到的那段文字。
      if (outcome.started && typeof close === 'function') close()
    },
    [close, sessionIndex],
  )

  const onDelete = useCallback(
    async (note: Note) => {
      if (deletingId !== null) return
      setDeletingId(note.id)
      try {
        await deleteNote(note.sessionId, note.id)
        refresh()
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '删除失败'
        showNotesToast(`删除笔记失败：${message}`)
      } finally {
        setDeletingId(null)
      }
    },
    [deletingId, refresh],
  )

  const sorted = useMemo(() => sortNotes(notes), [notes])
  const visible = useMemo(() => filterNotes(sorted, query), [query, sorted])
  const searching = query.trim().length > 0

  const head = jsxs('div', {
    className: styles.notesHead,
    children: [
      jsx('span', {
        key: 'count',
        className: styles.notesCount,
        children:
          notes.length === 0
            ? '暂无笔记'
            : searching
              ? `匹配 ${visible.length} / 共 ${notes.length} 条笔记`
              : `共 ${notes.length} 条笔记`,
      }),
      jsx('span', {
        key: 'scope',
        className: styles.settingsScope,
        children: '来自全部会话',
      }),
    ],
  })

  const search = jsxs('div', {
    className: styles.settingsSearch,
    children: [
      jsx('input', {
        key: 'input',
        className: styles.settingsInput,
        type: 'search',
        value: query,
        placeholder: '搜索笔记文本…',
        'aria-label': '搜索笔记文本',
        'data-dsq-notes-search': 'true',
        onChange: (event: InputEventLike) => setQuery(event.currentTarget.value),
      }),
      searching
        ? jsx('button', {
            key: 'clear',
            type: 'button',
            className: styles.settingsClear,
            title: '清空搜索',
            'aria-label': '清空搜索',
            onClick: () => setQuery(''),
            children: jsx(LucideIcon, { name: 'x', size: 14 }),
          })
        : null,
    ].filter(Boolean),
  })

  let body: ReactNode
  if (phase === 'loading' && notes.length === 0) {
    body = jsx('div', {
      className: styles.notesEmpty,
      children: jsx('div', {
        className: styles.notesEmptyHint,
        children: '正在读取笔记…',
      }),
    })
  } else if (phase === 'error') {
    body = jsxs('div', {
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
  } else if (notes.length === 0) {
    body = jsxs('div', {
      className: styles.notesEmpty,
      'data-dsq-notes-empty': 'true',
      children: [
        jsx('div', {
          key: 'title',
          className: styles.notesEmptyTitle,
          children: '还没有任何笔记',
        }),
        jsx('div', {
          key: 'hint',
          className: styles.notesEmptyHint,
          children: '在任意会话里选中文字，点浮出的「笔记」按钮即可保存；之后可以在这里跨会话查看和搜索。',
        }),
      ],
    })
  } else if (visible.length === 0) {
    body = jsxs('div', {
      className: styles.notesEmpty,
      'data-dsq-notes-no-match': 'true',
      children: [
        jsx('div', {
          key: 'title',
          className: styles.notesEmptyTitle,
          children: '没有匹配的笔记',
        }),
        jsx('div', {
          key: 'hint',
          className: styles.notesEmptyHint,
          children: `没有笔记文本包含「${query.trim()}」。`,
        }),
      ],
    })
  } else {
    body = jsx('ul', {
      className: styles.notesList,
      children: visible.map((note) => {
        // 会话可能已删除/归档：那时只能显示 id 并显式标注，绝不抛错。
        const label = sessionLabel(note.sessionId, sessionIndex)
        return jsxs(
          'li',
          {
            className: styles.noteRow,
            'data-dsq-note-id': note.id,
            'data-dsq-note-session': note.sessionId,
            children: [
              jsx('button', {
                key: 'main',
                type: 'button',
                className: styles.noteMain,
                title: '点击跳转到这条笔记所属会话并定位',
                onClick: () => onLocate(note),
                children: [
                  jsx('span', {
                    key: 'text',
                    className: styles.noteText,
                    children: note.text,
                  }),
                  jsxs('span', {
                    className: styles.noteMeta,
                    children: [
                      jsx('span', {
                        key: 'session',
                        className: styles.settingsSession,
                        children: label.name,
                      }),
                      label.missing
                        ? jsx('span', {
                            key: 'missing',
                            className: styles.settingsMissing,
                            children: '会话不存在',
                          })
                        : null,
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
          },
          note.id,
        )
      }),
    })
  }

  return jsx('div', {
    className: styles.settingsNotes,
    'data-dsq-settings-notes': 'true',
    children: [head, search, body],
  })
}

/**
 * `settings.section` 条目。
 *
 * 自带错误边界：官方 `SlotErrorBoundary` 只渲染一个空的 `data-slot-error` 占位，
 * 用户看到的是设置面板整块空白（`@weibaohui/skills-management` 就这样白屏过）。
 */
export function NotesSettings(props: NotesSettingsProps): ReactNode {
  return jsx(NotesBoundary, {
    failureText: '笔记设置页渲染出错，已降级显示。关闭并重新打开设置后重试。',
    rootProps: {
      className: styles.settingsNotes,
      'data-dsq-settings-notes': 'true',
    },
    children: jsx(NotesSettingsPanel, props),
  })
}
