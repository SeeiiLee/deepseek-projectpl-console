window.__ModuleLoader__.load({
	id: "@cyrus/dsh-usage-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/contracts.ts
		function trajectoryOf(snapshot) {
			return snapshot.views.get("trajectory");
		}
		//#endregion
		//#region src/pricing.ts
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
		//#region src/client/bridge.ts
		async function openBillingCenter() {
			const open = window.deepseekHarnessPersonal?.billing?.open;
			if (typeof open !== "function") return {
				ok: false,
				reason: "desktop-bridge-unavailable"
			};
			try {
				const result = await open();
				if (result?.ok === true && (result.mode === "isolated" || result.mode === "external")) return result;
				if (result?.ok === false && typeof result.reason === "string") return result;
				return {
					ok: false,
					reason: "desktop-bridge-invalid-response"
				};
			} catch {
				return {
					ok: false,
					reason: "desktop-bridge-failed"
				};
			}
		}
		//#endregion
		//#region \0dsh-css:D:\Deepseek Harness Personal\plugins\usage-balance\src\client\UsageBalanceControl.module.css.mjs
		const css = ".KjXr8a_root{display:inline-flex;position:relative}.KjXr8a_trigger{border:1px solid var(--dsw-alias-border-l2-darkmode-thin);min-height:26px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:8px;align-items:center;gap:5px;padding:3px 7px;font-size:12px;display:inline-flex}.KjXr8a_trigger:hover,.KjXr8a_trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.KjXr8a_coin{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);width:16px;height:16px;color:var(--dsw-alias-state-business-primary);border-radius:50%;place-items:center;font-weight:700;display:grid}.KjXr8a_panel{z-index:80;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2-darkmode-thin);background:color-mix(in srgb, var(--dsw-specific-input-major) 94%, transparent);width:min(360px,100vw - 24px);max-height:min(560px,100vh - 24px);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);backdrop-filter:blur(18px);border-radius:16px;padding:14px;position:fixed;overflow-y:auto}.KjXr8a_header,.KjXr8a_sectionHeading,.KjXr8a_balanceRow,.KjXr8a_actions{justify-content:space-between;align-items:center;gap:10px;display:flex}.KjXr8a_header>div{gap:2px;display:grid}.KjXr8a_header strong{font-size:15px}.KjXr8a_header span,.KjXr8a_balance small,.KjXr8a_costGrid small,.KjXr8a_actions span,.KjXr8a_panel footer{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.KjXr8a_header button,.KjXr8a_sectionHeading button{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none}.KjXr8a_header button{font-size:20px}.KjXr8a_costGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0;display:grid}.KjXr8a_costGrid>div{background:var(--dsw-alias-interactive-bg-hover);border-radius:10px;gap:4px;min-width:0;padding:10px;display:grid}.KjXr8a_costGrid span,.KjXr8a_sectionHeading{color:var(--dsw-alias-label-secondary);font-size:12px}.KjXr8a_costGrid strong{text-overflow:ellipsis;white-space:nowrap;font-size:14px;overflow:hidden}.KjXr8a_balance{border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2);gap:8px;padding:12px 0;display:grid}.KjXr8a_balance p{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}.KjXr8a_balance p[data-state=ready]{color:var(--dsw-alias-state-success-primary)}.KjXr8a_balance p[data-state=authentication-failed],.KjXr8a_balance p[data-state=unavailable]{color:var(--dsw-alias-state-error-primary)}.KjXr8a_balanceRow{grid-template-columns:38px auto 1fr;display:grid}.KjXr8a_balanceRow small{text-align:right}.KjXr8a_actions{align-items:flex-start;margin-top:12px}.KjXr8a_actions span{text-align:right;flex:1}.KjXr8a_primary{background:var(--dsw-alias-state-business-primary);color:#fff;font:inherit;cursor:pointer;border:none;border-radius:8px;flex:none;padding:6px 10px;font-size:12px}.KjXr8a_panel footer{margin-top:10px}@media (width<=560px){.KjXr8a_costGrid{grid-template-columns:1fr}}";
		const tagId = "@cyrus/dsh-usage-balance/UsageBalanceControl.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-usage-balance";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var UsageBalanceControl_module_css_default = {
			"actions": "KjXr8a_actions",
			"balance": "KjXr8a_balance",
			"balanceRow": "KjXr8a_balanceRow",
			"coin": "KjXr8a_coin",
			"costGrid": "KjXr8a_costGrid",
			"header": "KjXr8a_header",
			"panel": "KjXr8a_panel",
			"primary": "KjXr8a_primary",
			"root": "KjXr8a_root",
			"sectionHeading": "KjXr8a_sectionHeading",
			"trigger": "KjXr8a_trigger"
		};
		//#endregion
		//#region src/client/UsageBalanceControl.tsx
		function currentTurnEstimate(snapshot, pressure, breakdown, currency, now) {
			const trajectory = trajectoryOf(snapshot);
			if (trajectory === void 0) return void 0;
			const assistantRequests = trajectory.requests.filter((request) => request.purpose === "assistant");
			const turns = [
				...snapshot.chat.timeline.turnOrder,
				...assistantRequests.map((request) => request.turn),
				...trajectory.runningCalls.map((call) => call.turn)
			];
			if (turns.length === 0) return void 0;
			const turn = Math.max(...turns);
			const requests = assistantRequests.filter((request) => request.turn === turn);
			let amount = 0;
			let model = "";
			let measured = false;
			let approximate = false;
			for (const request of requests) {
				const config = request.requestConfig ?? request.prompt?.config;
				if (config?.provider !== "deepseek-official") continue;
				model = config.model;
				const usage = usageBuckets(request.usage);
				if (usage !== void 0) {
					const cost = estimateCost(usage, model, currency, request.startedAt);
					if (cost !== void 0) {
						amount += cost.amount;
						measured = true;
					}
					continue;
				}
				if (request.status === "running") {
					const projected = pressure?.projectedTokens ?? pressure?.pressureTokens ?? (breakdown === void 0 ? void 0 : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens);
					if (projected !== void 0) {
						const cost = estimateCost({
							uncachedInputTokens: projected,
							outputTokens: 0,
							cacheReadTokens: 0,
							cacheWriteTokens: 0
						}, model, currency, now);
						if (cost !== void 0) {
							amount += cost.amount;
							measured = true;
							approximate = true;
						}
					}
				}
			}
			return measured && model !== "" ? {
				amount,
				currency,
				model,
				approximate
			} : void 0;
		}
		function sessionEstimate(usage, snapshot, currency, now) {
			if (usage === void 0) return void 0;
			const latest = [...trajectoryOf(snapshot)?.requests ?? []].reverse().find((request) => {
				return (request.requestConfig ?? (request.purpose === "assistant" ? request.prompt?.config : void 0))?.provider === "deepseek-official";
			});
			const config = latest?.requestConfig ?? (latest?.purpose === "assistant" ? latest.prompt?.config : void 0);
			if (config?.provider !== "deepseek-official") return void 0;
			const cost = estimateCost(usage, config.model, currency, now);
			return cost === void 0 ? void 0 : {
				amount: cost.amount,
				currency,
				model: config.model,
				approximate: true
			};
		}
		function balanceCopy(status) {
			switch (status.status) {
				case "idle": return "打开后查询官方余额";
				case "loading": return "正在查询官方余额…";
				case "unconfigured": return "尚未配置 DEEPSEEK_API_KEY";
				case "authentication-failed": return "API Key 无法通过余额鉴权";
				case "rate-limited": return "余额接口请求过于频繁";
				case "unavailable": return "暂时无法查询官方余额";
				case "ready": return status.available ? "官方余额可用" : "官方余额不足";
			}
		}
		function chooseCurrency(balance) {
			if (balance.status === "ready" && balance.balances.some((item) => item.currency === "CNY")) return "CNY";
			if (balance.status === "ready" && balance.balances.some((item) => item.currency === "USD")) return "USD";
			return "CNY";
		}
		function UsageBalanceControl({ useSession, useProjection }) {
			const snapshot = useSession((value) => value);
			const usePersonalProjection = useProjection;
			const usage = usePersonalProjection("tokenUsage");
			const pressure = usePersonalProjection("contextPressure");
			const breakdown = usePersonalProjection("contextBreakdown");
			const [open, setOpen] = (0, react.useState)(false);
			const [balance, setBalance] = (0, react.useState)({ status: "idle" });
			const [notice, setNotice] = (0, react.useState)(null);
			const [now, setNow] = (0, react.useState)(() => Date.now());
			const [panelStyle, setPanelStyle] = (0, react.useState)({
				right: 16,
				bottom: 64
			});
			const triggerRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const currency = chooseCurrency(balance);
			const turn = (0, react.useMemo)(() => currentTurnEstimate(snapshot, pressure, breakdown, currency, now), [
				snapshot,
				pressure,
				breakdown,
				currency
			]);
			const session = (0, react.useMemo)(() => sessionEstimate(usage, snapshot, currency, now), [
				usage,
				snapshot,
				currency
			]);
			const loadBalance = async (force = false) => {
				setBalance({ status: "loading" });
				try {
					const response = await fetch(`/__personal/usage-balance${force ? "?refresh=1" : ""}`, {
						headers: {
							accept: "application/json",
							"x-dsh-personal-client": "1"
						},
						credentials: "same-origin"
					});
					const envelope = await response.json();
					if (!response.ok || envelope.ok !== true || envelope.data === void 0) throw new Error("balance request failed");
					setBalance(envelope.data);
				} catch {
					setBalance({
						status: "unavailable",
						checkedAt: (/* @__PURE__ */ new Date()).toISOString()
					});
				}
			};
			const positionPanel = () => {
				const rect = triggerRef.current?.getBoundingClientRect();
				if (rect === void 0) return;
				setPanelStyle({
					right: Math.max(12, window.innerWidth - rect.right),
					bottom: Math.max(12, window.innerHeight - rect.top + 8)
				});
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				positionPanel();
				const closeOutside = (event) => {
					if (!(event.target instanceof Node)) return;
					if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
					setOpen(false);
				};
				window.addEventListener("resize", positionPanel);
				document.addEventListener("pointerdown", closeOutside);
				return () => {
					window.removeEventListener("resize", positionPanel);
					document.removeEventListener("pointerdown", closeOutside);
				};
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				setNow(Date.now());
				const timer = setInterval(() => {
					setNow(Date.now());
				}, 6e4);
				return () => {
					clearInterval(timer);
				};
			}, [open]);
			const changeOpen = () => {
				const next = !open;
				setOpen(next);
				setNotice(null);
				if (next && balance.status === "idle") loadBalance();
			};
			const topUp = async () => {
				setNotice("正在打开隔离的 DeepSeek 充值页…");
				const result = await openBillingCenter();
				if (!result.ok) {
					setNotice("充值页打开失败；桌面 bridge 尚未可用或外部打开也失败。");
					return;
				}
				setNotice(result.mode === "isolated" ? "充值页已关闭，正在刷新余额…" : "已交给系统浏览器；正在刷新余额…");
				await loadBalance(true);
			};
			const buttonText = turn === void 0 ? "用量" : `预计 ${formatEstimatedMoney(turn.amount, turn.currency)}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: UsageBalanceControl_module_css_default.root,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					ref: triggerRef,
					type: "button",
					className: UsageBalanceControl_module_css_default.trigger,
					"aria-expanded": open,
					"aria-haspopup": "dialog",
					title: "DeepSeek 用量与余额（金额均为预计，官方余额除外）",
					onClick: changeOpen,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: UsageBalanceControl_module_css_default.coin,
						children: "¥"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: buttonText })]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: panelRef,
					role: "dialog",
					"aria-label": "DeepSeek 用量与余额",
					className: UsageBalanceControl_module_css_default.panel,
					style: panelStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: UsageBalanceControl_module_css_default.header,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "用量与余额" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "所有成本数字均为预计" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-label": "关闭",
								onClick: () => {
									setOpen(false);
								},
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: UsageBalanceControl_module_css_default.costGrid,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "当前 Turn" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: turn === void 0 ? "暂无可估数据" : `预计 ${formatEstimatedMoney(turn.amount, turn.currency)}` }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: turn?.approximate === true ? "运行中输入按未命中缓存估算；输出待 usage" : turn?.model ?? "等待 DeepSeek usage" })
							] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Session 累计" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: session === void 0 ? "暂无可估数据" : `预计 ${formatEstimatedMoney(session.amount, session.currency)}` }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: session === void 0 ? "仅支持官方 DeepSeek V4 价格" : `${session.model} · 当前价等值` })
							] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: UsageBalanceControl_module_css_default.balance,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: UsageBalanceControl_module_css_default.sectionHeading,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "官方余额" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										disabled: balance.status === "loading",
										type: "button",
										onClick: () => {
											loadBalance(true);
										},
										children: "刷新"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									"data-state": balance.status,
									children: balanceCopy(balance)
								}),
								balance.status === "ready" ? balance.balances.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: UsageBalanceControl_module_css_default.balanceRow,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.currency }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [item.currency === "CNY" ? "¥" : "$", item.total] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
											"充值 ",
											item.toppedUp,
											" · 赠金 ",
											item.granted
										] })
									]
								}, item.currency)) : null
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: UsageBalanceControl_module_css_default.actions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: UsageBalanceControl_module_css_default.primary,
								type: "button",
								onClick: () => {
									topUp();
								},
								children: "充值中心"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: notice ?? "隔离页失败时由桌面主进程尝试系统浏览器" })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", { children: [
							"价格表 ",
							PRICING_TABLE_VERSION,
							" · 快照 ",
							PRICING_SNAPSHOT_DATE,
							"；价格变化需随客户端更新。估算不替代 DeepSeek 账单。"
						] })
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots"];
		/** Add one compact, session-aware cost control beside the composer send path. */
		function apply(ctx) {
			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "personal-usage-balance",
				order: 40
			}, UsageBalanceControl));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.openBillingCenter = openBillingCenter;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map