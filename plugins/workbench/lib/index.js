import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
//#region src/browser-probe.ts
/** 提取 CSP 的 frame-ancestors 源列表；指令缺失/为空返回 undefined。 */
function extractFrameAncestors(csp) {
	if (csp === null) return void 0;
	for (const directive of csp.split(";")) {
		const parts = directive.trim().split(/\s+/);
		if (parts[0] === "frame-ancestors") {
			const sources = parts.slice(1).filter((source) => source !== "");
			return sources.length === 0 ? void 0 : sources;
		}
	}
}
/** X-Frame-Options 是否拒绝嵌入（DENY / SAMEORIGIN 对我们都是拒绝）。 */
function xfoBlocks(xfo) {
	if (xfo === null) return false;
	const value = xfo.trim().toLowerCase();
	return value === "deny" || value === "sameorigin";
}
/**
* frame-ancestors 是否拒绝嵌入：'none' 总是拒绝；'self'/具体源列表
* 对第三方嵌入者（我们）同样拒绝；只有 * 允许任意嵌入。
*/
function frameAncestorsBlock(csp) {
	const sources = extractFrameAncestors(csp);
	if (sources === void 0) return false;
	return !sources.includes("*");
}
function embeddabilityOf(probe) {
	if (probe.status === void 0) return "unknown";
	if (xfoBlocks(probe.xFrameOptions ?? null)) return "blocked";
	if (frameAncestorsBlock(probe.contentSecurityPolicy ?? null)) return "blocked";
	return "ok";
}
//#endregion
//#region src/workspace-remote.ts
const WORKSPACE_API_PREFIX = "/__personal/workspace";
const MAX_TEXT_BYTES = 262144;
const MAX_BLOB_BYTES = 5 * 1024 * 1024;
const MAX_TREE_ENTRIES = 200;
const IGNORED_DIRECTORIES = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	"dist",
	"build",
	"out",
	"target",
	"coverage",
	".next",
	"artifacts",
	".cache",
	"cache",
	"__pycache__",
	".pnpm-store",
	".yarn",
	"tmp",
	"$recycle.bin",
	"lib",
	"分发包"
]);
const TEXT_EXTENSIONS = new Set([
	".md",
	".markdown",
	".mdx",
	".txt",
	".rst",
	".json",
	".jsonc",
	".yml",
	".yaml",
	".toml",
	".ini",
	".cfg",
	".env",
	".gitignore",
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".css",
	".html",
	".htm",
	".xml",
	".csv",
	".log",
	".sql",
	".sh",
	".ps1",
	".bat",
	".cmd",
	".py",
	".rs",
	".go",
	".java",
	".c",
	".h",
	".cpp",
	".hpp",
	".cs",
	".rb",
	".php",
	".swift",
	".kt",
	".vue",
	".svelte",
	".scss",
	".less"
]);
function workspaceError(code, message, status = 400) {
	return Object.assign(new Error(message), {
		code,
		status,
		expose: true
	});
}
function resolveWorkspaceRoot() {
	const configured = process.env.DSH_WORKSPACE_ROOT?.trim();
	if (configured !== void 0 && configured !== "") return resolve(configured);
	return process.cwd();
}
async function resolveInside(root, relativePath) {
	if (typeof relativePath !== "string" || relativePath.length > 2048) throw workspaceError("PATH_INVALID", "工作区路径无效。");
	if (relativePath.includes("\0") || relativePath.startsWith("/") || relativePath.startsWith("\\")) throw workspaceError("PATH_INVALID", "工作区路径无效。");
	const absolute = resolve(root, relativePath);
	if (!(absolute === root || absolute.startsWith(root + sep))) throw workspaceError("PATH_OUTSIDE_WORKSPACE", "路径超出工作区。", 403);
	const realRoot = await realpath(root);
	const real = await realpath(absolute).catch(() => null);
	if (real !== null && real !== realRoot && !real.startsWith(realRoot + sep)) throw workspaceError("SYMLINK_ESCAPE", "路径通过符号链接逃出了工作区。", 403);
	return absolute;
}
function sha256(buffer) {
	return "sha256:" + createHash("sha256").update(buffer).digest("hex");
}
function mimeFor(relativePath) {
	switch (relativePath.slice(relativePath.lastIndexOf(".")).toLowerCase()) {
		case ".png": return "image/png";
		case ".jpg":
		case ".jpeg": return "image/jpeg";
		case ".webp": return "image/webp";
		case ".gif": return "image/gif";
		case ".svg": return "image/svg+xml";
		case ".pdf": return "application/pdf";
		case ".txt":
		case ".md":
		case ".log": return "text/plain; charset=utf-8";
		default: return "application/octet-stream";
	}
}
/** Standalone loopback handler; the workspace root is fixed at construction. */
function createWorkspaceRequestHandler(root = resolveWorkspaceRoot()) {
	return async (request, response) => {
		try {
			if (request.headers["x-dsh-personal-workspace"] !== "1") throw workspaceError("WORKSPACE_CLIENT_REQUIRED", "此接口只供个人桌面工作台使用。", 403);
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (!url.pathname.startsWith("/__personal/workspace")) throw workspaceError("NOT_FOUND", "工作区接口不存在。", 404);
			const resource = url.pathname.slice(21);
			const method = request.method ?? "GET";
			const requestedRoot = url.searchParams.get("root");
			const effectiveRoot = requestedRoot === null || requestedRoot === "" ? root : resolve(requestedRoot);
			if (effectiveRoot !== root) {
				const rootInfo = await stat(effectiveRoot).catch(() => null);
				if (rootInfo === null || !rootInfo.isDirectory()) throw workspaceError("ROOT_INVALID", "工作区根无效。", 400);
			}
			if (resource === "/status" && method === "GET") {
				sendJson(response, 200, {
					ok: true,
					data: { workspaceRoot: await realpath(effectiveRoot) }
				});
				return;
			}
			if (resource === "/search" && method === "GET") {
				const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
				if (query === "" || query.length > 200) throw workspaceError("INVALID_QUERY", "搜索词无效。", 400);
				const results = await searchWorkspaceFiles(effectiveRoot, query);
				sendJson(response, 200, {
					ok: true,
					data: {
						results,
						truncated: results.length >= 100
					}
				});
				return;
			}
			if (resource === "/browser-probe" && method === "GET") {
				sendJson(response, 200, {
					ok: true,
					data: await probeBrowserUrl(url.searchParams.get("url") ?? "")
				});
				return;
			}
			if (resource === "/tree" && method === "GET") {
				const target = await resolveInside(effectiveRoot, url.searchParams.get("path") ?? "");
				const info = await stat(target).catch(() => null);
				if (info === null || !info.isDirectory()) throw workspaceError("NOT_A_DIRECTORY", "目标不是目录。", 404);
				const names = await readdir(target, { withFileTypes: true });
				sendJson(response, 200, {
					ok: true,
					data: {
						entries: names.filter((entry) => !entry.name.startsWith(".dsh-staging.") && !IGNORED_DIRECTORIES.has(entry.name.toLowerCase())).slice(0, 200).map((entry) => ({
							name: entry.name,
							kind: entry.isDirectory() ? "directory" : "file",
							...entry.isDirectory() ? {} : { byteSize: 0 }
						})).sort((left, right) => {
							if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
							return left.name.localeCompare(right.name, "en");
						}),
						truncated: names.length > 200
					}
				});
				return;
			}
			if (resource === "/file" && method === "GET") {
				const target = await resolveInside(effectiveRoot, url.searchParams.get("path") ?? "");
				const info = await stat(target).catch(() => null);
				if (info === null || !info.isFile()) throw workspaceError("NOT_A_FILE", "目标不是文件。", 404);
				if (info.size > 5242880) {
					sendJson(response, 200, {
						ok: true,
						data: {
							kind: "binary",
							byteSize: info.size,
							tooLarge: true,
							mime: mimeFor(target)
						}
					});
					return;
				}
				const extension = target.slice(target.lastIndexOf(".")).toLowerCase();
				if (!TEXT_EXTENSIONS.has(extension)) {
					sendJson(response, 200, {
						ok: true,
						data: {
							kind: "binary",
							byteSize: info.size,
							mime: mimeFor(target)
						}
					});
					return;
				}
				const buffer = await readFile(target);
				if (buffer.includes(0)) {
					sendJson(response, 200, {
						ok: true,
						data: {
							kind: "binary",
							byteSize: info.size,
							mime: mimeFor(target)
						}
					});
					return;
				}
				const truncated = buffer.length > MAX_TEXT_BYTES;
				sendJson(response, 200, {
					ok: true,
					data: {
						kind: "text",
						content: buffer.subarray(0, MAX_TEXT_BYTES).toString("utf8"),
						truncated,
						byteSize: info.size,
						sha256: sha256(buffer)
					}
				});
				return;
			}
			if (resource === "/blob" && method === "GET") {
				const target = await resolveInside(effectiveRoot, url.searchParams.get("path") ?? "");
				const info = await stat(target).catch(() => null);
				if (info === null || !info.isFile()) throw workspaceError("NOT_A_FILE", "目标不是文件。", 404);
				if (info.size > 5242880) throw workspaceError("BLOB_TOO_LARGE", "文件超过预览上限。", 413);
				response.writeHead(200, {
					"content-type": mimeFor(target),
					"content-length": String(info.size),
					"cache-control": "no-store",
					"x-content-type-options": "nosniff"
				});
				await new Promise((resolveStream, rejectStream) => {
					const stream = createReadStream(target);
					stream.once("error", rejectStream);
					stream.once("end", () => {
						resolveStream();
					});
					stream.pipe(response);
				});
				return;
			}
			if (resource === "/save" && method === "POST") {
				const body = await readJsonBody(request);
				const relativePath = optionalText(body.path, 2048);
				const content = optionalText(body.content, MAX_TEXT_BYTES);
				const expectedSha256 = optionalText(body.expectedSha256, 96);
				if (relativePath === void 0 || content === void 0) throw workspaceError("INVALID_BODY", "保存请求缺少必需字段。");
				const target = await resolveInside(effectiveRoot, relativePath);
				const existing = await readFile(target).catch(() => null);
				if (expectedSha256 !== void 0 && existing !== null && sha256(existing) !== expectedSha256) throw workspaceError("FILE_CHANGED", "文件在你阅读后被修改，保存被拒绝。", 409);
				if (existing === null) {
					if (await realpath(dirname(target)).catch(() => null) === null) throw workspaceError("PARENT_MISSING", "目标目录不存在。", 404);
				}
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, content, "utf8");
				const saved = await readFile(target);
				sendJson(response, 200, {
					ok: true,
					data: {
						path: relativePath,
						sha256: sha256(saved),
						byteSize: saved.length
					}
				});
				return;
			}
			if ([
				"/status",
				"/tree",
				"/file",
				"/blob",
				"/save",
				"/search",
				"/browser-probe"
			].includes(resource)) throw workspaceError("METHOD_NOT_ALLOWED", "此工作区接口不支持该请求方法。", 405);
			throw workspaceError("NOT_FOUND", "工作区接口不存在。", 404);
		} catch (error) {
			const status = typeof error?.status === "number" ? error.status : 500;
			sendJson(response, status, {
				ok: false,
				error: {
					code: errorCode(error, status),
					message: status >= 500 ? "工作区服务请求失败。" : messageOf(error)
				}
			});
		}
	};
}
async function searchWorkspaceFiles(root, query) {
	const results = [];
	const queue = [""];
	while (queue.length > 0 && results.length < 100) {
		const dirPath = queue.shift() ?? "";
		if ((dirPath === "" ? 0 : dirPath.split("/").length) >= 8) continue;
		const target = await resolveInside(root, dirPath);
		const info = await stat(target).catch(() => null);
		if (info === null || !info.isDirectory()) continue;
		const names = await readdir(target, { withFileTypes: true });
		for (const entry of names) {
			if (entry.name.startsWith(".dsh-staging.") || IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
			const child = dirPath === "" ? entry.name : dirPath + "/" + entry.name;
			if (entry.isDirectory()) {
				if (queue.length < 1600) queue.push(child);
			} else if (entry.name.toLowerCase().includes(query)) {
				results.push({
					path: child,
					name: entry.name
				});
				if (results.length >= 100) break;
			}
		}
	}
	return results;
}
async function readJsonBody(request) {
	const declared = Number(request.headers["content-length"] ?? 0);
	if (Number.isFinite(declared) && declared > 270336) throw workspaceError("BODY_TOO_LARGE", "请求内容过大。", 413);
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > 270336) throw workspaceError("BODY_TOO_LARGE", "请求内容过大。", 413);
		chunks.push(buffer);
	}
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw workspaceError("INVALID_BODY", "请求正文必须是对象。");
		return parsed;
	} catch (error) {
		const code = typeof error === "object" && error !== null ? error.code : void 0;
		if (code === "INVALID_BODY" || code === "BODY_TOO_LARGE") throw error;
		throw workspaceError("INVALID_BODY", "请求正文不是有效 JSON。");
	}
}
function optionalText(value, maxLength) {
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength) throw workspaceError("INVALID_BODY", "字段格式无效。");
	return value;
}
function errorCode(error, status) {
	if (typeof error === "object" && error !== null && typeof error.code === "string") return error.code;
	return status >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST";
}
function messageOf(error) {
	return error instanceof Error && error.message.trim() !== "" ? error.message : "请求无效。";
}
const BROWSER_PROBE_TIMEOUT_MS = 5e3;
/**
* Browser 嵌入性探测：HEAD 取响应头（失败回退 GET 立即 abort，只取头），
* 判定逻辑在纯函数 browser-probe.ts（可单测）；这里只做有界网络访问。
* 仅 http(s)、拒绝 loopback —— 与地址栏归一化同源约束。
*/
async function probeBrowserUrl(raw) {
	let parsed;
	try {
		parsed = new URL(raw);
	} catch {
		return {
			embeddable: "unknown",
			reason: "invalid"
		};
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return {
		embeddable: "blocked",
		reason: "scheme"
	};
	const host = parsed.hostname.toLowerCase();
	if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(host)) return {
		embeddable: "blocked",
		reason: "loopback"
	};
	for (const probeMethod of ["HEAD", "GET"]) {
		const controller = new AbortController();
		const timer = setTimeout(() => {
			controller.abort();
		}, BROWSER_PROBE_TIMEOUT_MS);
		try {
			const upstream = await fetch(parsed.toString(), {
				method: probeMethod,
				redirect: "follow",
				signal: controller.signal,
				headers: { "user-agent": "dsh-workbench-browser-probe/1" }
			});
			const verdict = embeddabilityOf({
				status: upstream.status,
				xFrameOptions: upstream.headers.get("x-frame-options"),
				contentSecurityPolicy: upstream.headers.get("content-security-policy")
			});
			controller.abort();
			return {
				embeddable: verdict,
				status: upstream.status
			};
		} catch {} finally {
			clearTimeout(timer);
		}
	}
	return {
		embeddable: "unknown",
		reason: "unreachable"
	};
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
//#region src/index.ts
/** Required Harness services for the P8 workspace remote. */
const inject = ["webServer"];
function apply(ctx) {
	const handler = createWorkspaceRequestHandler(resolveWorkspaceRoot());
	ctx.effect(() => {
		const unregister = ctx.webServer.register({
			kind: "prefix",
			path: WORKSPACE_API_PREFIX,
			handler
		});
		return () => {
			unregister();
		};
	}, "workbench workspace root Host remote");
}
//#endregion
export { MAX_BLOB_BYTES, MAX_TEXT_BYTES, MAX_TREE_ENTRIES, WORKSPACE_API_PREFIX, apply, createWorkspaceRequestHandler, inject, resolveWorkspaceRoot, workspaceError };
