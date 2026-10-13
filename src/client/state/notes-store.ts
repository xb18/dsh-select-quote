/**
 * 笔记客户端状态：宿主端文件是唯一真相，本地只做缓存与订阅。
 *
 * 与 annotation-store 的关键差别：批注是「发送前」的草稿（单 composer 共用
 * 'pending' 键，只活在内存里），笔记是「已落盘」的持久数据，必须真正归属到
 * 某个会话。因此这里一律以真实 sessionId 为分区键，取不到就拒绝写入而不是
 * 退化成全局共享键 —— 否则笔记会串会话，且用户会以为存进了当前会话。
 */

/** 宿主 /api/select-quote-notes 的笔记形状（字段名与宿主半一致）。 */
export interface Note {
  readonly id: string
  readonly sessionId: string
  readonly messageId: string
  readonly startOffset: number
  readonly endOffset: number
  readonly text: string
  readonly createdAt: string
}

/** 新增笔记的入参：不含 id 与 createdAt，二者由宿主生成。 */
export interface NoteInput {
  readonly sessionId: string
  readonly messageId: string
  readonly startOffset: number
  readonly endOffset: number
  readonly text: string
}

export const NOTES_ENDPOINT = '/api/select-quote-notes'

export class NotesRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'NotesRequestError'
    this.status = status
  }
}

/** 已拉取过的会话笔记；未拉取的会话回落到 EMPTY 而不是 undefined。 */
const bySession = new Map<string, readonly Note[]>()
const listeners = new Set<() => void>()
const EMPTY: readonly Note[] = []

/** 同一会话的并发请求串行化，避免后到的响应覆盖先到的更新。 */
const inflight = new Map<string, Promise<readonly Note[]>>()

/**
 * 跨会话全量笔记（设置页用），null 表示尚未拉取过。
 *
 * 单独一份缓存而非复用 bySession：全量列表与单会话列表是两个不同的查询，用会话键
 * 混存会让「未拉取过的会话」与「全局已拉取」互相污染。两份缓存共用同一批 listener，
 * 且新增/删除会同时回写两份，所以会话标签页与设置页不会各说各话。
 */
let allNotes: readonly Note[] | null = null
let allInflight: Promise<readonly Note[]> | null = null

function notify(): void {
  for (const listener of [...listeners]) listener()
}

export function subscribeNotes(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 缓存快照：服务端尚未拉到数据时返回空列表（不抛错）。 */
export function getNotes(sessionId: string | undefined): readonly Note[] {
  if (!sessionId) return EMPTY
  return bySession.get(sessionId) ?? EMPTY
}

function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) return false
  const note = value as Record<string, unknown>
  return (
    typeof note.id === 'string' &&
    typeof note.sessionId === 'string' &&
    typeof note.messageId === 'string' &&
    typeof note.startOffset === 'number' &&
    typeof note.endOffset === 'number' &&
    typeof note.text === 'string' &&
    typeof note.createdAt === 'string'
  )
}

/** 只保留结构完整的条目：宿主是唯一真相，但客户端不应因单条脏数据整体崩掉。 */
function parseNotes(payload: unknown): readonly Note[] {
  const list = (payload as { notes?: unknown } | null)?.notes
  if (!Array.isArray(list)) return EMPTY
  return list.filter(isNote)
}

async function failureMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body?.error === 'string' && body.error) return body.error
  } catch {
    // 非 JSON 响应体（例如网关直接返回 HTML），回落到状态码文案。
  }
  if (response.status === 401 || response.status === 403) return '没有权限访问笔记接口'
  return `笔记接口返回 ${response.status}`
}

/**
 * 拉取并缓存某会话的笔记。成功后回写缓存并通知订阅者。
 * 失败时抛 NotesRequestError，调用方负责把文案呈现给用户。
 */
export async function loadNotes(sessionId: string): Promise<readonly Note[]> {
  if (!sessionId) throw new NotesRequestError('缺少会话 ID', 0)

  const existing = inflight.get(sessionId)
  if (existing) return existing

  const task = (async () => {
    let response: Response
    try {
      response = await fetch(`${NOTES_ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`, {
        cache: 'no-store',
      })
    } catch {
      throw new NotesRequestError('无法连接笔记接口', 0)
    }
    if (!response.ok) throw new NotesRequestError(await failureMessage(response), response.status)

    const notes = parseNotes(await response.json().catch(() => null))
    bySession.set(sessionId, notes)
    notify()
    return notes
  })()

  inflight.set(sessionId, task)
  try {
    return await task
  } finally {
    inflight.delete(sessionId)
  }
}

/**
 * 新增一条笔记并把它并入本地缓存。
 *
 * 宿主返回 201 与落盘后的完整笔记（含 id/createdAt），因此这里不自行伪造 id：
 * 本地缓存必须与磁盘一致，否则后续删除会用到不存在的 id。
 */
export async function addNote(input: NoteInput): Promise<Note> {
  if (!input.sessionId) throw new NotesRequestError('缺少会话 ID', 0)

  let response: Response
  try {
    response = await fetch(NOTES_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, action: 'add' }),
    })
  } catch {
    throw new NotesRequestError('无法连接笔记接口', 0)
  }
  if (!response.ok) throw new NotesRequestError(await failureMessage(response), response.status)

  const payload = (await response.json().catch(() => null)) as { note?: unknown } | null
  const note = payload?.note
  if (!isNote(note)) throw new NotesRequestError('笔记接口返回了无法识别的数据', response.status)

  const current = bySession.get(input.sessionId) ?? EMPTY
  bySession.set(input.sessionId, [...current, note])
  // 全量缓存若已建立也要并入，否则设置页会看不到刚存的这条。
  if (allNotes !== null) allNotes = [...allNotes, note]
  notify()
  return note
}

/** 删除一条笔记；宿主返回 404 说明本地缓存已过期，按「已删除」处理并刷新。 */
export async function deleteNote(sessionId: string, id: string): Promise<void> {
  if (!sessionId) throw new NotesRequestError('缺少会话 ID', 0)

  let response: Response
  try {
    response = await fetch(NOTES_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    })
  } catch {
    throw new NotesRequestError('无法连接笔记接口', 0)
  }
  if (!response.ok && response.status !== 404) {
    throw new NotesRequestError(await failureMessage(response), response.status)
  }

  const current = bySession.get(sessionId) ?? EMPTY
  const next = current.filter((note) => note.id !== id)
  if (next.length !== current.length) {
    bySession.set(sessionId, next)
    notify()
  }
  // 全量缓存与按会话缓存必须同步，否则同一份数据在两个界面里表现不一致。
  if (allNotes !== null && allNotes.some((note) => note.id === id)) {
    allNotes = allNotes.filter((note) => note.id !== id)
    notify()
  }
  // 404 表示服务端已无此条，本地缓存不可信，重新拉一次。
  if (response.status === 404) await reloadAfterMissing(sessionId)
}

/** 404 后的重新对齐：按会话、以及（若已建立）全量缓存都刷新一次。 */
async function reloadAfterMissing(sessionId: string): Promise<void> {
  const tasks: Promise<unknown>[] = [loadNotes(sessionId)]
  if (allNotes !== null) tasks.push(loadAllNotes())
  await Promise.all(tasks)
}

/**
 * 拉取「全部会话」的笔记并缓存，供设置页跨会话浏览与搜索。
 *
 * 不带 `sessionId` 参数即宿主定义的全量查询。搜索刻意放在客户端做：官方的
 * `sessions.search` 只索引消息正文，不覆盖插件自有文件，接了也搜不到笔记。
 */
export async function loadAllNotes(): Promise<readonly Note[]> {
  if (allInflight) return allInflight

  const task = (async () => {
    let response: Response
    try {
      response = await fetch(NOTES_ENDPOINT, { cache: 'no-store' })
    } catch {
      throw new NotesRequestError('无法连接笔记接口', 0)
    }
    if (!response.ok) throw new NotesRequestError(await failureMessage(response), response.status)

    const notes = parseNotes(await response.json().catch(() => null))
    allNotes = notes
    notify()
    return notes
  })()

  allInflight = task
  try {
    return await task
  } finally {
    allInflight = null
  }
}

/** 全量缓存快照；尚未拉取过时返回 EMPTY（不抛错）。 */
export function getAllNotes(): readonly Note[] {
  return allNotes ?? EMPTY
}

/** 清空本地缓存（登出、切换工作区等场景），不触碰服务端。 */
export function resetNotesCache(): void {
  bySession.clear()
  allNotes = null
  notify()
}
