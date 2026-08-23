import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
//#region src/store.ts
const DEFAULT_THEME = Object.freeze({
	fontFamily: "Inter, \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif",
	baseFontSize: 14,
	zoom: 1,
	accentColor: "#4d6bfe",
	backgroundColor: "#f7f8fa",
	sidebarColor: "#f1f2f5",
	textColor: "#171719",
	panelOpacity: .96
});
function normalizeDocument(value) {
	const source = record(value);
	return {
		version: 1,
		theme: normalizeTheme(source.theme),
		skillMetadata: normalizeMetadataMap(source.skillMetadata),
		pluginMetadata: normalizeMetadataMap(source.pluginMetadata),
		connections: Array.isArray(source.connections) ? source.connections.map(normalizeStoredConnection).filter((item) => item !== void 0) : []
	};
}
var PersonalStore = class {
	filename;
	document;
	operations = Promise.resolve();
	constructor(filename) {
		this.filename = filename;
	}
	async read() {
		if (this.document !== void 0) return structuredClone(this.document);
		let parsed;
		try {
			parsed = JSON.parse(await readFile(this.filename, "utf8"));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			parsed = void 0;
		}
		this.document = normalizeDocument(parsed);
		return structuredClone(this.document);
	}
	mutate(operation) {
		let resolveResult;
		let rejectResult;
		const result = new Promise((resolve, reject) => {
			resolveResult = resolve;
			rejectResult = reject;
		});
		const task = this.operations.then(async () => {
			try {
				const draft = await this.read();
				const value = await operation(draft);
				const normalized = normalizeDocument(draft);
				await writeJsonAtomic(this.filename, normalized);
				this.document = normalized;
				resolveResult(value);
			} catch (error) {
				rejectResult(error);
			}
		});
		this.operations = task.catch(() => {});
		return result;
	}
};
async function writeJsonAtomic(filename, value) {
	await mkdir(dirname(filename), { recursive: true });
	const temporary = join(dirname(filename), `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
	await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: "utf8",
		mode: 384
	});
	await rename(temporary, filename);
}
function normalizeTheme(value) {
	const source = record(value);
	const global = normalizeThemeConfig(source.global, DEFAULT_THEME);
	const workspaces = {};
	for (const [key, config] of Object.entries(record(source.workspaces))) {
		const normalizedKey = key.trim().replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US");
		if (normalizedKey !== "") workspaces[normalizedKey] = normalizeThemeConfig(config, global);
	}
	return {
		version: 1,
		global,
		workspaces
	};
}
function normalizeThemeConfig(value, fallback) {
	const source = record(value);
	return {
		fontFamily: boundedText(source.fontFamily, fallback.fontFamily, 200),
		baseFontSize: boundedNumber(source.baseFontSize, fallback.baseFontSize, 12, 22),
		zoom: boundedNumber(source.zoom, fallback.zoom, .75, 1.5),
		accentColor: color(source.accentColor, fallback.accentColor),
		backgroundColor: color(source.backgroundColor, fallback.backgroundColor),
		sidebarColor: color(source.sidebarColor, fallback.sidebarColor),
		textColor: color(source.textColor, fallback.textColor),
		panelOpacity: boundedNumber(source.panelOpacity, fallback.panelOpacity, .35, 1)
	};
}
function normalizeMetadataMap(value) {
	const output = {};
	for (const [key, metadata] of Object.entries(record(value))) {
		const row = record(metadata);
		if (key.length > 300) continue;
		output[key] = {
			category: boundedText(row.category, "未分类", 80),
			description: boundedText(row.description, "暂无简介", 300)
		};
	}
	return output;
}
function normalizeStoredConnection(value) {
	const row = record(value);
	const kind = connectionKind(row.kind);
	const id = boundedText(row.id, "", 80);
	if (kind === void 0 || id === "") return void 0;
	const transport = row.mcpTransport === "stdio" ? "stdio" : "streamable-http";
	return {
		id,
		label: boundedText(row.label, "未命名连接", 100),
		kind,
		enabled: row.enabled === true,
		...kind === "mcp" ? { mcpTransport: transport } : {},
		endpointDisplay: boundedText(row.endpointDisplay, "已保存（不回显）", 200),
		endpointRef: boundedText(row.endpointRef, credentialRefFor(id, "ENDPOINT"), 120),
		secretRef: boundedText(row.secretRef, credentialRefFor(id, "SECRET"), 120),
		createdAt: isoText(row.createdAt),
		updatedAt: isoText(row.updatedAt)
	};
}
function credentialRefFor(id, suffix) {
	return `DSH_PERSONAL_CONNECTION_${id.replace(/[^a-z0-9]/giu, "_").toUpperCase()}_${suffix}`;
}
function connectionKind(value) {
	return value === "feishu-bot" || value === "wechat-work-bot" || value === "webhook" || value === "mcp" || value === "model" || value === "memory-extraction" || value === "personal-wechat" ? value : void 0;
}
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function boundedText(value, fallback, maxLength) {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim();
	return normalized === "" ? fallback : normalized.slice(0, maxLength);
}
function boundedNumber(value, fallback, min, max) {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function color(value, fallback) {
	return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value) ? value.toLowerCase() : fallback;
}
function isoText(value) {
	if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
	return (/* @__PURE__ */ new Date()).toISOString();
}
//#endregion
//#region src/skills.ts
async function listSkills(dshHome, agentsHome, metadata) {
	const roots = [{
		root: join(dshHome, "skills"),
		source: "个人 DSH 资料库",
		managed: true
	}, {
		root: join(agentsHome, "skills"),
		source: "共享 Agent 资料库",
		managed: false
	}];
	return (await Promise.all(roots.map((root) => scanRoot(root.root, root.source, root.managed)))).flat().map((item) => ({
		...item,
		category: metadata[item.id]?.category ?? "未分类",
		description: metadata[item.id]?.description ?? item.description,
		canEdit: true
	})).sort((left, right) => left.name.localeCompare(right.name, "en"));
}
async function createSkill(dshHome, input, document) {
	const name = skillName(input.name);
	const description = boundedText(input.description, "", 300);
	if (description === "") throw apiError("INVALID_SKILL", "一句话简介不能为空。");
	const category = boundedText(input.category, "未分类", 80);
	const content = typeof input.content === "string" ? input.content.trim().slice(0, 2e5) : "";
	const skillsRoot = join(dshHome, "skills");
	const directory = join(skillsRoot, name);
	const filename = join(directory, "SKILL.md");
	try {
		await lstat(directory);
		throw apiError("SKILL_EXISTS", `Skill“${name}”已经存在。`);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	await mkdir(skillsRoot, { recursive: true });
	await mkdir(directory, { recursive: false });
	const body = content || `# ${name}\n\n请在这里编写 Skill 指令。`;
	await writeFile(filename, [
		"---",
		`name: ${JSON.stringify(name)}`,
		`description: ${JSON.stringify(description)}`,
		"---",
		"",
		body,
		""
	].join("\n"), {
		encoding: "utf8",
		flag: "wx"
	});
	const id = `user-dsh:${name}`;
	document.skillMetadata[id] = {
		category,
		description
	};
	return {
		id,
		name,
		category,
		description,
		source: "个人 DSH 资料库",
		canDelete: true,
		canEdit: true,
		path: filename
	};
}
async function updateSkillMetadata(dshHome, agentsHome, input, document) {
	const id = boundedText(input.id, "", 300);
	const current = (await listSkills(dshHome, agentsHome, document.skillMetadata)).find((item) => item.id === id);
	if (current === void 0) throw apiError("SKILL_NOT_FOUND", "要整理的 Skill 不存在。");
	const description = boundedText(input.description, "", 300);
	if (description === "") throw apiError("INVALID_SKILL", "一句话简介不能为空。");
	const category = boundedText(input.category, "未分类", 80);
	document.skillMetadata[id] = {
		category,
		description
	};
	return {
		...current,
		category,
		description
	};
}
async function trashSkill(dshHome, agentsHome, input, document) {
	const id = boundedText(input.id, "", 300);
	const suppliedName = boundedText(input.name, "", 100);
	const current = (await listSkills(dshHome, agentsHome, document.skillMetadata)).find((item) => item.id === id);
	if (current === void 0) throw apiError("SKILL_NOT_FOUND", "要删除的 Skill 不存在。");
	if (!current.canDelete) throw apiError("SKILL_READ_ONLY", "这个 Skill 不属于个人 DSH 资料库，不能在这里删除。");
	if (suppliedName !== current.name) throw apiError("CONFIRMATION_MISMATCH", "删除确认名称与 Skill 不一致。");
	const skillsRoot = resolve(dshHome, "skills");
	const target = resolve(current.path);
	assertContained(skillsRoot, target);
	if ((await lstat(target)).isSymbolicLink()) throw apiError("SKILL_READ_ONLY", "符号链接 Skill 不支持在这里删除。");
	const source = basename(target).toLowerCase() === "skill.md" ? dirname(target) : target;
	assertContained(skillsRoot, source);
	const trashRoot = join(dshHome, "personal", "trash", "skills");
	await mkdir(trashRoot, { recursive: true });
	const destination = join(trashRoot, `${safeTimestamp()}-${current.name}`);
	await rename(source, destination);
	delete document.skillMetadata[id];
	return { trashed: destination };
}
async function scanRoot(root, source, managed) {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	const result = [];
	for (const entry of entries) {
		if (entry.name === ".system") continue;
		const full = join(root, entry.name);
		const filename = entry.isDirectory() ? join(full, "SKILL.md") : entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? full : void 0;
		if (filename === void 0) continue;
		let raw;
		let stat;
		try {
			[raw, stat] = await Promise.all([readFile(filename, "utf8"), lstat(full)]);
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		const frontmatter = parseFrontmatter(raw);
		const fallbackName = entry.isDirectory() ? entry.name : entry.name.slice(0, -3);
		const name = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(frontmatter.name) ? frontmatter.name : fallbackName;
		const prefix = managed ? "user-dsh" : "user-agents";
		result.push({
			id: `${prefix}:${name}`,
			name,
			description: frontmatter.description || "暂无简介",
			source,
			path: filename,
			canDelete: managed && !stat.isSymbolicLink()
		});
	}
	return result;
}
function parseFrontmatter(raw) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
	if (match === null) return {
		name: "",
		description: ""
	};
	const fields = {};
	for (const line of (match[1] ?? "").split(/\r?\n/u)) {
		const field = /^([a-zA-Z][\w-]*):\s*(.*)$/u.exec(line);
		if (field === null) continue;
		fields[field[1] ?? ""] = yamlScalar(field[2] ?? "");
	}
	return {
		name: fields.name ?? "",
		description: fields.description ?? ""
	};
}
function yamlScalar(value) {
	const trimmed = value.trim();
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) try {
		return String(JSON.parse(trimmed));
	} catch {
		return trimmed.slice(1, -1);
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
	return trimmed;
}
function skillName(value) {
	if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) throw apiError("INVALID_SKILL_NAME", "Skill 名称必须是小写 kebab-case，例如 weekly-review。");
	return value;
}
function assertContained(root, target) {
	const path = relative(resolve(root), resolve(target));
	if (path === "" || !path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep)) return;
	throw apiError("UNSAFE_PATH", "Skill 路径超出了个人资料库。");
}
function safeTimestamp() {
	return (/* @__PURE__ */ new Date()).toISOString().replaceAll(":", "-").replaceAll(".", "-");
}
function apiError(code, message, status = 400) {
	return Object.assign(new Error(message), {
		code,
		status
	});
}
//#endregion
//#region src/index.ts
const API_PREFIX = "/__personal/api";
const MAX_BODY_BYTES = 1048576;
/** Host services used by the private personal-data API. */
const inject = [
	"webServer",
	"loader",
	"credentials"
];
/** Register one loopback-only API surface shared by all personal Client plugins. */
function apply(ctx) {
	const dshHome = resolve(process.env.DSH_HOME || join(homedir(), ".dsh"));
	const agentsHome = resolve(process.env.DSH_AGENTS_HOME || join(homedir(), ".agents"));
	const handler = createPersonalRequestHandler({
		store: new PersonalStore(join(dshHome, "personal", "personal-suite.json")),
		dshHome,
		agentsHome,
		loader: ctx.loader,
		credentials: ctx.credentials,
		packageRequire: createRequire(join(dshHome, "profiles", "web", "package.json"))
	});
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler
	}), "personal API route");
}
/** Exported for focused HTTP contract tests without starting the full Harness. */
function createPersonalRequestHandler(runtime) {
	return async (request, response) => {
		try {
			if (request.headers["x-dsh-personal-client"] !== "1") throw apiError("PERSONAL_CLIENT_REQUIRED", "此接口只供个人桌面客户端使用。", 403);
			const resource = new URL(request.url ?? "/", "http://127.0.0.1").pathname.slice(15);
			const method = request.method ?? "GET";
			sendJson(response, 200, {
				ok: true,
				data: await dispatch(runtime, resource, method, method === "GET" ? {} : record(await readJsonBody(request)))
			});
		} catch (error) {
			const status = errorStatus(error);
			const message = status >= 500 ? "个人功能请求失败。" : errorMessage(error);
			sendJson(response, status, {
				ok: false,
				error: {
					code: errorCode(error, status),
					message
				}
			});
		}
	};
}
async function dispatch(runtime, resource, method, body) {
	switch (resource) {
		case "/theme": return themeResource(runtime, method, body);
		case "/skills": return skillsResource(runtime, method, body);
		case "/plugins": return pluginsResource(runtime, method, body);
		case "/connections": return connectionsResource(runtime, method, body);
		default: throw apiError("NOT_FOUND", "个人功能接口不存在。", 404);
	}
}
async function themeResource(runtime, method, body) {
	if (method === "GET") return (await runtime.store.read()).theme;
	if (method === "PUT") return runtime.store.mutate((document) => {
		document.theme = normalizeDocument({ theme: body }).theme;
		return document.theme;
	});
	throw methodNotAllowed();
}
async function skillsResource(runtime, method, body) {
	if (method === "GET") {
		const document = await runtime.store.read();
		return { skills: await listSkills(runtime.dshHome, runtime.agentsHome, document.skillMetadata) };
	}
	if (method === "POST") return runtime.store.mutate((document) => createSkill(runtime.dshHome, body, document));
	if (method === "PUT") return runtime.store.mutate((document) => updateSkillMetadata(runtime.dshHome, runtime.agentsHome, body, document));
	if (method === "DELETE") return runtime.store.mutate((document) => trashSkill(runtime.dshHome, runtime.agentsHome, body, document));
	throw methodNotAllowed();
}
async function pluginsResource(runtime, method, body) {
	if (method === "GET") return { plugins: pluginItems(runtime, await runtime.store.read()) };
	if (method === "PUT") {
		const id = boundedText(body.id, "", 300);
		if ([...runtime.loader.entries()].find((entry) => !entry.options.group && entry.id === id) === void 0) throw apiError("PLUGIN_NOT_FOUND", "要整理的插件当前不在 Loader 清单中。", 404);
		const category = boundedText(body.category, "", 80);
		const description = boundedText(body.description, "", 300);
		if (category === "" || description === "") throw apiError("INVALID_PLUGIN_METADATA", "分类和一句话简介不能为空。");
		await runtime.store.mutate((document) => {
			document.pluginMetadata[id] = {
				category,
				description
			};
		});
		return pluginItems(runtime, await runtime.store.read()).find((item) => item.id === id);
	}
	throw methodNotAllowed();
}
function pluginItems(runtime, document) {
	const items = [];
	for (const entry of runtime.loader.entries()) {
		if (entry.options.group) continue;
		const packageName = typeof entry.options.name === "string" ? entry.options.name : "(unknown package)";
		const custom = document.pluginMetadata[entry.id];
		const manifestDescription = packageDescription(runtime.packageRequire, packageName);
		items.push({
			id: entry.id,
			entryId: entry.id,
			packageName,
			category: custom?.category ?? defaultPluginCategory(packageName),
			categoryCustomized: custom !== void 0,
			description: custom?.description ?? manifestDescription ?? defaultPluginDescription(packageName),
			descriptionCustomized: custom !== void 0,
			enabled: !entry.disabled,
			fiberPhase: entry.fiber === void 0 ? null : fiberPhase(entry.fiber.state),
			canEdit: true
		});
	}
	return items;
}
async function connectionsResource(runtime, method, body) {
	if (method === "GET") {
		const document = await runtime.store.read();
		return { connections: await Promise.all(document.connections.map((item) => connectionItem(runtime.credentials, item))) };
	}
	if (method === "POST") return createConnection(runtime, body);
	if (method === "PUT") return updateConnection(runtime, body);
	if (method === "DELETE") return deleteConnection(runtime, body);
	throw methodNotAllowed();
}
async function createConnection(runtime, body) {
	const kind = requiredConnectionKind(body.kind);
	const label = requiredText(body.label, "连接名称", 100);
	const transport = connectionTransport(kind, body.mcpTransport);
	const endpoint = requiredEndpoint(kind, transport, body.endpoint);
	const secret = optionalSecret(body.secret);
	const id = randomUUID().replaceAll("-", "");
	const endpointRef = credentialRefFor(id, "ENDPOINT");
	const secretRef = credentialRefFor(id, "SECRET");
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const stored = {
		id,
		label,
		kind,
		enabled: body.enabled === true,
		...kind === "mcp" ? { mcpTransport: transport } : {},
		endpointDisplay: endpointDisplay(kind, transport),
		endpointRef,
		secretRef,
		createdAt: now,
		updatedAt: now
	};
	await setCredential(runtime.credentials, endpointRef, endpoint);
	try {
		if (secret !== void 0) await setCredential(runtime.credentials, secretRef, secret);
		await runtime.store.mutate((document) => {
			document.connections.push(stored);
		});
	} catch (error) {
		await Promise.allSettled([runtime.credentials.unset(endpointRef), ...secret === void 0 ? [] : [runtime.credentials.unset(secretRef)]]);
		throw error;
	}
	return connectionItem(runtime.credentials, stored);
}
async function updateConnection(runtime, body) {
	const id = boundedText(body.id, "", 80);
	const current = (await runtime.store.read()).connections.find((item) => item.id === id);
	if (current === void 0) throw apiError("CONNECTION_NOT_FOUND", "要更新的连接配置不存在。", 404);
	const kind = body.kind === void 0 ? current.kind : requiredConnectionKind(body.kind);
	const transport = connectionTransport(kind, body.mcpTransport ?? current.mcpTransport);
	const endpointChanged = typeof body.endpoint === "string" && body.endpoint.trim() !== "";
	const transportChanged = kind === "mcp" && transport !== (current.mcpTransport ?? "streamable-http");
	if ((kind !== current.kind || transportChanged) && !endpointChanged) throw apiError("CONNECTION_TARGET_REQUIRED", "更改连接类型或传输方式时必须填写新的目标。");
	if (endpointChanged) await setCredential(runtime.credentials, current.endpointRef, requiredEndpoint(kind, transport, body.endpoint));
	const secret = optionalSecret(body.secret);
	if (secret !== void 0) await setCredential(runtime.credentials, current.secretRef, secret);
	const updated = await runtime.store.mutate((draft) => {
		const index = draft.connections.findIndex((item) => item.id === id);
		if (index < 0) throw apiError("CONNECTION_NOT_FOUND", "要更新的连接配置不存在。", 404);
		const next = {
			...draft.connections[index],
			label: body.label === void 0 ? current.label : requiredText(body.label, "连接名称", 100),
			kind,
			enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
			endpointDisplay: endpointDisplay(kind, transport),
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		if (kind === "mcp") next.mcpTransport = transport;
		else delete next.mcpTransport;
		draft.connections[index] = next;
		return next;
	});
	return connectionItem(runtime.credentials, updated);
}
async function deleteConnection(runtime, body) {
	const id = boundedText(body.id, "", 80);
	const current = (await runtime.store.read()).connections.find((item) => item.id === id);
	if (current === void 0) throw apiError("CONNECTION_NOT_FOUND", "要删除的连接配置不存在。", 404);
	await Promise.all([unsetCredential(runtime.credentials, current.endpointRef), unsetCredential(runtime.credentials, current.secretRef)]);
	await runtime.store.mutate((draft) => {
		draft.connections = draft.connections.filter((item) => item.id !== id);
	});
	return { deleted: id };
}
async function connectionItem(credentials, stored) {
	const [endpoint, secret] = await Promise.all([describeCredential(credentials, stored.endpointRef), describeCredential(credentials, stored.secretRef)]);
	return {
		id: stored.id,
		label: stored.label,
		kind: stored.kind,
		enabled: stored.enabled,
		endpointDisplay: stored.endpointDisplay,
		endpointConfigured: endpoint.configured,
		secretConfigured: secret.configured,
		...stored.kind === "mcp" ? { mcpTransport: stored.mcpTransport ?? "streamable-http" } : {},
		canEdit: endpoint.writable && secret.writable,
		canDelete: endpoint.writable && secret.writable
	};
}
async function readJsonBody(request) {
	const declared = Number(request.headers["content-length"] ?? 0);
	if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw apiError("BODY_TOO_LARGE", "请求内容过大。", 413);
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_BODY_BYTES) throw apiError("BODY_TOO_LARGE", "请求内容过大。", 413);
		chunks.push(buffer);
	}
	if (size === 0) return {};
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw apiError("INVALID_JSON", "请求不是有效的 JSON。");
	}
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
function requiredConnectionKind(value) {
	const kind = connectionKind(value);
	if (kind === void 0) throw apiError("INVALID_CONNECTION_KIND", "不支持这种连接类型。");
	return kind;
}
function connectionTransport(kind, value) {
	if (kind !== "mcp") return "streamable-http";
	return value === "stdio" ? "stdio" : "streamable-http";
}
function requiredEndpoint(kind, transport, value) {
	const endpoint = requiredText(value, transport === "stdio" ? "启动命令" : "连接 URL", 4096);
	if (kind === "mcp" && transport === "stdio") {
		if (/\r|\n/u.test(endpoint)) throw apiError("INVALID_CONNECTION_TARGET", "stdio 启动命令必须是单行。");
		return endpoint;
	}
	try {
		const url = new URL(endpoint);
		if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
	} catch {
		throw apiError("INVALID_CONNECTION_TARGET", "连接目标必须是有效的 HTTP 或 HTTPS URL。");
	}
	return endpoint;
}
function optionalSecret(value) {
	if (value === void 0 || value === "") return void 0;
	if (typeof value !== "string" || value.length > 65536 || value.trim() === "") throw apiError("INVALID_CONNECTION_SECRET", "密钥格式无效。");
	return value;
}
function requiredText(value, label, maxLength) {
	const result = boundedText(value, "", maxLength);
	if (result === "") throw apiError("REQUIRED_FIELD", `${label}不能为空。`);
	return result;
}
function endpointDisplay(kind, transport) {
	if (kind === "feishu-bot") return "飞书 Webhook 已保存（不回显）";
	if (kind === "wechat-work-bot") return "企业微信 Webhook 已保存（不回显）";
	if (kind === "mcp" && transport === "stdio") return "stdio 启动命令已保存（不回显）";
	if (kind === "mcp") return "MCP URL 已保存（不回显）";
	if (kind === "model") return "模型 API 地址已保存（不回显）";
	return "Webhook 目标已保存（不回显）";
}
async function setCredential(credentials, reference, value) {
	try {
		await credentials.set(reference, value);
	} catch {
		throw apiError("CREDENTIAL_WRITE_FAILED", "凭据无法写入；请检查是否被只读环境变量覆盖。", 409);
	}
}
async function unsetCredential(credentials, reference) {
	try {
		await credentials.unset(reference);
	} catch {
		throw apiError("CREDENTIAL_DELETE_FAILED", "凭据无法删除；请检查是否被只读环境变量覆盖。", 409);
	}
}
async function describeCredential(credentials, reference) {
	try {
		return await credentials.describe(reference);
	} catch {
		throw apiError("CREDENTIAL_STATUS_FAILED", "无法读取凭据配置状态。", 500);
	}
}
function packageDescription(packageRequire, packageName) {
	try {
		const manifest = packageRequire(`${packageName}/package.json`);
		if (typeof manifest.description !== "string") return void 0;
		const description = manifest.description.trim().replace(/\s+/gu, " ");
		return description === "" ? void 0 : description.slice(0, 300);
	} catch {
		return;
	}
}
function defaultPluginCategory(packageName) {
	if (packageName.startsWith("@cyrus/")) return "个人扩展";
	if (packageName.startsWith("@deepseek-ai/")) return "Harness 官方";
	return "第三方插件";
}
function defaultPluginDescription(packageName) {
	if (packageName.startsWith("@cyrus/")) return "个人桌面环境的扩展组件。";
	if (packageName.startsWith("@deepseek-ai/")) return "DeepSeek Harness 随附的官方组件。";
	return "由当前 Harness 配置加载的第三方组件。";
}
function fiberPhase(state) {
	return [
		"pending",
		"loading",
		"active",
		"failed",
		null,
		"unloading"
	][state] ?? null;
}
function methodNotAllowed() {
	return apiError("METHOD_NOT_ALLOWED", "此接口不支持该请求方法。", 405);
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
	return error instanceof Error && error.message !== "" ? error.message : "请求失败。";
}
//#endregion
export { PersonalStore, apply, createPersonalRequestHandler, inject };
