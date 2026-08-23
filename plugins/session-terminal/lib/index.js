import { createRequire } from "node:module";
import { StringDecoder } from "node:string_decoder";
import { isAbsolute, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { PassThrough } from "node:stream";
//#region src/terminal-runtime.ts
const MAX_TABS_PER_SESSION = 8;
const MAX_TABS_TOTAL = 32;
const MAX_OUTPUT_CHARS = 1048576;
const MAX_HISTORY_CHARS = 65536;
const MAX_HISTORY_ITEMS = 200;
const MAX_INPUT_CHARS = 16384;
/** Bounded text log with monotonically increasing reconnect cursors. */
var OutputRing = class {
	maxChars;
	chunks = [];
	totalChars = 0;
	nextCursor = 0;
	floorCursor = 0;
	partialCursor;
	constructor(maxChars = MAX_OUTPUT_CHARS) {
		this.maxChars = maxChars;
		if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("output bound must be a positive integer");
	}
	get cursor() {
		return this.nextCursor;
	}
	append(value) {
		if (value.length === 0) return;
		const oversized = value.length > this.maxChars;
		const text = oversized ? value.slice(-this.maxChars) : value;
		const cursor = ++this.nextCursor;
		if (oversized) this.partialCursor = cursor;
		this.chunks.push({
			cursor,
			text
		});
		this.totalChars += text.length;
		while (this.totalChars > this.maxChars && this.chunks.length > 0) {
			const removed = this.chunks.shift();
			this.totalChars -= removed.text.length;
			this.floorCursor = removed.cursor;
			if (this.partialCursor === removed.cursor) this.partialCursor = void 0;
		}
	}
	clear() {
		this.chunks.length = 0;
		this.totalChars = 0;
		this.floorCursor = this.nextCursor;
		this.partialCursor = void 0;
		return this.nextCursor;
	}
	read(afterCursor) {
		const requested = Number.isSafeInteger(afterCursor) && afterCursor >= 0 ? afterCursor : 0;
		const truncated = requested < this.floorCursor || this.partialCursor !== void 0 && requested < this.partialCursor;
		const effective = truncated ? this.floorCursor : requested;
		return {
			output: this.chunks.filter((chunk) => chunk.cursor > effective).map((chunk) => chunk.text).join(""),
			cursor: this.nextCursor,
			truncated
		};
	}
};
/** Stateful VT-control remover that preserves split UTF-8 and CRLF boundaries. */
var PlainTerminalDecoder = class {
	decoder = new StringDecoder("utf8");
	mode = "text";
	pendingCarriageReturn = false;
	write(chunk) {
		const text = typeof chunk === "string" ? chunk : this.decoder.write(Buffer.from(chunk));
		return this.consume(text);
	}
	end() {
		const decoded = this.consume(this.decoder.end());
		if (!this.pendingCarriageReturn) return decoded;
		this.pendingCarriageReturn = false;
		return decoded + "\n";
	}
	consume(text) {
		let output = "";
		for (const character of text) {
			if (this.mode === "escape") {
				if (character === "[") this.mode = "csi";
				else if (character === "]") this.mode = "osc";
				else this.mode = "text";
				continue;
			}
			if (this.mode === "csi") {
				if (character >= "@" && character <= "~") this.mode = "text";
				continue;
			}
			if (this.mode === "osc") {
				if (character === "\x07") this.mode = "text";
				else if (character === "\x1B") this.mode = "osc-escape";
				continue;
			}
			if (this.mode === "osc-escape") {
				this.mode = character === "\\" ? "text" : "osc";
				continue;
			}
			if (character === "\x1B") {
				this.mode = "escape";
				continue;
			}
			if (this.pendingCarriageReturn) {
				output += "\n";
				this.pendingCarriageReturn = false;
				if (character === "\n") continue;
			}
			if (character === "\r") {
				this.pendingCarriageReturn = true;
				continue;
			}
			if (character === "\n" || character === "	" || character >= " ") output += character;
		}
		return output;
	}
};
var BoundedHistory = class {
	values = [];
	totalChars = 0;
	add(value) {
		const normalized = value.trimEnd();
		if (normalized.trim().length === 0) return;
		if (this.values.at(-1) === normalized) return;
		const accepted = normalized.slice(0, MAX_INPUT_CHARS);
		this.values.push(accepted);
		this.totalChars += accepted.length;
		while (this.values.length > 200 || this.totalChars > 65536) this.totalChars -= this.values.shift().length;
	}
	snapshot() {
		return [...this.values];
	}
};
/** Owns PowerShell tabs independently from renderer mount and connection lifetimes. */
var TerminalManager = class {
	options;
	terminals = /* @__PURE__ */ new Map();
	openingBySession = /* @__PURE__ */ new Map();
	openingTotal = 0;
	shellPath;
	disposed = false;
	sequence = 0;
	constructor(options) {
		this.options = options;
	}
	list(sessionId) {
		return [...this.terminals.values()].filter((terminal) => terminal.sessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt).map((terminal) => this.snapshot(terminal));
	}
	async open(sessionId, requestedName) {
		this.assertActive();
		const cwd = await this.sessionCwd(sessionId);
		if (this.list(sessionId).length + (this.openingBySession.get(sessionId) ?? 0) >= 8) throw terminalError("TAB_LIMIT", `每个会话最多打开 8 个终端。`, 409);
		if (this.terminals.size + this.openingTotal >= 32) throw terminalError("HOST_TAB_LIMIT", `当前应用最多打开 32 个终端。`, 409);
		this.openingBySession.set(sessionId, (this.openingBySession.get(sessionId) ?? 0) + 1);
		this.openingTotal += 1;
		try {
			const terminalId = this.nextId();
			const terminal = {
				terminalId,
				sessionId,
				name: normalizeName(requestedName) ?? this.nextName(sessionId),
				cwd,
				createdAt: (this.options.now ?? Date.now)(),
				history: new BoundedHistory(),
				output: new OutputRing(),
				handle: void 0,
				decoder: void 0,
				status: {
					kind: "failed",
					message: "PowerShell 尚未启动。"
				},
				operation: Promise.resolve(),
				generation: 0
			};
			await this.spawnInto(terminal);
			if (this.disposed) {
				await terminal.handle?.terminate();
				throw terminalError("TERMINAL_DISPOSING", "终端服务正在关闭。", 503);
			}
			this.terminals.set(terminalId, terminal);
			return this.snapshot(terminal);
		} finally {
			this.openingTotal -= 1;
			const remaining = (this.openingBySession.get(sessionId) ?? 1) - 1;
			if (remaining === 0) this.openingBySession.delete(sessionId);
			else this.openingBySession.set(sessionId, remaining);
		}
	}
	read(sessionId, terminalId, cursor) {
		const terminal = this.owned(sessionId, terminalId);
		const page = terminal.output.read(cursor);
		return {
			terminal: this.snapshot(terminal),
			...page
		};
	}
	async write(sessionId, terminalId, text, submit = true) {
		const terminal = this.owned(sessionId, terminalId);
		const input = normalizeInput(text);
		return this.serialized(terminal, async () => {
			const handle = this.runningHandle(terminal);
			if (submit) terminal.history.add(input);
			const terminalInput = input.replace(/\r\n|\n|\r/gu, "\r") + (submit ? "\r" : "");
			await handle.write(terminalInput);
			return this.snapshot(terminal);
		});
	}
	clear(sessionId, terminalId) {
		return { cursor: this.owned(sessionId, terminalId).output.clear() };
	}
	async interrupt(sessionId, terminalId) {
		const terminal = this.owned(sessionId, terminalId);
		return this.serialized(terminal, async () => {
			await this.runningHandle(terminal).signalForeground("SIGINT");
			return { delivered: true };
		});
	}
	async restart(sessionId, terminalId) {
		const terminal = this.owned(sessionId, terminalId);
		return this.serialized(terminal, async () => {
			const oldHandle = terminal.handle;
			terminal.handle = void 0;
			terminal.generation += 1;
			if (oldHandle !== void 0) await oldHandle.terminate();
			terminal.output.clear();
			try {
				await this.spawnInto(terminal);
			} catch (error) {
				terminal.status = {
					kind: "failed",
					message: safeFailure(error)
				};
				throw error;
			}
			return this.snapshot(terminal);
		});
	}
	async close(sessionId, terminalId) {
		const terminal = this.owned(sessionId, terminalId);
		await this.serialized(terminal, async () => {
			const handle = terminal.handle;
			terminal.handle = void 0;
			terminal.generation += 1;
			if (handle !== void 0) await handle.terminate();
			this.terminals.delete(terminalId);
		});
		return { closed: terminalId };
	}
	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		const terminals = [...this.terminals.values()];
		this.terminals.clear();
		const failures = (await Promise.allSettled(terminals.map((terminal) => this.serialized(terminal, async () => {
			const handle = terminal.handle;
			terminal.handle = void 0;
			terminal.generation += 1;
			if (handle !== void 0) await handle.terminate();
		})))).flatMap((outcome) => outcome.status === "rejected" ? [outcome.reason] : []);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "session terminal cleanup failed");
	}
	async spawnInto(terminal) {
		this.assertActive();
		const executable = await (this.shellPath ??= this.resolvePowerShell());
		const generation = ++terminal.generation;
		const spec = {
			argv: [
				executable,
				"-NoLogo",
				"-NoProfile",
				"-NoExit",
				"-Command",
				powerShellUtf8Bootstrap()
			],
			cwd: terminal.cwd,
			env: {
				TERM: "xterm-256color",
				COLORTERM: "truecolor",
				PYTHONUTF8: "1",
				PYTHONIOENCODING: "utf-8"
			},
			rows: 32,
			cols: 120,
			graceMs: 2e3
		};
		const handle = this.options.spawnTerminal === void 0 ? await this.options.subprocess.spawnTerminal(spec) : await this.options.spawnTerminal(spec);
		const decoder = new PlainTerminalDecoder();
		terminal.handle = handle;
		terminal.decoder = decoder;
		terminal.status = { kind: "running" };
		const onData = (chunk) => {
			if (terminal.generation !== generation || terminal.handle !== handle) return;
			const plain = decoder.write(typeof chunk === "string" ? chunk : Buffer.from(chunk));
			terminal.output.append(plain);
		};
		handle.output.on("data", onData);
		handle.done.then((outcome) => {
			handle.output.off("data", onData);
			if (terminal.generation !== generation || terminal.handle !== handle) return;
			terminal.output.append(decoder.end());
			terminal.status = {
				kind: "exited",
				exitCode: outcome.exitCode,
				signal: outcome.signal
			};
		}, (error) => {
			handle.output.off("data", onData);
			if (terminal.generation !== generation || terminal.handle !== handle) return;
			terminal.output.append(decoder.end());
			terminal.status = {
				kind: "failed",
				message: safeFailure(error)
			};
		});
	}
	async sessionCwd(sessionId) {
		const session = this.options.sessions.get(sessionId);
		if (session === void 0) throw terminalError("SESSION_NOT_LIVE", "当前会话尚未在 Host 中就绪。", 409);
		const cwd = session.header.cwd;
		if (typeof cwd !== "string" || !isAbsolute(cwd)) throw terminalError("SESSION_CWD_REQUIRED", "当前会话没有可用的绝对工作目录。", 409);
		try {
			if (!(await stat(cwd)).isDirectory()) throw new Error("not a directory");
		} catch {
			throw terminalError("SESSION_CWD_UNAVAILABLE", "当前会话的工作目录不存在或不可访问。", 409);
		}
		return cwd;
	}
	async resolvePowerShell() {
		const platform = this.options.platform ?? process.platform;
		const env = this.options.env ?? process.env;
		const candidates = platform === "win32" ? [
			...[env.ProgramW6432, env.ProgramFiles].filter((value) => typeof value === "string" && value !== "").map((directory) => join(directory, "PowerShell", "7", "pwsh.exe")),
			"pwsh.exe",
			"pwsh",
			...typeof env.SystemRoot === "string" && env.SystemRoot !== "" ? [join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")] : [],
			"powershell.exe"
		] : ["pwsh", "powershell"];
		for (const candidate of [...new Set(candidates)]) try {
			return await this.options.subprocess.resolveExecutable(candidate);
		} catch (_candidateUnavailable) {}
		throw terminalError("POWERSHELL_NOT_FOUND", "没有找到可用的 PowerShell。请安装 PowerShell 7 或启用 Windows PowerShell。", 503);
	}
	snapshot(terminal) {
		return {
			terminalId: terminal.terminalId,
			sessionId: terminal.sessionId,
			name: terminal.name,
			cwd: terminal.cwd,
			...terminal.handle === void 0 ? {} : { pid: terminal.handle.pid },
			createdAt: terminal.createdAt,
			status: terminal.status,
			cursor: terminal.output.cursor,
			history: terminal.history.snapshot()
		};
	}
	owned(sessionId, terminalId) {
		const terminal = this.terminals.get(terminalId);
		if (terminal === void 0 || terminal.sessionId !== sessionId) throw terminalError("TERMINAL_NOT_FOUND", "这个会话中不存在指定终端。", 404);
		return terminal;
	}
	runningHandle(terminal) {
		if (terminal.handle === void 0 || terminal.status.kind !== "running") throw terminalError("TERMINAL_NOT_RUNNING", "PowerShell 当前未运行，请先重启终端。", 409);
		return terminal.handle;
	}
	async serialized(terminal, operation) {
		const previous = terminal.operation;
		let release;
		terminal.operation = new Promise((resolve) => {
			release = resolve;
		});
		await previous.catch(() => {});
		try {
			return await operation();
		} finally {
			release();
		}
	}
	nextName(sessionId) {
		const names = new Set(this.list(sessionId).map((terminal) => terminal.name));
		let index = 1;
		while (names.has(`PowerShell ${index}`)) index += 1;
		return `PowerShell ${index}`;
	}
	nextId() {
		const generated = this.options.makeId?.();
		if (generated !== void 0 && generated !== "") return generated;
		return `pst-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
	}
	assertActive() {
		if (this.disposed) throw terminalError("TERMINAL_DISPOSING", "终端服务正在关闭。", 503);
	}
};
function terminalError(code, message, status = 400) {
	return Object.assign(new Error(message), {
		code,
		status
	});
}
function normalizeName(value) {
	if (value === void 0) return void 0;
	const normalized = value.trim().replace(/\s+/gu, " ");
	if (normalized.length === 0 || normalized.length > 80) throw terminalError("INVALID_TERMINAL_NAME", "终端名称长度必须为 1 到 80 个字符。");
	return normalized;
}
function normalizeInput(value) {
	if (typeof value !== "string" || value.length > 16384 || value.includes("\0")) throw terminalError("INVALID_TERMINAL_INPUT", `终端输入必须是不含 NUL 的文本，且不超过 ${MAX_INPUT_CHARS} 个字符。`);
	return value;
}
function powerShellUtf8Bootstrap() {
	return "[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $global:OutputEncoding = [Console]::OutputEncoding; $ProgressPreference = 'SilentlyContinue'";
}
function safeFailure(error) {
	return error instanceof Error && error.message.trim() !== "" ? error.message.slice(0, 300) : "PowerShell 连接已断开。";
}
//#endregion
//#region src/http.ts
const TERMINAL_API_PREFIX = "/__personal/terminal";
const MAX_BODY_BYTES = 65536;
/** Create the loopback JSON handler without starting Harness. */
function createTerminalRequestHandler(manager) {
	return async (request, response) => {
		try {
			if (request.headers["x-dsh-personal-terminal"] !== "1") throw terminalError("TERMINAL_CLIENT_REQUIRED", "此接口只供个人桌面终端使用。", 403);
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (!url.pathname.startsWith("/__personal/terminal")) throw terminalError("NOT_FOUND", "终端接口不存在。", 404);
			const resource = url.pathname.slice(20);
			const method = request.method ?? "GET";
			const body = method === "GET" ? {} : record(await readJsonBody(request));
			sendJson(response, 200, {
				ok: true,
				data: await dispatch(manager, resource, method, url.searchParams, body)
			});
		} catch (error) {
			const status = errorStatus(error);
			sendJson(response, status, {
				ok: false,
				error: {
					code: errorCode(error, status),
					message: status >= 500 ? safeServerMessage(error) : errorMessage(error)
				}
			});
		}
	};
}
async function dispatch(manager, resource, method, query, body) {
	if (resource === "/tabs" && method === "GET") return { terminals: manager.list(sessionId(query.get("sessionId"))) };
	if (resource === "/tabs" && method === "POST") return manager.open(sessionId(body.sessionId), optionalText(body.name, 80));
	if (resource === "/tabs" && method === "DELETE") return manager.close(sessionId(body.sessionId), terminalId(body.terminalId));
	if (resource === "/output" && method === "GET") return manager.read(sessionId(query.get("sessionId")), terminalId(query.get("terminalId")), cursor(query.get("cursor")));
	if (resource === "/input" && method === "POST") {
		if (typeof body.text !== "string") throw terminalError("INVALID_TERMINAL_INPUT", "终端输入必须是文本。");
		return manager.write(sessionId(body.sessionId), terminalId(body.terminalId), body.text, body.submit !== false);
	}
	if (resource === "/clear" && method === "POST") return manager.clear(sessionId(body.sessionId), terminalId(body.terminalId));
	if (resource === "/interrupt" && method === "POST") return manager.interrupt(sessionId(body.sessionId), terminalId(body.terminalId));
	if (resource === "/restart" && method === "POST") return manager.restart(sessionId(body.sessionId), terminalId(body.terminalId));
	if ([
		"/tabs",
		"/output",
		"/input",
		"/clear",
		"/interrupt",
		"/restart"
	].includes(resource)) throw terminalError("METHOD_NOT_ALLOWED", "此终端接口不支持该请求方法。", 405);
	throw terminalError("NOT_FOUND", "终端接口不存在。", 404);
}
async function readJsonBody(request) {
	const declared = Number(request.headers["content-length"] ?? 0);
	if (Number.isFinite(declared) && declared > 65536) throw terminalError("BODY_TOO_LARGE", "终端请求内容过大。", 413);
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > 65536) throw terminalError("BODY_TOO_LARGE", "终端请求内容过大。", 413);
		chunks.push(buffer);
	}
	if (size === 0) return {};
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw terminalError("INVALID_JSON", "终端请求不是有效的 JSON。");
	}
}
function sessionId(value) {
	if (typeof value !== "string" || value.length < 1 || value.length > 300 || /[\u0000-\u001f]/u.test(value)) throw terminalError("INVALID_SESSION_ID", "会话标识无效。");
	return value;
}
function terminalId(value) {
	if (typeof value !== "string" || value.length < 1 || value.length > 120 || !/^[a-zA-Z0-9_-]+$/u.test(value)) throw terminalError("INVALID_TERMINAL_ID", "终端标识无效。");
	return value;
}
function cursor(value) {
	if (value === null || value === void 0 || value === "") return 0;
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) throw terminalError("INVALID_CURSOR", "终端游标无效。");
	return parsed;
}
function optionalText(value, maxLength) {
	if (value === void 0) return void 0;
	if (typeof value !== "string" || value.length > maxLength) throw terminalError("INVALID_TEXT", "文本字段无效。");
	return value;
}
function record(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw terminalError("INVALID_BODY", "终端请求正文必须是 JSON 对象。");
	return value;
}
function sendJson(response, status, value) {
	if (response.headersSent) return;
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	response.end(JSON.stringify(value));
}
function errorStatus(error) {
	const status = error?.status;
	return typeof status === "number" && status >= 400 && status <= 599 ? status : 500;
}
function errorCode(error, status) {
	const code = error?.code;
	return typeof code === "string" && code !== "" ? code : status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
}
function errorMessage(error) {
	return error instanceof Error && error.message !== "" ? error.message : "终端请求失败。";
}
function safeServerMessage(error) {
	const code = error?.code;
	if (code === "POWERSHELL_NOT_FOUND" || code === "TERMINAL_DISPOSING") return errorMessage(error);
	return "终端服务请求失败。";
}
//#endregion
//#region src/windows-terminal.ts
/** Create the Windows-only ConPTY adapter used while the upstream inspector rejects win32. */
function createWindowsTerminalSpawner(env = process.env) {
	let nodePty;
	return async (spec) => {
		if (process.platform !== "win32") throw new Error("the personal Windows terminal adapter requires win32");
		const file = spec.argv[0];
		if (file === void 0 || file === "") throw new Error("terminal argv must contain PowerShell");
		nodePty ??= loadNodePty(env);
		return new WindowsTerminalHandle(nodePty.spawn(file, [...spec.argv.slice(1)], {
			name: "xterm-256color",
			rows: spec.rows,
			cols: spec.cols,
			cwd: spec.cwd,
			env: scrubbedChildEnv(spec.env, env)
		}), spec.graceMs);
	};
}
/** node-pty handle with bounded-wait, exact-tree termination for one owned tab. */
var WindowsTerminalHandle = class {
	terminal;
	graceMs;
	pid;
	output = new PassThrough();
	done;
	completion = Promise.withResolvers();
	dataDisposable;
	exitDisposable;
	cleanup;
	exited = false;
	constructor(terminal, graceMs) {
		this.terminal = terminal;
		this.graceMs = graceMs;
		this.pid = terminal.pid;
		this.done = this.completion.promise;
		this.dataDisposable = terminal.onData((data) => {
			this.output.write(Buffer.from(data, "utf8"));
		});
		this.exitDisposable = terminal.onExit(({ exitCode, signal }) => {
			if (this.exited) return;
			this.exited = true;
			this.output.end();
			this.completion.resolve({
				exitCode: signal === void 0 || signal === 0 ? exitCode : null,
				signal: signalName(signal)
			});
		});
	}
	async write(data) {
		if (this.exited) throw new Error("terminal process has exited");
		this.terminal.write(data);
	}
	async signalForeground(signal) {
		if (signal !== "SIGINT") throw new Error(`unsupported Windows terminal signal: ${signal}`);
		if (this.exited) throw new Error("terminal process has exited");
		this.terminal.write("");
		return this.pid;
	}
	terminate() {
		this.cleanup ??= this.closeOnce();
		return this.cleanup;
	}
	async closeOnce() {
		if (!this.exited) {
			try {
				this.terminal.kill();
			} catch (_ptyAlreadyExited) {}
			await Promise.race([this.done.then(() => void 0), delay(this.graceMs)]);
		}
		if (!this.exited) {
			await taskkillTree(this.pid);
			await Promise.race([this.done.then(() => void 0), delay(this.graceMs)]);
		}
		if (!this.exited) throw new Error(`PowerShell cleanup failed; surviving pid: ${this.pid}`);
		this.dataDisposable.dispose();
		this.exitDisposable.dispose();
	}
};
function loadNodePty(env) {
	const profileRequire = createRequire(join(resolve(env.DSH_HOME || join(homedir(), ".dsh")), "profiles", "web", "package.json"));
	const manifests = [];
	try {
		manifests.push(profileRequire.resolve("@deepseek-ai/dsh-subprocess-local/package.json"));
	} catch (_profilePackageUnavailable) {}
	if (typeof env.DSH_SOURCE_ROOT === "string" && env.DSH_SOURCE_ROOT !== "") manifests.push(join(resolve(env.DSH_SOURCE_ROOT), "packages", "subprocess", "subprocess-local", "package.json"));
	manifests.push("D:\\Deepseek Harness\\packages\\subprocess\\subprocess-local\\package.json");
	for (const manifest of [...new Set(manifests)]) try {
		return createRequire(manifest)("node-pty");
	} catch (_nodePtyUnavailableAtCandidate) {}
	throw new Error("Harness subprocess-local 的 node-pty 依赖不可用；请先在上游目录执行 pnpm install。");
}
/** Mirror the upstream subprocess environment scrub without importing a second runtime instance. */
function scrubbedChildEnv(extra, parent) {
	const entries = [];
	for (const [key, value] of Object.entries(parent)) {
		if (value === void 0 || /KEY|PASSWORD|SECRET|TOKEN/iu.test(key) || key.toUpperCase().startsWith("DSH_")) continue;
		entries.push([key, value]);
	}
	for (const [key, value] of Object.entries(extra)) {
		const normalized = key.toUpperCase();
		for (let index = entries.length - 1; index >= 0; index -= 1) if (entries[index]?.[0].toUpperCase() === normalized) entries.splice(index, 1);
		entries.push([key, value]);
	}
	return Object.fromEntries(entries);
}
function taskkillTree(pid) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.reject(/* @__PURE__ */ new Error("invalid PowerShell pid"));
	return new Promise((resolvePromise) => {
		execFile("taskkill.exe", [
			"/PID",
			String(pid),
			"/T",
			"/F"
		], { windowsHide: true }, () => {
			resolvePromise();
		});
	});
}
function signalName(signal) {
	return signal === void 0 || signal === 0 ? null : `SIGNAL_${signal}`;
}
function delay(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
//#endregion
//#region src/index.ts
/** Required Harness services for the isolated PowerShell Host. */
const inject = [
	"webServer",
	"subprocess",
	"sessions"
];
/** Register the terminal API and ensure every PTY is joined during plugin teardown. */
function apply(ctx) {
	const manager = new TerminalManager({
		subprocess: ctx.subprocess,
		sessions: ctx.sessions,
		...process.platform === "win32" ? { spawnTerminal: createWindowsTerminalSpawner() } : {}
	});
	const handler = createTerminalRequestHandler(manager);
	ctx.effect(() => {
		const unregister = ctx.webServer.register({
			kind: "prefix",
			path: TERMINAL_API_PREFIX,
			handler
		});
		return async () => {
			unregister();
			await manager.dispose();
		};
	}, "personal session terminal API and PTY lifecycle");
}
//#endregion
export { MAX_BODY_BYTES, MAX_HISTORY_CHARS, MAX_HISTORY_ITEMS, MAX_INPUT_CHARS, MAX_OUTPUT_CHARS, MAX_TABS_PER_SESSION, MAX_TABS_TOTAL, OutputRing, PlainTerminalDecoder, TERMINAL_API_PREFIX, TerminalManager, apply, createTerminalRequestHandler, createWindowsTerminalSpawner, inject, terminalError };
