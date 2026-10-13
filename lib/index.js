import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
//#region ../src/host/notes-store.ts
/**
* 宿主侧的笔记存储。
*
* 所有笔记集中在 harness home 下的一个 JSON 文件里；写入先落到同目录的临时
* 文件再 rename 覆盖，因此中途崩溃也不会让读取方看到半个 JSON。
*/
const HOME_ENV = "DSH_HOME";
const HOME_DIR_NAME = ".dsh";
const NOTES_DIR_NAME = "select-quote";
const NOTES_FILE_NAME = "notes.json";
function isNotFound(error) {
	return error?.code === "ENOENT";
}
/** 展开受支持的波浪号前缀。 */
function expandHomePath(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* 解析 harness home：非空的 `$DSH_HOME` 优先，否则回退到 `~/.dsh`。
*
* 刻意内联而不去 import harness 的 `@deepseek-ai/dsh-home-paths`：外部插件无法
* 假定该包在 profile 里可解析，而这段优先级规则本身足够短。
*/
function resolveHome() {
	const configured = process.env[HOME_ENV];
	const chosen = configured !== void 0 && configured.trim().length > 0 ? configured : join(homedir(), HOME_DIR_NAME);
	return resolve(expandHomePath(chosen));
}
/** 当前环境下笔记文件的绝对路径。 */
function resolveNotesFile() {
	return join(resolveHome(), NOTES_DIR_NAME, NOTES_FILE_NAME);
}
function isNote(value) {
	if (typeof value !== "object" || value === null) return false;
	const note = value;
	return typeof note.id === "string" && typeof note.sessionId === "string" && typeof note.messageId === "string" && typeof note.text === "string" && typeof note.createdAt === "string" && typeof note.startOffset === "number" && typeof note.endOffset === "number";
}
/**
* 读出全部笔记。
*
* 文件不存在是正常的空状态，不算错误；但文件存在却不构成笔记数组时会如实报错，
* 而不是当作空数组 —— 否则紧接着的一次写入就会覆盖掉本来还能抢救的数据。
*/
async function readNotes(file) {
	let raw;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if (isNotFound(error)) return [];
		throw error;
	}
	if (raw.trim().length === 0) return [];
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed) || !parsed.every(isNote)) throw new Error("notes file is not a well-formed note array");
	return parsed;
}
/** 先把 `notes` 落到临时兄弟文件，再 rename 覆盖目标。 */
async function writeNotesAtomic(file, notes) {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
	try {
		await writeFile(temporary, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
		await rename(temporary, file);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => {});
		throw error;
	}
}
/**
* 把「读—改—写」串起来。
*
* 每次变更都是一次读取加一次写入，两个请求重叠时会双双读到旧列表，后一次
* rename 就会吞掉前一条笔记。用一条 promise 链强制串行即可。
*/
let queue = Promise.resolve();
function serialize(job) {
	const run = queue.then(job, job);
	queue = run.then(() => void 0, () => void 0);
	return run;
}
/** 追加一条笔记，返回落盘后的记录。 */
function addNote(file, input) {
	return serialize(async () => {
		const notes = await readNotes(file);
		const note = {
			id: randomUUID(),
			sessionId: input.sessionId,
			messageId: input.messageId,
			startOffset: input.startOffset,
			endOffset: input.endOffset,
			text: input.text,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		await writeNotesAtomic(file, [...notes, note]);
		return note;
	});
}
/** 按 id 删除一条笔记，并报告是否真的删掉了。 */
function deleteNote(file, id) {
	return serialize(async () => {
		const notes = await readNotes(file);
		const remaining = notes.filter((note) => note.id !== id);
		if (remaining.length === notes.length) return false;
		await writeNotesAtomic(file, remaining);
		return true;
	});
}
//#endregion
//#region ../src/host/index.ts
const name = "@xb18/dsh-select-quote";
/**
* 与 dsh-global-rules 取值一致的请求体上限（256 KiB）。
* 单条选区原文远小于此，设上限只是为了不让畸形请求把内存吃满。
*/
const MAX_BODY_BYTES = 262144;
const ROUTE_PATH = "/api/select-quote-notes";
/**
* 只注册 GET 与 POST 两个动词：新增和删除都表达为 POST 的 `action`。
* 这样客户端只需要「读」与「写」两条路径，新增能力不必再动路由表。
*/
const METHODS = ["GET", "POST"];
var HttpError = class extends Error {
	status;
	constructor(status, message) {
		super(message);
		this.status = status;
	}
};
function jsonResponse(status, payload) {
	return Response.json(payload, {
		status,
		headers: { "cache-control": "no-store" }
	});
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** 请求体里声明的长度若已超限就提前拒绝，省去把整体读进内存。 */
function declaredLengthTooLarge(request) {
	const declared = request.headers.get("content-length");
	if (declared === null) return false;
	const size = Number(declared);
	return Number.isFinite(size) && size > MAX_BODY_BYTES;
}
/** 读回 JSON 对象体，并同时用真实字节数复核长度上限。 */
async function readJsonObject(request) {
	const raw = await request.text();
	if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new HttpError(400, "request body is not valid JSON");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new HttpError(400, "request body must be a JSON object");
	return parsed;
}
function requireText(body, field) {
	const value = body[field];
	if (typeof value !== "string" || value.length === 0) throw new HttpError(400, `${field} must be a non-empty string`);
	return value;
}
/** 偏移量必须是有限的非负整数，避免把 NaN / Infinity 写进磁盘。 */
function requireOffset(body, field) {
	const value = body[field];
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new HttpError(400, `${field} must be a non-negative integer`);
	return value;
}
function parseNoteInput(body) {
	return {
		sessionId: requireText(body, "sessionId"),
		messageId: requireText(body, "messageId"),
		startOffset: requireOffset(body, "startOffset"),
		endOffset: requireOffset(body, "endOffset"),
		text: requireText(body, "text")
	};
}
/**
* 按查询参数过滤笔记，供会话标签页与设置页搜索共用。
*
* `sessionId` 为精确匹配（会话归属必须可靠，不做模糊匹配）；`q` 为大小写不敏感
* 的子串匹配，且对未显式传入的 `q` 不区分中英文 —— 中文本身没有大小写，统一走
* `toLowerCase()` 即可覆盖两种输入。
*/
function selectNotes(notes, url) {
	const sessionId = url.searchParams.get("sessionId");
	const query = url.searchParams.get("q")?.trim().toLowerCase();
	return notes.filter((note) => {
		if (sessionId !== null && note.sessionId !== sessionId) return false;
		if (query !== void 0 && query.length > 0 && !note.text.toLowerCase().includes(query)) return false;
		return true;
	});
}
function apply(ctx) {
	const file = resolveNotesFile();
	async function handle(request) {
		try {
			if (request.method === "GET") {
				const url = new URL(request.url);
				return jsonResponse(200, {
					notes: selectNotes(await readNotes(file), url),
					path: file
				});
			}
			if (declaredLengthTooLarge(request)) throw new HttpError(413, "request body too large");
			const body = await readJsonObject(request);
			const action = body.action ?? "add";
			if (action === "delete") return await deleteNote(file, requireText(body, "id")) ? jsonResponse(200, {
				removed: true,
				path: file
			}) : jsonResponse(404, { error: "no note with that id" });
			if (action !== "add") throw new HttpError(400, `unsupported action ${String(action)}`);
			return jsonResponse(201, {
				note: await addNote(file, parseNoteInput(body)),
				path: file
			});
		} catch (error) {
			if (error instanceof HttpError) return jsonResponse(error.status, { error: error.message });
			return jsonResponse(500, { error: messageOf(error) });
		}
	}
	ctx.inject(["connection"], (host) => {
		host.connection.fetch.register({
			path: ROUTE_PATH,
			methods: METHODS,
			requestBody: "buffered",
			fetch: handle
		});
	});
}
//#endregion
export { apply, name };
