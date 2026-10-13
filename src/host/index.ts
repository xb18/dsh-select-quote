/**
 * 本插件的宿主侧（Node）half。
 *
 * 客户端 half 负责单条消息的选区与批注渲染，宿主 half 只做一件事：把用户选中的
 * 原文持久化到磁盘，并给出一个精确 Fetch 路由供客户端读写。之所以落在文件而非
 * 浏览器存储，是因为选区笔记要跨会话、跨窗口存在，且必须能被用户直接备份。
 */

import type { Context } from '@deepseek-ai/cordis'
import { addNote, deleteNote, readNotes, resolveNotesFile, type NoteInput } from './notes-store.ts'

export const name = '@xb18/dsh-select-quote'

/**
 * 与 dsh-global-rules 取值一致的请求体上限（256 KiB）。
 * 单条选区原文远小于此，设上限只是为了不让畸形请求把内存吃满。
 */
const MAX_BODY_BYTES = 256 * 1024

const ROUTE_PATH = '/api/select-quote-notes'

/**
 * 只注册 GET 与 POST 两个动词：新增和删除都表达为 POST 的 `action`。
 * 这样客户端只需要「读」与「写」两条路径，新增能力不必再动路由表。
 */
const METHODS = ['GET', 'POST']

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function jsonResponse(status: number, payload: unknown): Response {
  return Response.json(payload, { status, headers: { 'cache-control': 'no-store' } })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 请求体里声明的长度若已超限就提前拒绝，省去把整体读进内存。 */
function declaredLengthTooLarge(request: Request): boolean {
  const declared = request.headers.get('content-length')
  if (declared === null) return false
  const size = Number(declared)
  return Number.isFinite(size) && size > MAX_BODY_BYTES
}

/** 读回 JSON 对象体，并同时用真实字节数复核长度上限。 */
async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw new HttpError(413, 'request body too large')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'request body is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function requireText(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, `${field} must be a non-empty string`)
  }
  return value
}

/** 偏移量必须是有限的非负整数，避免把 NaN / Infinity 写进磁盘。 */
function requireOffset(body: Record<string, unknown>, field: string): number {
  const value = body[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, `${field} must be a non-negative integer`)
  }
  return value
}

function parseNoteInput(body: Record<string, unknown>): NoteInput {
  return {
    sessionId: requireText(body, 'sessionId'),
    messageId: requireText(body, 'messageId'),
    startOffset: requireOffset(body, 'startOffset'),
    endOffset: requireOffset(body, 'endOffset'),
    text: requireText(body, 'text'),
  }
}

/**
 * 按查询参数过滤笔记，供会话标签页与设置页搜索共用。
 *
 * `sessionId` 为精确匹配（会话归属必须可靠，不做模糊匹配）；`q` 为大小写不敏感
 * 的子串匹配，且对未显式传入的 `q` 不区分中英文 —— 中文本身没有大小写，统一走
 * `toLowerCase()` 即可覆盖两种输入。
 */
function selectNotes(notes: Awaited<ReturnType<typeof readNotes>>, url: URL) {
  const sessionId = url.searchParams.get('sessionId')
  const query = url.searchParams.get('q')?.trim().toLowerCase()
  return notes.filter((note) => {
    if (sessionId !== null && note.sessionId !== sessionId) return false
    if (query !== undefined && query.length > 0 && !note.text.toLowerCase().includes(query)) {
      return false
    }
    return true
  })
}

export function apply(ctx: Context): void {
  const file = resolveNotesFile()

  async function handle(request: Request): Promise<Response> {
    try {
      if (request.method === 'GET') {
        const url = new URL(request.url)
        return jsonResponse(200, { notes: selectNotes(await readNotes(file), url), path: file })
      }
      if (declaredLengthTooLarge(request)) {
        throw new HttpError(413, 'request body too large')
      }
      const body = await readJsonObject(request)
      const action = body.action ?? 'add'
      if (action === 'delete') {
        const removed = await deleteNote(file, requireText(body, 'id'))
        return removed
          ? jsonResponse(200, { removed: true, path: file })
          : jsonResponse(404, { error: 'no note with that id' })
      }
      if (action !== 'add') {
        throw new HttpError(400, `unsupported action ${String(action)}`)
      }
      const note = await addNote(file, parseNoteInput(body))
      return jsonResponse(201, { note, path: file })
    } catch (error) {
      if (error instanceof HttpError) return jsonResponse(error.status, { error: error.message })
      return jsonResponse(500, { error: messageOf(error) })
    }
  }

  ctx.inject(['connection'], (host) => {
    host.connection.fetch.register({
      path: ROUTE_PATH,
      methods: METHODS,
      requestBody: 'buffered',
      fetch: handle,
    })
  })
}
