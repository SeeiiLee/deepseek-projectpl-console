window.__ModuleLoader__.load({
	id: "@cyrus/dsh-anysearch",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:D:\dsh-v0.4.3-clean\plugins\anysearch\src\client\AnySearchSection.module.css.mjs
		const css = ".UyAuUW_section{flex-direction:column;gap:14px;display:flex}.UyAuUW_header{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}.UyAuUW_header h2{margin:0;font-size:18px}.UyAuUW_header p{color:var(--dsh-text-secondary,#666);margin:4px 0 0;line-height:1.5}.UyAuUW_beta{opacity:.8;border:1px solid;border-radius:999px;flex:none;padding:2px 10px;font-size:12px}.UyAuUW_form{flex-direction:column;gap:12px;display:flex}.UyAuUW_form label{flex-direction:column;gap:6px;display:flex}.UyAuUW_form input{box-sizing:border-box;border:1px solid var(--dsh-border,#ccc);background:var(--dsh-input-bg,#fff);width:100%;color:var(--dsh-text,#111);border-radius:6px;padding:8px 10px}.UyAuUW_form small{color:var(--dsh-text-secondary,#666);line-height:1.4}.UyAuUW_actions{flex-wrap:wrap;gap:10px;display:flex}.UyAuUW_actions button{border:1px solid var(--dsh-border,#ccc);background:var(--dsh-button-bg,#f5f5f5);color:var(--dsh-text,#111);cursor:pointer;border-radius:6px;padding:7px 12px}.UyAuUW_actions button:disabled{cursor:not-allowed;opacity:.55}.UyAuUW_primaryButton{font-weight:600}.UyAuUW_notice{background:color-mix(in srgb, var(--dsh-accent,#4d6bfe) 12%, transparent);color:var(--dsh-text,#111);border-radius:6px;margin:0;padding:8px 10px}.UyAuUW_status{color:var(--dsh-text-secondary,#666);margin:0}";
		const tagId = "@cyrus/dsh-anysearch/AnySearchSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-anysearch";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var AnySearchSection_module_css_default = {
			"actions": "UyAuUW_actions",
			"beta": "UyAuUW_beta",
			"form": "UyAuUW_form",
			"header": "UyAuUW_header",
			"notice": "UyAuUW_notice",
			"primaryButton": "UyAuUW_primaryButton",
			"section": "UyAuUW_section",
			"status": "UyAuUW_status"
		};
		//#endregion
		//#region src/client/AnySearchSection.tsx
		const DEFAULT_ENDPOINT = "https://api.anysearch.com/mcp";
		const DEFAULT_API_KEY_ENV = "ANYSEARCH_API_KEY";
		function messageOf(error) {
			return error instanceof Error && error.message.trim().length > 0 ? error.message : "AnySearch 设置保存失败。";
		}
		/** AnySearch provider settings section. */
		function AnySearchSection({ scope }) {
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope?.getSnapshot() ?? {
				status: "unavailable",
				value: void 0,
				base: void 0,
				user: void 0,
				revision: void 0,
				writable: false,
				mode: "memory"
			});
			const [endpoint, setEndpoint] = (0, react.useState)(DEFAULT_ENDPOINT);
			const [apiKey, setApiKey] = (0, react.useState)("");
			const [apiKeyEnv, setApiKeyEnv] = (0, react.useState)(DEFAULT_API_KEY_ENV);
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (scope === void 0) return;
				setSnapshot(scope.getSnapshot());
				return scope.subscribe(() => setSnapshot(scope.getSnapshot()));
			}, [scope]);
			(0, react.useEffect)(() => {
				if (snapshot.status !== "ready" || snapshot.value === void 0) return;
				if (typeof snapshot.value.endpoint === "string" && snapshot.value.endpoint.trim().length > 0) setEndpoint(snapshot.value.endpoint);
				if (typeof snapshot.value.apiKeyEnv === "string" && snapshot.value.apiKeyEnv.trim().length > 0) setApiKeyEnv(snapshot.value.apiKeyEnv);
			}, [snapshot]);
			const runSave = async (operation, success) => {
				if (scope === void 0 || snapshot.writable === false) return;
				setBusy(true);
				setNotice(null);
				try {
					await operation();
					setNotice(success);
				} catch (error) {
					setNotice(messageOf(error));
				} finally {
					setBusy(false);
				}
			};
			const submit = (event) => {
				event.preventDefault();
				runSave(async () => {
					await scope?.set("endpoint", endpoint.trim());
					if (apiKeyEnv.trim().length > 0) await scope?.set("apiKeyEnv", apiKeyEnv.trim());
					if (apiKey.trim().length > 0) {
						await scope?.set("apiKey", apiKey.trim());
						setApiKey("");
					}
				}, "AnySearch 设置已保存。");
			};
			const clearKey = () => {
				runSave(async () => {
					await scope?.unset("apiKey");
					setApiKey("");
				}, "已清除 AnySearch API Key。");
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: AnySearchSection_module_css_default.section,
				"aria-busy": busy || snapshot.status === "loading",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: AnySearchSection_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "AnySearch 搜索" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "第三方网络搜索 provider。保存后 Harness 的 web_search 会通过 AnySearch 执行。" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: AnySearchSection_module_css_default.beta,
							children: "测试版"
						})]
					}),
					notice !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: AnySearchSection_module_css_default.notice,
						role: "status",
						children: notice
					}) : null,
					snapshot.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: AnySearchSection_module_css_default.status,
						children: "正在读取 AnySearch 设置…"
					}) : null,
					snapshot.status === "unavailable" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: AnySearchSection_module_css_default.status,
						role: "alert",
						children: "AnySearch 设置命名空间当前不可用。"
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: AnySearchSection_module_css_default.form,
						onSubmit: submit,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "接口地址" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: endpoint,
								placeholder: DEFAULT_ENDPOINT,
								onChange: (event) => {
									setEndpoint(event.target.value);
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "API Key 引用" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: apiKeyEnv,
									placeholder: DEFAULT_API_KEY_ENV,
									onChange: (event) => {
										setApiKeyEnv(event.target.value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "默认通过 ANYSEARCH_API_KEY 凭据解析。" })
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "API Key" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "password",
									value: apiKey,
									placeholder: "留空则保持已保存的 Key 不变",
									autoComplete: "off",
									onChange: (event) => {
										setApiKey(event.target.value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "密钥保存后不会回显。" })
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: AnySearchSection_module_css_default.actions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: AnySearchSection_module_css_default.primaryButton,
									disabled: busy || snapshot.writable === false,
									type: "submit",
									children: "保存设置"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: busy || snapshot.writable === false,
									type: "button",
									onClick: clearKey,
									children: "清除 API Key"
								})]
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Runtime services used by the settings contribution. */
		const inject = ["slots", "settingsScope"];
		/** Register the AnySearch provider settings section. */
		function apply(ctx) {
			const binder = ctx.get("settingsScope");
			if (binder === void 0) return;
			const scope = binder.bind({ namespace: "anysearch" });
			const injected = () => ({ scope });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "personal-anysearch",
				order: 45,
				label: "AnySearch 搜索",
				inject: injected
			}, AnySearchSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map