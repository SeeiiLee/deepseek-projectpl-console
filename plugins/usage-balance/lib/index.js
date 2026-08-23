//#region src/pricing.ts
const PRICING_SOURCE_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
const PRICING_SNAPSHOT_DATE = "2026-08-14";
const PRICING_TABLE_VERSION = "deepseek-v4-2026-08-14-r1";
const CURRENT = {
	CNY: {
		"deepseek-v4-flash": {
			cacheHitPerMillion: .02,
			cacheMissPerMillion: 1,
			outputPerMillion: 2
		},
		"deepseek-v4-pro": {
			cacheHitPerMillion: .025,
			cacheMissPerMillion: 3,
			outputPerMillion: 6
		}
	},
	USD: {
		"deepseek-v4-flash": {
			cacheHitPerMillion: .0028,
			cacheMissPerMillion: .14,
			outputPerMillion: .28
		},
		"deepseek-v4-pro": {
			cacheHitPerMillion: .003625,
			cacheMissPerMillion: .435,
			outputPerMillion: .87
		}
	}
};
/** Deprecated ids are compatibility aliases of V4 Flash in the official table. */
function normalizeDeepSeekModel(model) {
	if (model === "deepseek-v4-flash" || model === "deepseek-chat" || model === "deepseek-reasoner") return "deepseek-v4-flash";
	if (model === "deepseek-v4-pro") return "deepseek-v4-pro";
}
function priceAt(modelId, currency, at) {
	const model = normalizeDeepSeekModel(modelId);
	if (model === void 0 || !Number.isFinite(at)) return void 0;
	return {
		currency,
		model,
		...CURRENT[currency][model],
		version: "deepseek-pricing-2026-08-14-flat",
		effectiveAt: PRICING_SNAPSHOT_DATE,
		period: "flat"
	};
}
function usageBuckets(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const row = value;
	const pick = (key) => {
		const candidate = row[key];
		return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : void 0;
	};
	const uncachedInputTokens = pick("uncachedInputTokens") ?? pick("inputTokens");
	const outputTokens = pick("outputTokens");
	if (uncachedInputTokens === void 0 || outputTokens === void 0) return void 0;
	return {
		uncachedInputTokens,
		outputTokens,
		cacheReadTokens: pick("cacheReadTokens") ?? 0,
		cacheWriteTokens: pick("cacheWriteTokens") ?? 0
	};
}
/** Cache writes are conservatively priced as cache misses; DeepSeek direct usage currently emits none. */
function estimateCost(usage, model, currency, at) {
	const price = priceAt(model, currency, at);
	if (price === void 0) return void 0;
	return {
		amount: ((usage.uncachedInputTokens + usage.cacheWriteTokens) * price.cacheMissPerMillion + usage.cacheReadTokens * price.cacheHitPerMillion + usage.outputTokens * price.outputPerMillion) / 1e6,
		currency,
		price
	};
}
function formatEstimatedMoney(amount, currency) {
	const symbol = currency === "CNY" ? "¥" : "$";
	const digits = amount >= 1 ? 2 : amount >= .01 ? 4 : 6;
	return `${symbol}${amount.toFixed(digits)}`;
}
//#endregion
//#region src/index.ts
const API_PATH = "/__personal/usage-balance";
const BALANCE_ENDPOINT = "https://api.deepseek.com/user/balance";
const KEY_REF = "DEEPSEEK_API_KEY";
const MAX_RESPONSE_BYTES = 64 * 1024;
const inject = ["webServer", "credentials"];
function apply(ctx) {
	const handler = createBalanceRequestHandler({ credentials: ctx.credentials });
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PATH,
		handler
	}), "usage-balance: host-only DeepSeek balance route");
}
/** Focused HTTP seam: the credential is resolved and consumed only inside this Host closure. */
function createBalanceRequestHandler(runtime) {
	let cache;
	return async (request, response) => {
		if (request.headers["x-dsh-personal-client"] !== "1") {
			sendJson(response, 403, {
				ok: false,
				error: {
					code: "PERSONAL_CLIENT_REQUIRED",
					message: "此接口只供个人桌面客户端使用。"
				}
			});
			return;
		}
		const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
		if (parsed.pathname !== API_PATH) {
			sendJson(response, 404, {
				ok: false,
				error: {
					code: "NOT_FOUND",
					message: "余额接口不存在。"
				}
			});
			return;
		}
		if (request.method !== "GET") {
			sendJson(response, 405, {
				ok: false,
				error: {
					code: "METHOD_NOT_ALLOWED",
					message: "余额接口只支持读取。"
				}
			});
			return;
		}
		const now = runtime.now?.() ?? Date.now();
		if (!(parsed.searchParams.get("refresh") === "1") && cache !== void 0 && cache.expiresAt > now) {
			sendJson(response, 200, {
				ok: true,
				data: cache.value
			});
			return;
		}
		const value = await queryOfficialBalance(runtime, now);
		cache = {
			expiresAt: now + 15e3,
			value
		};
		sendJson(response, 200, {
			ok: true,
			data: value
		});
	};
}
async function queryOfficialBalance(runtime, now) {
	const checkedAt = new Date(now).toISOString();
	let resolved;
	try {
		resolved = await runtime.credentials.resolve(KEY_REF);
	} catch {
		return {
			status: "unavailable",
			checkedAt
		};
	}
	if (resolved === void 0) return {
		status: "unconfigured",
		checkedAt
	};
	const key = resolved.value.trim();
	if (key === "" || key.length > 65536 || /[^\x20-\x7E]/u.test(key)) return {
		status: "authentication-failed",
		checkedAt
	};
	let upstream;
	try {
		upstream = await (runtime.fetcher ?? fetch)(BALANCE_ENDPOINT, {
			method: "GET",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${key}`
			},
			redirect: "error",
			signal: AbortSignal.timeout(1e4)
		});
	} catch {
		return {
			status: "unavailable",
			checkedAt
		};
	}
	if (!upstream.ok) {
		if (upstream.status === 401 || upstream.status === 403) return {
			status: "authentication-failed",
			checkedAt
		};
		if (upstream.status === 429) return {
			status: "rate-limited",
			checkedAt
		};
		return {
			status: "unavailable",
			checkedAt
		};
	}
	const declared = Number(upstream.headers.get("content-length") ?? 0);
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return {
		status: "unavailable",
		checkedAt
	};
	let text;
	try {
		text = await upstream.text();
	} catch {
		return {
			status: "unavailable",
			checkedAt
		};
	}
	if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) return {
		status: "unavailable",
		checkedAt
	};
	try {
		const normalized = normalizeBalance(JSON.parse(text));
		return normalized === void 0 ? {
			status: "unavailable",
			checkedAt
		} : {
			...normalized,
			checkedAt
		};
	} catch {
		return {
			status: "unavailable",
			checkedAt
		};
	}
}
function normalizeBalance(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const root = value;
	if (typeof root.is_available !== "boolean" || !Array.isArray(root.balance_infos) || root.balance_infos.length > 4) return;
	const balances = [];
	for (const candidate of root.balance_infos) {
		if (typeof candidate !== "object" || candidate === null) return void 0;
		const row = candidate;
		if (row.currency !== "CNY" && row.currency !== "USD") return void 0;
		const total = decimal(row.total_balance);
		const granted = decimal(row.granted_balance);
		const toppedUp = decimal(row.topped_up_balance);
		if (total === void 0 || granted === void 0 || toppedUp === void 0) return void 0;
		balances.push({
			currency: row.currency,
			total,
			granted,
			toppedUp
		});
	}
	return {
		status: "ready",
		available: root.is_available,
		balances
	};
}
function decimal(value) {
	return typeof value === "string" && value.length <= 64 && /^\d+(?:\.\d+)?$/u.test(value) ? value : void 0;
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
export { PRICING_SNAPSHOT_DATE, PRICING_SOURCE_URL, PRICING_TABLE_VERSION, apply, createBalanceRequestHandler, estimateCost, formatEstimatedMoney, inject, normalizeDeepSeekModel, priceAt, usageBuckets };
