/**
 * 宿主侧的笔记存储。
 *
 * 所有笔记集中在 harness home 下的一个 JSON 文件里；写入先落到同目录的临时
 * 文件再 rename 覆盖，因此中途崩溃也不会让读取方看到半个 JSON。
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** 一条已保存的选区。只保留选中的原文，不存评论正文。 */
export interface Note {
  id: string
  sessionId: string
  messageId: string
  startOffset: number
  endOffset: number
  text: string
  createdAt: string
}

/** 调用方提供的字段；`id` 与 `createdAt` 由存储层生成。 */
export interface NoteInput {
  sessionId: string
  messageId: string
  startOffset: number
  endOffset: number
  text: string
}

const HOME_ENV = 'DSH_HOME'
const HOME_DIR_NAME = '.dsh'
const NOTES_DIR_NAME = 'select-quote'
const NOTES_FILE_NAME = 'notes.json'

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** 展开受支持的波浪号前缀。 */
function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * 解析 harness home：非空的 `$DSH_HOME` 优先，否则回退到 `~/.dsh`。
 *
 * 刻意内联而不去 import harness 的 `@deepseek-ai/dsh-home-paths`：外部插件无法
 * 假定该包在 profile 里可解析，而这段优先级规则本身足够短。
 */
export function resolveHome(): string {
  const configured = process.env[HOME_ENV]
  const chosen =
    configured !== undefined && configured.trim().length > 0
      ? configured
      : join(homedir(), HOME_DIR_NAME)
  return resolve(expandHomePath(chosen))
}

/** 当前环境下笔记文件的绝对路径。 */
export function resolveNotesFile(): string {
  return join(resolveHome(), NOTES_DIR_NAME, NOTES_FILE_NAME)
}

function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) return false
  const note = value as Record<string, unknown>
  return (
    typeof note.id === 'string' &&
    typeof note.sessionId === 'string' &&
    typeof note.messageId === 'string' &&
    typeof note.text === 'string' &&
    typeof note.createdAt === 'string' &&
    typeof note.startOffset === 'number' &&
    typeof note.endOffset === 'number'
  )
}

/**
 * 读出全部笔记。
 *
 * 文件不存在是正常的空状态，不算错误；但文件存在却不构成笔记数组时会如实报错，
 * 而不是当作空数组 —— 否则紧接着的一次写入就会覆盖掉本来还能抢救的数据。
 */
export async function readNotes(file: string): Promise<Note[]> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
  if (raw.trim().length === 0) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || !parsed.every(isNote)) {
    throw new Error('notes file is not a well-formed note array')
  }
  return parsed
}

/** 先把 `notes` 落到临时兄弟文件，再 rename 覆盖目标。 */
async function writeNotesAtomic(file: string, notes: Note[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temporary, `${JSON.stringify(notes, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * 把「读—改—写」串起来。
 *
 * 每次变更都是一次读取加一次写入，两个请求重叠时会双双读到旧列表，后一次
 * rename 就会吞掉前一条笔记。用一条 promise 链强制串行即可。
 */
let queue: Promise<unknown> = Promise.resolve()

function serialize<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 追加一条笔记，返回落盘后的记录。 */
export function addNote(file: string, input: NoteInput): Promise<Note> {
  return serialize(async () => {
    const notes = await readNotes(file)
    const note: Note = {
      id: randomUUID(),
      sessionId: input.sessionId,
      messageId: input.messageId,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      text: input.text,
      createdAt: new Date().toISOString(),
    }
    await writeNotesAtomic(file, [...notes, note])
    return note
  })
}

/** 按 id 删除一条笔记，并报告是否真的删掉了。 */
export function deleteNote(file: string, id: string): Promise<boolean> {
  return serialize(async () => {
    const notes = await readNotes(file)
    const remaining = notes.filter((note) => note.id !== id)
    if (remaining.length === notes.length) return false
    await writeNotesAtomic(file, remaining)
    return true
  })
}
