import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { WebError } from "@deepseek-ai/dsh-web";
//#region src/provider.ts
/**
* AnySearch web search provider for the DeepSeek Harness `ctx.web` seam.
*
* AnySearch exposes a JSON-RPC 2.0 endpoint (`tools/call`). Its `search`
* tool returns one or more text blocks; this provider turns that payload into
* the seam's normalized `WebSearchResult` vocabulary. Structured JSON payloads
* and Markdown link lists are both tolerated.
* @module @cyrus/dsh-anysearch/provider
*/
/** Stable id this provider registers under. */
const ANYSEARCH_PROVIDER_ID = "anysearch";
/** Default AnySearch JSON-RPC endpoint. */
const ANYSEARCH_DEFAULT_ENDPOINT = "https://api.anysearch.com/mcp";
/** AnySearch search API accepts 1-10 results. */
const ANYSEARCH_DEFAULT_MAX_RESULTS = 5;
const ANYSEARCH_MAX_RESULTS = 10;
/** Attribution header sent on every request. */
const USER_AGENT = "deepseek-harness-personal/0.1.0-beta";
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyText(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/** Normalize one source candidate. Sources must always have a URL. */
function sourceFromRecord(value) {
	const url = nonEmptyText(value.url ?? value.link ?? value.href);
	if (url === void 0) return void 0;
	const title = nonEmptyText(value.title ?? value.name);
	const snippet = nonEmptyText(value.snippet ?? value.description ?? value.summary ?? value.content);
	const publishedAt = nonEmptyText(value.publishedAt ?? value.date ?? value.page_age);
	return {
		url,
		...title === void 0 ? {} : { title },
		...snippet === void 0 ? {} : { snippet },
		...publishedAt === void 0 ? {} : { publishedAt }
	};
}
/** Pull sources out of a parsed JSON payload when it already looks structured. */
function jsonSources(value) {
	if (Array.isArray(value)) {
		const sources = [];
		for (const entry of value) {
			if (typeof entry === "string") {
				const parsed = tryJson(entry);
				if (isRecord(parsed)) {
					const source = sourceFromRecord(parsed);
					if (source !== void 0) sources.push(source);
				}
				continue;
			}
			if (!isRecord(entry)) continue;
			const source = sourceFromRecord(entry);
			if (source !== void 0) sources.push(source);
			for (const key of [
				"results",
				"sources",
				"data",
				"items"
			]) {
				const nested = jsonSources(entry[key]);
				if (nested !== void 0) sources.push(...nested);
			}
		}
		return sources.length > 0 ? sources : void 0;
	}
	if (!isRecord(value)) return void 0;
	const direct = sourceFromRecord(value);
	const nestedSources = direct === void 0 ? [] : [direct];
	for (const key of [
		"results",
		"sources",
		"data",
		"items"
	]) {
		const nested = jsonSources(value[key]);
		if (nested !== void 0) nestedSources.push(...nested);
	}
	return nestedSources.length > 0 ? nestedSources : void 0;
}
function tryJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return;
	}
}
/** Extract Markdown `[title](url)` links and plain HTTP(S) URLs. */
function markdownSources(text) {
	const sources = [];
	for (const match of text.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gu)) {
		const title = match[1]?.trim();
		const url = match[2];
		if (url === void 0 || url.length === 0) continue;
		const snippet = (text.slice(0, match.index).split(/\r?\n/u).at(-1) ?? "").split(/\s[-—]\s/u).at(-1)?.trim();
		sources.push({
			url,
			...title !== void 0 && title.length > 0 ? { title } : {},
			...snippet !== void 0 && snippet.length > 0 ? { snippet } : {}
		});
	}
	if (sources.length === 0) for (const match of text.matchAll(/https?:\/\/[^\s)\]"']+/gu)) {
		const url = match[0];
		if (url !== void 0) sources.push({ url });
	}
	return dedupeSources(sources);
}
function dedupeSources(sources) {
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const source of sources) {
		if (seen.has(source.url)) continue;
		seen.add(source.url);
		result.push(source);
	}
	return result;
}
/**
* Map an AnySearch text payload to the seam's normalized search result.
* Structured JSON wins; otherwise Markdown links and plain URLs are extracted
* so the model-facing `web_search` result still has citeable sources.
*/
function parseAnySearchText(text) {
	const content = text.trim();
	if (content.length === 0) return {
		content: "",
		sources: [],
		truncated: false
	};
	const parsed = tryJson(content);
	const structured = parsed === void 0 ? void 0 : jsonSources(parsed);
	if (structured !== void 0) {
		let answer;
		if (isRecord(parsed)) answer = nonEmptyText(parsed.answer ?? parsed.content ?? parsed.summary);
		return {
			...answer === void 0 ? {} : { content: answer },
			sources: dedupeSources(structured),
			truncated: false
		};
	}
	return {
		content,
		sources: markdownSources(content),
		truncated: false
	};
}
/** The AnySearch-backed search provider registered into `ctx.web`. */
var AnySearchSearchProvider = class {
	resolveOptions;
	id = ANYSEARCH_PROVIDER_ID;
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}
	available() {
		const options = this.resolveOptions();
		return (options.apiKey !== void 0 && options.apiKey.length > 0 || options.resolveApiKey !== void 0) && URL.canParse(options.endpoint);
	}
	async search(request, signal) {
		const options = this.resolveOptions();
		throwIfAborted(signal);
		const apiKey = await this.resolveApiKey(options, signal);
		throwIfAborted(signal);
		const maxResults = request.maxResults === void 0 ? 5 : Math.min(Math.max(request.maxResults, 1), 10);
		const payload = {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "search",
				arguments: {
					query: request.query,
					max_results: maxResults
				}
			}
		};
		let response;
		try {
			response = await fetch(options.endpoint, {
				method: "POST",
				redirect: "error",
				headers: {
					...apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {},
					"content-type": "application/json",
					"accept": "application/json",
					"user-agent": USER_AGENT
				},
				body: JSON.stringify(payload),
				...signal === void 0 ? {} : { signal }
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error);
			throw new WebError(`AnySearch search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			let detail = "";
			try {
				const body = await response.json();
				const message = body.error === void 0 || typeof body.error === "string" ? body.error : body.error.message;
				if (typeof message === "string") detail = message;
			} catch {}
			const suffix = detail.length > 0 ? `: ${detail}` : "";
			throw new WebError(`AnySearch API error (HTTP ${response.status})${suffix}`, "WEB_PROVIDER_ERROR");
		}
		let data;
		try {
			data = await response.json();
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error);
			throw new WebError(`AnySearch returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		const error = data.error;
		if (error !== void 0) throw new WebError(`AnySearch API error: ${typeof error === "string" ? error : nonEmptyText(error.message) ?? JSON.stringify(error)}`, "WEB_PROVIDER_ERROR");
		const content = data.result?.content;
		if (Array.isArray(content)) return parseAnySearchText(content.map((block) => block.type === "text" && typeof block.text === "string" ? block.text : "").join("\n"));
		return parseAnySearchText(JSON.stringify(data.result ?? data));
	}
	async resolveApiKey(options, signal) {
		throwIfAborted(signal);
		if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
		let resolved;
		try {
			resolved = await options.resolveApiKey?.();
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error);
			throw new WebError(`AnySearch search credential resolution failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (resolved !== void 0 && resolved.length > 0) return resolved;
		throw new WebError(`AnySearch search has no API key for "${options.apiKeyEnv ?? "ANYSEARCH_API_KEY"}"; save it in the AnySearch settings section, export ANYSEARCH_API_KEY in the launching environment, or set a literal "apiKey" in the plugin config`, "WEB_PROVIDER_CREDENTIAL_MISSING");
	}
};
function throwIfAborted(signal) {
	if (signal?.aborted === true) throw aborted(signal);
}
function aborted(_signal, cause) {
	return new WebError("AnySearch search aborted", "WEB_ABORTED", cause === void 0 ? {} : { cause });
}
function isAbortError(error) {
	return error instanceof Error && (error.name === "AbortError" || String(error.message).includes("aborted"));
}
//#endregion
//#region src/index.ts
/** Cordis plugin name used by loader diagnostics. */
const name = "anysearch";
/** The web seam this provider registers into. */
const inject = ["web"];
const DEFAULT_API_KEY_ENV = "ANYSEARCH_API_KEY";
const ENDPOINT_ENV = "ANYSEARCH_ENDPOINT";
const Config = z.object({
	apiKey: z.string().role("secret"),
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	endpoint: z.string()
});
/** Settings namespace carrying this provider's endpoint and key reference. */
const ANYSEARCH_SETTINGS_NAMESPACE = settingsNamespace("anysearch");
function resolveOptions(ctx, config) {
	const apiKeyEnv = credentialRef(config.apiKeyEnv !== void 0 && config.apiKeyEnv.length > 0 ? config.apiKeyEnv : DEFAULT_API_KEY_ENV);
	const literalApiKey = config.apiKey !== void 0 && config.apiKey.length > 0 ? config.apiKey : void 0;
	return {
		...literalApiKey === void 0 ? {} : { apiKey: literalApiKey },
		resolveApiKey: async () => {
			const credentials = ctx.get("credentials");
			if (credentials !== void 0) return (await credentials.resolve(apiKeyEnv))?.value;
			const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
			return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
		},
		apiKeyEnv,
		endpoint: config.endpoint ?? launchEnvironmentOf(ctx).get(ENDPOINT_ENV)?.value ?? "https://api.anysearch.com/mcp"
	};
}
/** Register the AnySearch search provider with `ctx.web`. */
function apply(ctx, config) {
	let current = () => config;
	installSettingsSection(ctx, ANYSEARCH_SETTINGS_NAMESPACE, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
	ctx.web.registerSearchProvider(new AnySearchSearchProvider(() => resolveOptions(ctx, current())));
}
//#endregion
export { ANYSEARCH_DEFAULT_ENDPOINT, ANYSEARCH_DEFAULT_MAX_RESULTS, ANYSEARCH_MAX_RESULTS, ANYSEARCH_PROVIDER_ID, ANYSEARCH_SETTINGS_NAMESPACE, AnySearchSearchProvider, Config, apply, inject, name, parseAnySearchText };
