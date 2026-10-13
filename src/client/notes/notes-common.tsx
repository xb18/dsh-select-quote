/**
 * 「笔记」两个界面（会话内标签页、设置页全局列表）共用的展示逻辑。
 *
 * 两处的差异只在数据范围与跳转方式；排序、时间格式、错误边界这些细枝末节必须
 * 完全一致，否则同一个笔记在两个界面里顺序不同、或者一处白屏一处降级，用户会
 * 认为是数据坏了。因此抽在这里，只有一份实现。
 */

import { Component, type ReactNode } from 'react'
import { jsx } from 'react/jsx-runtime'
import type { Note } from '../state/notes-store.ts'
import { styles } from '../styles.ts'

export const EMPTY_NOTES: readonly Note[] = []

/** 本地时区的 `YYYY-MM-DD HH:mm`；非法时间返回空串而不是 `Invalid Date`。 */
export function formatTime(value: string): string {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** 时间倒序；时间相同（或都无法解析）时按 id 倒序，保证顺序稳定可复现。 */
export function sortNotes(notes: readonly Note[]): readonly Note[] {
  return [...notes].sort((a, b) => {
    const left = Date.parse(a.createdAt)
    const right = Date.parse(b.createdAt)
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return right - left
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

/**
 * 按文本子串过滤笔记。
 *
 * 刻意放在客户端做：官方的 `sessions.search` 只索引 Host 的消息正文索引，不覆盖
 * 插件自己的笔记文件，接了也搜不到笔记。`toLowerCase()` 对中英文都成立 ——
 * 中文没有大小写，英文部分照常忽略大小写。
 */
export function filterNotes(notes: readonly Note[], query: string): readonly Note[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return notes
  return notes.filter((note) => note.text.toLowerCase().includes(needle))
}

export interface NotesBoundaryProps {
  /** 降级提示文案（各界面自己决定说什么）。 */
  readonly failureText: string
  /**
   * 降级时包住提示块的外层属性。
   *
   * 必须保留各界面自己的根节点标记：宿主（以及本仓库的 harness）都靠
   * `[data-dsq-notes-view]` / `[data-dsq-settings-notes]` 判断「界面还在不在」。
   * 只渲染一个裸提示块会让界面的根节点整块消失，看起来像界面崩没了。
   */
  readonly rootProps?: Record<string, string>
  readonly children: ReactNode
}

/**
 * 笔记界面的错误边界。
 *
 * 官方渲染器自带 `SlotErrorBoundary`，但它只渲染一个空的 `data-slot-error` 占位，
 * 用户看到的是**整块空白**；`@weibaohui/skills-management` 就因此在设置页白屏过。
 * 所以每个界面都必须自带边界，把异常变成一个可读的提示块。
 */
export class NotesBoundary extends Component<NotesBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('[dsh-select-quote] notes panel crashed:', error)
  }

  render(): ReactNode {
    if (this.state.failed) {
      return jsx('div', {
        ...(this.props.rootProps ?? {}),
        children: jsx('div', {
          className: `${styles.notesNotice} ${styles.notesError}`,
          'data-dsq-notes-degraded': 'true',
          children: this.props.failureText,
        }),
      })
    }
    return this.props.children
  }
}
