window.__ModuleLoader__.load({
	id: "@cyrus/dsh-connection-center",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:D:\Deepseek Harness Personal\plugins\connection-center\src\client\ConnectionCenterSection.module.css.mjs
		const css = ".xkj7jG_section{width:100%;max-width:880px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:16px;display:flex}.xkj7jG_header{justify-content:space-between;align-items:flex-start;gap:18px;display:flex}.xkj7jG_header h2,.xkj7jG_header p,.xkj7jG_warning,.xkj7jG_editor h3,.xkj7jG_status,.xkj7jG_notice,.xkj7jG_failure p,.xkj7jG_notConnected{margin:0}.xkj7jG_header h2{font-size:18px;line-height:26px}.xkj7jG_header p{color:var(--dsw-alias-label-tertiary);margin-top:4px;font-size:13px;line-height:20px}.xkj7jG_primaryButton,.xkj7jG_actions button,.xkj7jG_cardActions button,.xkj7jG_failure button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:7px;padding:7px 11px}.xkj7jG_primaryButton{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:#fff;white-space:nowrap}.xkj7jG_warning{border:1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary,#d99b25) 40%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#d99b25) 8%, transparent);border-radius:10px;flex-direction:column;gap:3px;padding:11px 13px;font-size:12px;line-height:18px;display:flex}.xkj7jG_warning span{color:var(--dsw-alias-label-secondary)}.xkj7jG_templates{grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;display:grid}.xkj7jG_templates button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);min-width:0;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;border-radius:10px;flex-direction:column;gap:5px;padding:11px;display:flex}.xkj7jG_templates button:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}.xkj7jG_templates button:disabled{cursor:not-allowed;opacity:.55}.xkj7jG_templates strong{font-size:12px}.xkj7jG_templates span{min-height:48px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}.xkj7jG_templates small{color:var(--dsw-alias-state-business-primary);font-size:10px}.xkj7jG_editor{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;flex-direction:column;gap:12px;padding:16px;display:flex}.xkj7jG_editorHeading{justify-content:space-between;align-items:baseline;gap:10px;display:flex}.xkj7jG_editorHeading span{color:var(--dsw-alias-label-tertiary);font-size:11px}.xkj7jG_formGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;display:grid}.xkj7jG_editor label{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:6px;font-size:12px;display:flex}.xkj7jG_editor input,.xkj7jG_editor select{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:100%;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;padding:9px 11px;font-size:13px}.xkj7jG_editor input:focus,.xkj7jG_editor select:focus{border-color:var(--dsw-alias-state-business-primary)}.xkj7jG_editor label small{color:var(--dsw-alias-label-tertiary);font-size:10px}.xkj7jG_checkbox{align-items:center;flex-direction:row!important}.xkj7jG_checkbox input{width:auto}.xkj7jG_actions{justify-content:flex-end;gap:8px;display:flex}.xkj7jG_notice{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);color:var(--dsw-alias-label-secondary);border-radius:8px;padding:9px 12px;font-size:13px}.xkj7jG_status,.xkj7jG_failure{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}.xkj7jG_failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex}.xkj7jG_cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none;display:grid}.xkj7jG_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;flex-direction:column;gap:10px;min-width:0;padding:14px;display:flex}.xkj7jG_cardHeading{justify-content:space-between;align-items:flex-start;gap:10px;display:flex}.xkj7jG_cardHeading div{min-width:0}.xkj7jG_cardHeading strong,.xkj7jG_cardHeading div>span{text-overflow:ellipsis;white-space:nowrap;display:block;overflow:hidden}.xkj7jG_cardHeading strong{font-size:14px}.xkj7jG_cardHeading div>span{color:var(--dsw-alias-label-tertiary);margin-top:3px;font-size:11px}.xkj7jG_configState{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);border-radius:5px;flex:none;padding:2px 6px;font-size:10px}.xkj7jG_configState[data-enabled=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}.xkj7jG_notConnected{color:var(--dsw-alias-state-warning-primary,#d99b25);font-size:11px;font-weight:600}.xkj7jG_card code{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;border-radius:6px;padding:7px 8px;font-size:11px;overflow:hidden}.xkj7jG_credentials{color:var(--dsw-alias-label-tertiary);justify-content:space-between;gap:10px;font-size:10px;display:flex}.xkj7jG_cardActions{justify-content:flex-end;gap:7px;margin-top:auto;display:flex}.xkj7jG_cardActions button{padding:5px 8px;font-size:11px}.xkj7jG_dangerButton{color:var(--dsw-alias-state-error-primary)!important}.xkj7jG_section button:disabled{opacity:.45;cursor:not-allowed!important}@media (width<=800px){.xkj7jG_templates{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (width<=680px){.xkj7jG_header{flex-direction:column}.xkj7jG_cards,.xkj7jG_formGrid{grid-template-columns:1fr}}";
		const tagId = "@cyrus/dsh-connection-center/ConnectionCenterSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-connection-center";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ConnectionCenterSection_module_css_default = {
			"actions": "xkj7jG_actions",
			"card": "xkj7jG_card",
			"cardActions": "xkj7jG_cardActions",
			"cardHeading": "xkj7jG_cardHeading",
			"cards": "xkj7jG_cards",
			"checkbox": "xkj7jG_checkbox",
			"configState": "xkj7jG_configState",
			"credentials": "xkj7jG_credentials",
			"dangerButton": "xkj7jG_dangerButton",
			"editor": "xkj7jG_editor",
			"editorHeading": "xkj7jG_editorHeading",
			"failure": "xkj7jG_failure",
			"formGrid": "xkj7jG_formGrid",
			"header": "xkj7jG_header",
			"notConnected": "xkj7jG_notConnected",
			"notice": "xkj7jG_notice",
			"primaryButton": "xkj7jG_primaryButton",
			"section": "xkj7jG_section",
			"status": "xkj7jG_status",
			"templates": "xkj7jG_templates",
			"warning": "xkj7jG_warning"
		};
		//#endregion
		//#region src/client/ConnectionCenterSection.tsx
		const EMPTY_DRAFT = {
			label: "",
			kind: "feishu-bot",
			enabled: false,
			endpoint: "",
			mcpTransport: "streamable-http",
			secret: ""
		};
		const TEMPLATES = [
			{
				kind: "feishu-bot",
				label: "飞书机器人",
				description: "保存飞书群机器人 Webhook 配置。",
				available: true
			},
			{
				kind: "wechat-work-bot",
				label: "企业微信机器人",
				description: "保存企业微信群机器人 Webhook 配置。",
				available: true
			},
			{
				kind: "webhook",
				label: "通用 Webhook",
				description: "保存一个通用 HTTP Webhook 目标。",
				available: true
			},
			{
				kind: "mcp",
				label: "MCP",
				description: "保存 HTTP 或本地 stdio MCP 配置。",
				available: true
			},
			{
				kind: "model",
				label: "模型服务（识图等）",
				description: "保存 OpenAI 兼容的模型 API 地址与密钥，供识图等插件调用。",
				available: true
			},
			{
				kind: "memory-extraction",
				label: "记忆提取",
				description: "保存供记忆自动提取使用的 OpenAI 兼容模型服务（建议低成本小模型）。",
				available: true
			},
			{
				kind: "personal-wechat",
				label: "个人微信",
				description: "仅保留产品位置，当前不可创建。",
				available: false
			}
		];
		function template(kind) {
			return TEMPLATES.find((item) => item.kind === kind) ?? TEMPLATES[2];
		}
		function messageOf(error) {
			return error instanceof Error && error.message.trim().length > 0 ? error.message : "请求失败，请稍后重试。";
		}
		function draftFor(item) {
			return {
				label: item.label,
				kind: item.kind === "personal-wechat" ? "webhook" : item.kind,
				enabled: item.enabled,
				endpoint: "",
				mcpTransport: item.mcpTransport ?? "streamable-http",
				secret: ""
			};
		}
		function endpointCopy(draft) {
			if (draft.kind === "mcp" && draft.mcpTransport === "stdio") return {
				label: "启动命令",
				placeholder: "例如：npx -y @modelcontextprotocol/server-example"
			};
			if (draft.kind === "mcp") return {
				label: "MCP URL",
				placeholder: "https://example.com/mcp"
			};
			if (draft.kind === "model" || draft.kind === "memory-extraction") return {
				label: "模型 API 地址（OpenAI 兼容）",
				placeholder: "https://api.example.com/v1"
			};
			return {
				label: "Webhook URL",
				placeholder: "https://example.com/webhook/…"
			};
		}
		/** Configuration UI that deliberately never claims a remote is connected. */
		function ConnectionCenterSection({ api }) {
			const [state, setState] = (0, react.useState)({ status: "loading" });
			const [adding, setAdding] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(EMPTY_DRAFT);
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(null);
			const load = async () => {
				if (api === void 0) {
					setState({
						status: "error",
						message: "连接 API 尚未挂载。"
					});
					return;
				}
				setState({ status: "loading" });
				try {
					setState({
						status: "ready",
						items: await api.list()
					});
				} catch (error) {
					setState({
						status: "error",
						message: messageOf(error)
					});
				}
			};
			(0, react.useEffect)(() => {
				load();
			}, [api]);
			const resetEditor = () => {
				setAdding(false);
				setEditing(null);
				setDraft(EMPTY_DRAFT);
			};
			const runMutation = async (operation, success) => {
				setBusy(true);
				setNotice(null);
				try {
					await operation();
					resetEditor();
					setNotice(success);
					await load();
				} catch (error) {
					setNotice(messageOf(error));
				} finally {
					setBusy(false);
				}
			};
			const openAdd = (kind = "feishu-bot") => {
				setEditing(null);
				setDraft({
					...EMPTY_DRAFT,
					kind
				});
				setAdding(true);
				setNotice(null);
			};
			const openEdit = (item) => {
				if (!item.canEdit || item.kind === "personal-wechat") return;
				setAdding(false);
				setEditing(item);
				setDraft(draftFor(item));
				setNotice(null);
			};
			const submit = (event) => {
				event.preventDefault();
				if (api === void 0 || draft.label.trim().length === 0) return;
				const endpoint = draft.endpoint.trim();
				if ((editing === null || !editing.endpointConfigured || editing.kind !== draft.kind || draft.kind === "mcp" && editing.mcpTransport !== draft.mcpTransport) && endpoint.length === 0) return;
				const shared = {
					label: draft.label.trim(),
					kind: draft.kind,
					enabled: draft.enabled,
					...draft.kind === "mcp" ? { mcpTransport: draft.mcpTransport } : {},
					...endpoint.length > 0 ? { endpoint } : {},
					...draft.secret.length > 0 ? { secret: draft.secret } : {}
				};
				if (editing === null) {
					const input = {
						...shared,
						endpoint
					};
					runMutation(() => api.create(input), `已保存 ${input.label} 的配置；尚未实际连接。`);
				} else runMutation(() => api.update(editing, shared), `已更新 ${shared.label} 的配置；尚未实际连接。`);
			};
			const toggleEnabled = (item) => {
				if (api === void 0 || !item.canEdit) return;
				runMutation(() => api.update(item, { enabled: !item.enabled }), `${item.label} 的配置已${item.enabled ? "停用" : "启用"}；尚未实际连接。`);
			};
			const remove = (item) => {
				if (api === void 0 || !item.canDelete) return;
				if (!window.confirm(`确认删除连接配置“${item.label}”吗？不会据此声称或操作任何真实连接。`)) return;
				runMutation(() => api.remove(item), `已删除 ${item.label} 的配置。`);
			};
			const endpoint = endpointCopy(draft);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ConnectionCenterSection_module_css_default.section,
				"aria-busy": state.status === "loading" || busy,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: ConnectionCenterSection_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "连接中心" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "集中整理外部服务入口与凭据引用，先建立清楚、可审核的配置清单。" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ConnectionCenterSection_module_css_default.primaryButton,
							type: "button",
							onClick: () => {
								adding ? resetEditor() : openAdd();
							},
							children: adding ? "取消添加" : "添加连接"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
						className: ConnectionCenterSection_module_css_default.warning,
						role: "note",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "仅配置 · 尚未实际连接" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "当前页面不会发起 Webhook、启动 MCP、验证凭据或探测在线状态；“启用”也只保存配置开关。" })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ConnectionCenterSection_module_css_default.templates,
						"aria-label": "连接模板",
						children: TEMPLATES.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							disabled: !item.available,
							type: "button",
							onClick: () => {
								if (item.available) openAdd(item.kind);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.label }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.description }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: item.available ? "可添加配置" : "预留模板" })
							]
						}, item.kind))
					}),
					adding || editing !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: ConnectionCenterSection_module_css_default.editor,
						onSubmit: submit,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ConnectionCenterSection_module_css_default.editorHeading,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: editing === null ? "添加连接配置" : `编辑 ${editing.label}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "密钥字段永不回显" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ConnectionCenterSection_module_css_default.formGrid,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["名称", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									required: true,
									value: draft.label,
									placeholder: "便于自己识别的名称",
									onChange: (event) => {
										setDraft((value) => ({
											...value,
											label: event.target.value
										}));
									}
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["类型", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									value: draft.kind,
									onChange: (event) => {
										setDraft((value) => ({
											...value,
											kind: event.target.value
										}));
									},
									children: [TEMPLATES.filter((item) => item.available).map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: item.kind,
										children: item.label
									}, item.kind)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										disabled: true,
										value: "personal-wechat",
										children: "个人微信（预留）"
									})]
								})] })]
							}),
							draft.kind === "mcp" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["MCP 传输", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: draft.mcpTransport,
								onChange: (event) => {
									setDraft((value) => ({
										...value,
										mcpTransport: event.target.value
									}));
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "streamable-http",
									children: "Streamable HTTP"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "stdio",
									children: "本地 stdio"
								})]
							})] }) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
								endpoint.label,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									required: editing === null || !editing.endpointConfigured || editing.kind !== draft.kind || draft.kind === "mcp" && editing.mcpTransport !== draft.mcpTransport,
									value: draft.endpoint,
									placeholder: editing?.endpointConfigured ? "已保存；留空保持不变，输入新值则替换" : endpoint.placeholder,
									onChange: (event) => {
										setDraft((value) => ({
											...value,
											endpoint: event.target.value
										}));
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: editing?.endpointConfigured ? "现有目标不会回填到浏览器；留空表示保持。" : "请输入连接目标。" })
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
								"密钥 / Token（只写）",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "password",
									autoComplete: "new-password",
									value: draft.secret,
									placeholder: editing?.secretConfigured ? "已保存；留空保持不变" : "可选；保存后不会回显",
									onChange: (event) => {
										setDraft((value) => ({
											...value,
											secret: event.target.value
										}));
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: editing?.secretConfigured ? "已有凭据已配置；其内容未读取到浏览器。" : "输入内容只用于本次写入。" })
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: ConnectionCenterSection_module_css_default.checkbox,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: draft.enabled,
									onChange: (event) => {
										setDraft((value) => ({
											...value,
											enabled: event.target.checked
										}));
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "启用这条配置（仍不代表已连接）" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ConnectionCenterSection_module_css_default.actions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: resetEditor,
									children: "取消"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ConnectionCenterSection_module_css_default.primaryButton,
									disabled: busy,
									type: "submit",
									children: "保存配置"
								})]
							})
						]
					}) : null,
					notice !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ConnectionCenterSection_module_css_default.notice,
						role: "status",
						children: notice
					}) : null,
					state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ConnectionCenterSection_module_css_default.status,
						children: "正在读取连接配置…"
					}) : null,
					state.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ConnectionCenterSection_module_css_default.failure,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							children: state.message
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								load();
							},
							children: "重试"
						})]
					}) : null,
					state.status === "ready" && state.items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ConnectionCenterSection_module_css_default.status,
						children: "还没有保存任何连接配置。"
					}) : null,
					state.status === "ready" && state.items.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: ConnectionCenterSection_module_css_default.cards,
						children: state.items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: ConnectionCenterSection_module_css_default.card,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ConnectionCenterSection_module_css_default.cardHeading,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: template(item.kind).label })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ConnectionCenterSection_module_css_default.configState,
										"data-enabled": item.enabled ? "true" : "false",
										children: item.enabled ? "配置已启用" : "配置已停用"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: ConnectionCenterSection_module_css_default.notConnected,
									children: "仅配置 · 尚未实际连接"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									title: item.endpointDisplay,
									children: item.endpointDisplay || (item.endpointConfigured ? "目标已配置（已隐藏）" : "未填写目标")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ConnectionCenterSection_module_css_default.credentials,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.secretConfigured ? "凭据已保存（不可见）" : "未保存凭据" }), item.kind === "mcp" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.mcpTransport === "stdio" ? "stdio" : "Streamable HTTP" }) : null]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ConnectionCenterSection_module_css_default.cardActions,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											disabled: !item.canEdit || busy,
											type: "button",
											onClick: () => {
												toggleEnabled(item);
											},
											children: item.enabled ? "停用配置" : "启用配置"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											disabled: !item.canEdit || busy,
											type: "button",
											onClick: () => {
												openEdit(item);
											},
											children: "编辑"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: ConnectionCenterSection_module_css_default.dangerButton,
											disabled: !item.canDelete || busy,
											type: "button",
											onClick: () => {
												remove(item);
											},
											children: "删除"
										})
									]
								})
							]
						}, item.id))
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/personalApi.ts
		function requirePersonalApi(value) {
			if (typeof value !== "object" || value === null) throw new Error("personalApi service is unavailable");
			const api = value;
			if (typeof api.request !== "function") throw new Error("personalApi service has no request method");
			return api;
		}
		async function callPersonal(api, method, path, body, signal) {
			return api.request(path, {
				method,
				...body === void 0 ? {} : { body },
				...signal === void 0 ? {} : { signal }
			});
		}
		//#endregion
		//#region src/client/connectionApi.ts
		function record(value) {
			return typeof value === "object" && value !== null ? value : {};
		}
		function text(value, fallback = "") {
			return typeof value === "string" ? value.trim() : fallback;
		}
		function boolean(value, fallback) {
			return typeof value === "boolean" ? value : fallback;
		}
		function normalizeKind(value) {
			switch (value) {
				case "feishu":
				case "lark":
				case "feishu-bot": return "feishu-bot";
				case "wecom":
				case "wechat-work":
				case "wechat-work-bot": return "wechat-work-bot";
				case "mcp": return "mcp";
				case "model":
				case "llm": return "model";
				case "memory-extraction": return "memory-extraction";
				case "personal-wechat":
				case "wechat-personal": return "personal-wechat";
				default: return "webhook";
			}
		}
		/** Last-resort display sanitizer for older Hosts that still return `endpoint`. */
		function safeEndpointDisplay(value, kind, transport) {
			if (value.length === 0) return "";
			if (kind === "mcp" && transport === "stdio") return value.split(/\s+/u)[0] ?? "stdio command";
			try {
				const url = new URL(value);
				if (kind === "mcp") return `${url.protocol}//${url.host}${url.pathname}`;
				return `${url.protocol}//${url.host}/…`;
			} catch {
				return "已配置目标（已隐藏）";
			}
		}
		function normalizeItem(value, index) {
			const row = record(value);
			const config = record(row.config);
			const kind = normalizeKind(row.kind ?? row.type);
			const mcpTransport = (row.mcpTransport ?? row.transport ?? config.transport) === "stdio" ? "stdio" : "streamable-http";
			const endpoint = text(row.endpoint, text(row.url, text(row.command, text(config.endpoint, text(config.url, text(config.command))))));
			const endpointDisplay = text(row.endpointDisplay, text(row.targetDisplay, safeEndpointDisplay(endpoint, kind, mcpTransport)));
			return {
				id: text(row.id, `connection-${index + 1}`),
				label: text(row.label, text(row.name, "未命名连接")),
				kind,
				enabled: boolean(row.enabled, false),
				endpointDisplay,
				endpointConfigured: boolean(row.endpointConfigured, boolean(row.targetConfigured, endpoint.length > 0)),
				...kind === "mcp" ? { mcpTransport } : {},
				secretConfigured: boolean(row.secretConfigured, boolean(row.hasSecret, boolean(row.credentialConfigured, false))),
				canEdit: boolean(row.canEdit, boolean(row.editable, kind !== "personal-wechat")),
				canDelete: boolean(row.canDelete, boolean(row.deletable, kind !== "personal-wechat"))
			};
		}
		function normalizeList(value) {
			const root = record(value);
			return (Array.isArray(value) ? value : Array.isArray(root.connections) ? root.connections : Array.isArray(root.items) ? root.items : []).map(normalizeItem);
		}
		function mutationBody(input) {
			const body = { ...input };
			if (input.secret === void 0 || input.secret.length === 0) delete body.secret;
			return body;
		}
		/** REST adapter that never derives or returns a credential value. */
		function createConnectionCenterApi(api) {
			return {
				async list(signal) {
					return normalizeList(await callPersonal(api, "GET", "/connections", void 0, signal));
				},
				async create(input) {
					await callPersonal(api, "POST", "/connections", mutationBody(input));
				},
				async update(item, patch) {
					await callPersonal(api, "PUT", "/connections", {
						id: item.id,
						...mutationBody(patch)
					});
				},
				async remove(item) {
					await callPersonal(api, "DELETE", "/connections", { id: item.id });
				}
			};
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "personalApi"];
		/** Register the configuration-only Connection Center in Settings. */
		function apply(ctx) {
			const api = createConnectionCenterApi(requirePersonalApi(ctx.get("personalApi")));
			const injected = () => ({ api });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "personal-connection-center",
				order: 60,
				label: "连接中心",
				inject: injected
			}, ConnectionCenterSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map