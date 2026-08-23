import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
//#region src/image-vision.ts
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const OMNIBUS_PROMPT = ["你是识图助手。请仔细分析这张图片并只输出一个 JSON 对象（不要 Markdown 代码块、不要多余文字），字段如下：", "{\"summary\":\"用一句话概括图片内容\",\"ocr\":\"图片中可识别的文字内容，没有则为空字符串\",\"uiAnalysis\":\"如果是界面截图或 UI：说明布局与功能要点；否则写 不适用\"}"].join("\n");
var ImageVisionError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "ImageVisionError";
		this.code = code;
	}
};
function boundedText(value, maxLength) {
	if (typeof value !== "string") return "";
	return value.trim().slice(0, maxLength);
}
/**
* Parse a model answer into the omnibus result shape. Models that return
* clean JSON pass through; fenced or verbose answers degrade to a summary
* of the raw text instead of failing the whole request.
*/
function parseOmnibusResult(raw) {
	const text = raw.trim();
	const candidate = /```(?:json)?\s*([\s\S]*?)```/u.exec(text)?.[1] ?? text;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start >= 0 && end > start) try {
		const parsed = JSON.parse(candidate.slice(start, end + 1));
		const summary = boundedText(parsed.summary, 2e3);
		const ocr = boundedText(parsed.ocr, 2e4);
		const uiAnalysis = boundedText(parsed.uiAnalysis, 2e4);
		if (summary !== "" || ocr !== "" || uiAnalysis !== "") return {
			summary: summary || "（模型没有给出概括）",
			ocr,
			uiAnalysis: uiAnalysis || "不适用"
		};
	} catch {}
	return {
		summary: boundedText(text, 2e3) || "（模型返回为空）",
		ocr: "",
		uiAnalysis: "不适用"
	};
}
/**
* One OpenAI-compatible vision call: a single user message carrying the
* omnibus prompt plus the image as a data URL. Host-bounded: no renderer
* code ever touches the provider key or the raw model response.
*/
async function analyzeImage(input, options = {}) {
	const { endpoint, apiKey, model, mimeType, base64 } = input;
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 6e4;
	let base;
	try {
		base = new URL(endpoint);
		if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("unsupported protocol");
	} catch {
		throw new ImageVisionError("INVALID_ENDPOINT", "模型 API 地址无效。");
	}
	const target = new URL(base.pathname.replace(/\/$/u, "") + "/chat/completions", base);
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, timeoutMs);
	const abortFromCaller = () => {
		controller.abort();
	};
	options.signal?.addEventListener("abort", abortFromCaller);
	try {
		const response = await fetchImpl(target.toString(), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer " + apiKey
			},
			body: JSON.stringify({
				model,
				messages: [{
					role: "user",
					content: [{
						type: "text",
						text: OMNIBUS_PROMPT
					}, {
						type: "image_url",
						image_url: { url: "data:" + mimeType + ";base64," + base64 }
					}]
				}]
			}),
			signal: controller.signal
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			if (response.status === 401 || response.status === 403) throw new ImageVisionError("PROVIDER_AUTH_FAILED", "模型服务拒绝了密钥。");
			if (response.status === 404) throw new ImageVisionError("PROVIDER_NOT_FOUND", "模型服务地址或模型名无效（404）。");
			throw new ImageVisionError("PROVIDER_ERROR", `模型服务返回 HTTP ${String(response.status)}。${detail.slice(0, 120)}`);
		}
		const payload = await response.json();
		const content = payload.choices?.[0]?.message?.content;
		if (typeof content !== "string" || content.trim() === "") throw new ImageVisionError("EMPTY_RESPONSE", "模型没有返回可用的文字内容。");
		return {
			...parseOmnibusResult(content),
			provider: base.host,
			model: typeof payload.model === "string" && payload.model !== "" ? payload.model : model
		};
	} catch (error) {
		if (error instanceof ImageVisionError) throw error;
		if (error?.name === "AbortError" || controller.signal.aborted) throw new ImageVisionError("PROVIDER_TIMEOUT", "模型服务响应超时。");
		throw new ImageVisionError("PROVIDER_UNREACHABLE", "无法连接模型服务。");
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", abortFromCaller);
	}
}
//#endregion
//#region src/index.ts
const IMAGE_VISION_API_PREFIX = "/__personal/image-vision";
const MAX_ANALYZE_BODY_BYTES = 4096;
const UPLOAD_TTL_MS = 5 * 6e4;
const MAX_SESSION_IMAGES = 64;
/**
* 按文件路径定位 personal-foundation 主机包入口（与 memory 插件同款套路）：
* 源码态与打包态都不存在插件内按包名解析的 node_modules 链接，包名 import 会
* 以「Cannot find package」静默失败；候选路径：src → ../../，lib → ../。
*/
function foundationBundleUrl() {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [resolve(here, "..", "..", "personal-foundation", "lib", "index.js")];
	for (const candidate of candidates) if (existsSync(candidate)) return pathToFileURL(candidate).href;
	throw new Error("personal-foundation 主机包未找到（near " + here + "）。");
}
function imageVisionError(code, message, status = 400) {
	return Object.assign(new Error(message), {
		code,
		status,
		expose: true
	});
}
/** Host services used by the image-vision analyzer. */
const inject = ["webServer", "credentials"];
function apply(ctx) {
	ctx.effect(async () => {
		const PersonalStore = (await import(foundationBundleUrl())).PersonalStore;
		if (typeof PersonalStore !== "function") throw new Error("personal-foundation 主机包未导出 PersonalStore（lib 版本过旧，请重建插件）。");
		const runtime = {
			store: new PersonalStore(join(resolve(process.env.DSH_HOME || join(homedir(), ".dsh")), "personal", "personal-suite.json")),
			credentials: ctx.credentials,
			uploads: /* @__PURE__ */ new Map()
		};
		const unregister = ctx.webServer.register({
			kind: "prefix",
			path: IMAGE_VISION_API_PREFIX,
			handler: createImageVisionRequestHandler(runtime)
		});
		return () => {
			unregister();
		};
	}, "image vision API route");
}
/** Exported for focused HTTP contract tests without starting the full Harness. */
function createImageVisionRequestHandler(runtime) {
	return async (request, response) => {
		try {
			if (request.headers["x-dsh-image-vision"] !== "1") throw imageVisionError("IMAGE_VISION_CLIENT_REQUIRED", "此接口只供个人桌面识图组件使用。", 403);
			const resource = new URL(request.url ?? "/", "http://127.0.0.1").pathname.slice(24);
			const method = request.method ?? "GET";
			if (resource === "/connections" && method === "GET") {
				sendJson(response, 200, {
					ok: true,
					data: await listModelConnections(runtime)
				});
				return;
			}
			if (resource === "/upload" && method === "POST") {
				const sessionId = requireHeader(request, "x-session-id", 200);
				const mimeType = requireHeader(request, "content-type", 100);
				if (!mimeType.startsWith("image/")) throw imageVisionError("NOT_AN_IMAGE", "上传内容不是图片。");
				const buffer = await readRawBody(request, MAX_IMAGE_BYTES);
				if (buffer.length === 0) throw imageVisionError("EMPTY_IMAGE", "上传的图片是空的。");
				pruneUploads(runtime);
				if (runtime.uploads.size >= MAX_SESSION_IMAGES && !runtime.uploads.has(sessionId)) throw imageVisionError("TOO_MANY_UPLOADS", "待识别的图片过多，请先完成现有识别。", 429);
				const expiresAt = Date.now() + UPLOAD_TTL_MS;
				runtime.uploads.set(sessionId, {
					buffer,
					mimeType,
					expiresAt
				});
				sendJson(response, 200, {
					ok: true,
					data: {
						bytes: buffer.length,
						mimeType,
						expiresAt: new Date(expiresAt).toISOString()
					}
				});
				return;
			}
			if (resource === "/analyze" && method === "POST") {
				const body = await readJsonBody(request, MAX_ANALYZE_BODY_BYTES);
				const sessionId = boundedField(body.sessionId, 200);
				const connectionId = boundedField(body.connectionId, 80);
				const model = boundedField(body.model, 200);
				if (sessionId === "" || connectionId === "" || model === "") throw imageVisionError("INVALID_BODY", "缺少会话、连接或模型名。");
				const uploaded = runtime.uploads.get(sessionId);
				if (uploaded === void 0 || uploaded.expiresAt < Date.now()) throw imageVisionError("NO_IMAGE", "请先上传图片。", 404);
				const connection = await findModelConnection(runtime, connectionId);
				if (connection === null) throw imageVisionError("CONNECTION_NOT_FOUND", "模型连接不存在。", 404);
				if (!connection.enabled) throw imageVisionError("CONNECTION_DISABLED", "该模型连接已停用。", 409);
				const endpoint = await resolveCredential(runtime, connection.endpointRef);
				const apiKey = await resolveCredential(runtime, connection.secretRef);
				if (endpoint === void 0 || apiKey === void 0) throw imageVisionError("CONNECTION_NOT_CONFIGURED", "该模型连接缺少 API 地址或密钥。", 409);
				sendJson(response, 200, {
					ok: true,
					data: {
						result: await analyzeImage({
							endpoint,
							apiKey,
							model,
							mimeType: uploaded.mimeType,
							base64: uploaded.buffer.toString("base64")
						}),
						connectionLabel: connection.label
					}
				});
				return;
			}
			if ([
				"/connections",
				"/upload",
				"/analyze"
			].includes(resource)) throw imageVisionError("METHOD_NOT_ALLOWED", "此识图接口不支持该请求方法。", 405);
			throw imageVisionError("NOT_FOUND", "识图接口不存在。", 404);
		} catch (error) {
			const status = errorStatus(error);
			sendJson(response, status, {
				ok: false,
				error: {
					code: errorCode(error, status),
					message: status >= 500 ? "识图服务请求失败。" : messageOf(error)
				}
			});
		}
	};
}
async function listModelConnections(runtime) {
	const document = await runtime.store.read();
	const connections = [];
	for (const stored of document.connections) {
		if (stored.kind !== "model") continue;
		const [endpoint, secret] = await Promise.all([describeCredential(runtime, stored.endpointRef), describeCredential(runtime, stored.secretRef)]);
		connections.push({
			id: stored.id,
			label: stored.label,
			enabled: stored.enabled,
			endpointConfigured: endpoint.configured,
			secretConfigured: secret.configured
		});
	}
	return { connections };
}
async function findModelConnection(runtime, connectionId) {
	return (await runtime.store.read()).connections.find((item) => item.id === connectionId && item.kind === "model") ?? null;
}
async function resolveCredential(runtime, reference) {
	try {
		return (await runtime.credentials.resolve(reference))?.value;
	} catch {
		return;
	}
}
async function describeCredential(runtime, reference) {
	try {
		return await runtime.credentials.describe(reference);
	} catch {
		return {
			configured: false,
			writable: false
		};
	}
}
function pruneUploads(runtime) {
	const now = Date.now();
	for (const [sessionId, uploaded] of runtime.uploads) if (uploaded.expiresAt < now) runtime.uploads.delete(sessionId);
}
function requireHeader(request, name, maxLength) {
	const value = request.headers[name];
	if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) throw imageVisionError("MISSING_HEADER", `缺少请求头 ${name}。`);
	return value.trim();
}
async function readRawBody(request, maximum) {
	const declared = Number(request.headers["content-length"] ?? 0);
	if (Number.isFinite(declared) && declared > maximum) throw imageVisionError("IMAGE_TOO_LARGE", "图片超过 15 MiB 上限。", 413);
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > maximum) throw imageVisionError("IMAGE_TOO_LARGE", "图片超过 15 MiB 上限。", 413);
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}
async function readJsonBody(request, maximum) {
	const buffer = await readRawBody(request, maximum);
	if (buffer.length === 0) return {};
	try {
		const parsed = JSON.parse(buffer.toString("utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw imageVisionError("INVALID_BODY", "请求正文必须是对象。");
		return parsed;
	} catch (error) {
		const code = typeof error === "object" && error !== null ? error.code : void 0;
		if (code === "INVALID_BODY" || code === "IMAGE_TOO_LARGE") throw error;
		throw imageVisionError("INVALID_BODY", "请求正文不是有效 JSON。");
	}
}
function boundedField(value, maxLength) {
	if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) return "";
	return value.trim();
}
function errorStatus(error) {
	const status = error?.status;
	return typeof status === "number" && status >= 400 && status <= 599 ? status : 500;
}
function errorCode(error, status) {
	const code = error?.code;
	return typeof code === "string" && code !== "" ? code : status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
}
function messageOf(error) {
	return error instanceof Error && error.message.trim() !== "" ? error.message : "请求失败。";
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
//#endregion
export { IMAGE_VISION_API_PREFIX, MAX_ANALYZE_BODY_BYTES, apply, createImageVisionRequestHandler, foundationBundleUrl, inject };
