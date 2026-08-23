window.__ModuleLoader__.load({
	id: "@cyrus/dsh-plugin-organizer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:D:\Deepseek Harness Personal\plugins\plugin-organizer\src\client\PluginOrganizerSection.module.css.mjs
		const css = ".f3f7DG_section{width:100%;max-width:860px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:15px;display:flex}.f3f7DG_header{justify-content:space-between;align-items:flex-start;gap:18px;display:flex}.f3f7DG_header h2,.f3f7DG_header p,.f3f7DG_boundary,.f3f7DG_editor h3,.f3f7DG_status,.f3f7DG_notice,.f3f7DG_failure p,.f3f7DG_live,.f3f7DG_groupHeading h3,.f3f7DG_description{margin:0}.f3f7DG_header h2{font-size:18px;line-height:26px}.f3f7DG_header p{max-width:620px;color:var(--dsw-alias-label-tertiary);margin-top:4px;font-size:13px;line-height:20px}.f3f7DG_header button,.f3f7DG_editor button,.f3f7DG_failure button,.f3f7DG_cardActions button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:7px;padding:7px 11px}.f3f7DG_boundary{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);border-radius:9px;gap:8px;padding:10px 12px;font-size:12px;line-height:18px;display:flex}.f3f7DG_boundary strong{color:var(--dsw-alias-label-primary);flex:none}.f3f7DG_editor{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:11px;flex-direction:column;gap:11px;padding:15px;display:flex}.f3f7DG_editor label,.f3f7DG_search{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:6px;font-size:12px;display:flex}.f3f7DG_editor input,.f3f7DG_search input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:100%;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;padding:9px 11px;font-size:13px}.f3f7DG_editor input:focus,.f3f7DG_search input:focus{border-color:var(--dsw-alias-state-business-primary)}.f3f7DG_actions{justify-content:flex-end;gap:8px;display:flex}.f3f7DG_primaryButton{border-color:var(--dsw-alias-state-business-primary)!important;background:var(--dsw-alias-state-business-primary)!important;color:#fff!important}.f3f7DG_notice{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);color:var(--dsw-alias-label-secondary);border-radius:8px;padding:9px 12px;font-size:13px}.f3f7DG_status,.f3f7DG_failure,.f3f7DG_live{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px}.f3f7DG_failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex}.f3f7DG_live{align-items:center;gap:7px;display:flex}.f3f7DG_live span{background:var(--dsw-alias-state-success-primary);border-radius:999px;width:7px;height:7px}.f3f7DG_groups{flex-direction:column;gap:18px;display:flex}.f3f7DG_group{flex-direction:column;gap:9px;display:flex}.f3f7DG_groupHeading{align-items:baseline;gap:7px;display:flex}.f3f7DG_groupHeading h3{font-size:14px}.f3f7DG_groupHeading span{color:var(--dsw-alias-label-tertiary);font-size:12px}.f3f7DG_cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none;display:grid}.f3f7DG_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;flex-direction:column;gap:10px;min-width:0;padding:14px;display:flex}.f3f7DG_cardHeader{justify-content:space-between;align-items:flex-start;gap:10px;display:flex}.f3f7DG_cardHeader strong{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:13px;overflow:hidden}.f3f7DG_phase{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);border-radius:5px;flex:none;padding:2px 6px;font-size:10px}.f3f7DG_phase[data-phase=active]{color:var(--dsw-alias-state-success-primary)}.f3f7DG_phase[data-phase=failed]{color:var(--dsw-alias-state-error-primary)}.f3f7DG_description{color:var(--dsw-alias-label-secondary);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:13px;line-height:19px;display:-webkit-box;overflow:hidden}.f3f7DG_meta{min-width:0;color:var(--dsw-alias-label-tertiary);justify-content:space-between;align-items:center;gap:10px;font-size:10px;display:flex}.f3f7DG_meta code{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:10px;overflow:hidden}.f3f7DG_meta span{flex:none}.f3f7DG_cardActions{justify-content:flex-end;margin-top:auto;display:flex}.f3f7DG_cardActions button{padding:5px 9px;font-size:11px}.f3f7DG_section button:disabled{opacity:.45;cursor:not-allowed!important}@media (width<=700px){.f3f7DG_header{flex-direction:column}.f3f7DG_cards{grid-template-columns:1fr}.f3f7DG_boundary{flex-direction:column}}";
		const tagId = "@cyrus/dsh-plugin-organizer/PluginOrganizerSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-plugin-organizer";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var PluginOrganizerSection_module_css_default = {
			"actions": "f3f7DG_actions",
			"boundary": "f3f7DG_boundary",
			"card": "f3f7DG_card",
			"cardActions": "f3f7DG_cardActions",
			"cardHeader": "f3f7DG_cardHeader",
			"cards": "f3f7DG_cards",
			"description": "f3f7DG_description",
			"editor": "f3f7DG_editor",
			"failure": "f3f7DG_failure",
			"group": "f3f7DG_group",
			"groupHeading": "f3f7DG_groupHeading",
			"groups": "f3f7DG_groups",
			"header": "f3f7DG_header",
			"live": "f3f7DG_live",
			"meta": "f3f7DG_meta",
			"notice": "f3f7DG_notice",
			"phase": "f3f7DG_phase",
			"primaryButton": "f3f7DG_primaryButton",
			"search": "f3f7DG_search",
			"section": "f3f7DG_section",
			"status": "f3f7DG_status"
		};
		//#endregion
		//#region src/client/PluginOrganizerSection.tsx
		function messageOf(error) {
			return error instanceof Error && error.message.trim().length > 0 ? error.message : "请求失败，请稍后重试。";
		}
		const PHASE_LABEL = {
			pending: "等待加载",
			loading: "加载中",
			active: "运行中",
			failed: "加载失败",
			unloading: "卸载中",
			unobserved: "未观察到运行实例"
		};
		function phaseLabel(item) {
			return item.fiberPhase === null ? PHASE_LABEL.unobserved : PHASE_LABEL[item.fiberPhase];
		}
		/** Live Loader inventory enriched with personal, editable organization metadata. */
		function PluginOrganizerSection({ api }) {
			const [state, setState] = (0, react.useState)({ status: "loading" });
			const [query, setQuery] = (0, react.useState)("");
			const [editing, setEditing] = (0, react.useState)(null);
			const [category, setCategory] = (0, react.useState)("");
			const [description, setDescription] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(null);
			const [reloadToken, setReloadToken] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (api === void 0) {
					setState({
						status: "error",
						message: "插件清单 API 尚未挂载。"
					});
					return;
				}
				let alive = true;
				let first = true;
				let controller;
				const refresh = async () => {
					controller?.abort();
					controller = new AbortController();
					if (first) setState({ status: "loading" });
					try {
						const items = await api.list(controller.signal);
						if (alive) setState({
							status: "ready",
							items,
							refreshedAt: Date.now()
						});
					} catch (error) {
						if (alive && !controller.signal.aborted) setState({
							status: "error",
							message: messageOf(error)
						});
					} finally {
						first = false;
					}
				};
				refresh();
				const timer = window.setInterval(() => {
					refresh();
				}, 5e3);
				return () => {
					alive = false;
					controller?.abort();
					window.clearInterval(timer);
				};
			}, [api, reloadToken]);
			const groups = (0, react.useMemo)(() => {
				if (state.status !== "ready") return [];
				const needle = query.trim().toLocaleLowerCase();
				const items = needle.length === 0 ? state.items : state.items.filter((item) => [
					item.packageName,
					item.entryId,
					item.category,
					item.description
				].some((value) => value.toLocaleLowerCase().includes(needle)));
				const map = /* @__PURE__ */ new Map();
				for (const item of items) {
					const group = map.get(item.category) ?? [];
					group.push(item);
					map.set(item.category, group);
				}
				return [...map.entries()].sort(([left], [right]) => left.localeCompare(right, "zh-CN")).map(([name, entries]) => ({
					name,
					entries: entries.sort((a, b) => a.packageName.localeCompare(b.packageName))
				}));
			}, [query, state]);
			const startEdit = (item) => {
				setEditing(item);
				setCategory(item.category);
				setDescription(item.description);
				setNotice(null);
			};
			const submit = (event) => {
				event.preventDefault();
				if (api === void 0 || editing === null || category.trim().length === 0 || description.trim().length === 0) return;
				setBusy(true);
				setNotice(null);
				api.update(editing, {
					category: category.trim(),
					description: description.trim()
				}).then(() => {
					setEditing(null);
					setNotice(`已更新 ${editing.packageName} 的整理信息。`);
					setReloadToken((value) => value + 1);
				}, (error) => {
					setNotice(messageOf(error));
				}).finally(() => {
					setBusy(false);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: PluginOrganizerSection_module_css_default.section,
				"aria-busy": state.status === "loading" || busy,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: PluginOrganizerSection_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "插件整理" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "这里读取实时 Loader 清单，只维护个人分类与一句话简介。安装、更新和卸载请使用 Harness 原生“插件”页。" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								setReloadToken((value) => value + 1);
							},
							children: "立即刷新"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
						className: PluginOrganizerSection_module_css_default.boundary,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "职责边界" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "本页不会安装、卸载、启用或停用插件；运行状态来自当前 Loader 快照。需要安装、更新或回滚插件时，请前往设置 → 更新中心。" })]
					}),
					editing !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: PluginOrganizerSection_module_css_default.editor,
						onSubmit: submit,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", { children: ["整理 ", editing.packageName] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["分类", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								required: true,
								value: category,
								onChange: (event) => {
									setCategory(event.target.value);
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["一句话简介", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								required: true,
								value: description,
								onChange: (event) => {
									setDescription(event.target.value);
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PluginOrganizerSection_module_css_default.actions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										setEditing(null);
									},
									children: "取消"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: PluginOrganizerSection_module_css_default.primaryButton,
									disabled: busy,
									type: "submit",
									children: "保存"
								})]
							})
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: PluginOrganizerSection_module_css_default.search,
						children: ["搜索", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "search",
							value: query,
							placeholder: "按包名、入口、分类或简介搜索",
							onChange: (event) => {
								setQuery(event.target.value);
							}
						})]
					}),
					notice !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginOrganizerSection_module_css_default.notice,
						role: "status",
						children: notice
					}) : null,
					state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginOrganizerSection_module_css_default.status,
						children: "正在读取 Loader 清单…"
					}) : null,
					state.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginOrganizerSection_module_css_default.failure,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							children: state.message
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								setReloadToken((value) => value + 1);
							},
							children: "重试"
						})]
					}) : null,
					state.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: PluginOrganizerSection_module_css_default.live,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {}),
							"实时清单 · 每 5 秒刷新 · ",
							state.items.length,
							" 项"
						]
					}) : null,
					state.status === "ready" && state.items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginOrganizerSection_module_css_default.status,
						children: "当前 Loader 没有可展示的插件条目。"
					}) : null,
					state.status === "ready" && state.items.length > 0 && groups.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginOrganizerSection_module_css_default.status,
						children: "没有匹配的插件。"
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: PluginOrganizerSection_module_css_default.groups,
						children: groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: PluginOrganizerSection_module_css_default.group,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PluginOrganizerSection_module_css_default.groupHeading,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: group.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: group.entries.length })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: PluginOrganizerSection_module_css_default.cards,
								children: group.entries.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
									className: PluginOrganizerSection_module_css_default.card,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: PluginOrganizerSection_module_css_default.cardHeader,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
												title: item.packageName,
												children: item.packageName
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: PluginOrganizerSection_module_css_default.phase,
												"data-phase": item.fiberPhase ?? "unobserved",
												children: item.enabled ? phaseLabel(item) : "配置已停用"
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: PluginOrganizerSection_module_css_default.description,
											title: item.description,
											children: item.description
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: PluginOrganizerSection_module_css_default.meta,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
													title: item.entryId,
													children: item.entryId
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.categoryCustomized || item.descriptionCustomized ? "含自定义整理" : "默认整理" }),
												item.version !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["v", item.version] }) : null,
												item.source !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.source === "external" ? "外部" : "内置" }) : null,
												item.degradedReason !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													title: item.degradedReason,
													children: "降级"
												}) : null
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: PluginOrganizerSection_module_css_default.cardActions,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												disabled: !item.canEdit || busy,
												type: "button",
												onClick: () => {
													startEdit(item);
												},
												children: "编辑分类和简介"
											})
										})
									]
								}, item.id))
							})]
						}, group.name))
					})
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
		async function getPersonal(api, path, signal) {
			return api.request(path, {
				method: "GET",
				...signal === void 0 ? {} : { signal }
			});
		}
		async function putPersonal(api, path, body) {
			return api.request(path, {
				method: "PUT",
				body
			});
		}
		//#endregion
		//#region src/client/pluginApi.ts
		function record(value) {
			return typeof value === "object" && value !== null ? value : {};
		}
		function text(value, fallback = "") {
			return typeof value === "string" ? value.trim() : fallback;
		}
		function boolean(value, fallback) {
			return typeof value === "boolean" ? value : fallback;
		}
		function defaultCategory(packageName) {
			if (packageName.startsWith("@cyrus/")) return "个人扩展";
			if (packageName.startsWith("@deepseek-ai/")) return "Harness 官方";
			return "第三方插件";
		}
		function defaultDescription(packageName) {
			if (packageName.startsWith("@cyrus/")) return "个人桌面环境的扩展组件。";
			if (packageName.startsWith("@deepseek-ai/")) return "DeepSeek Harness 随附的官方组件。";
			return "由当前 Harness 配置加载的第三方组件。";
		}
		const PHASES = new Set([
			"pending",
			"loading",
			"active",
			"failed",
			"unloading",
			null
		]);
		function normalizeItem(value, index) {
			const row = record(value);
			const packageName = text(row.packageName, text(row.moduleName, `plugin-${index + 1}`));
			const entryId = text(row.entryId, text(row.id, packageName));
			const customCategory = text(row.category);
			const customDescription = text(row.description, text(row.summary));
			const rawPhase = row.fiberPhase;
			const fiberPhase = PHASES.has(rawPhase) ? rawPhase : null;
			const rawSource = row.source;
			const source = rawSource === "external" || rawSource === "builtin" ? rawSource : void 0;
			return {
				id: text(row.id, entryId),
				entryId,
				packageName,
				category: customCategory || defaultCategory(packageName),
				categoryCustomized: boolean(row.categoryCustomized, boolean(row.customCategory, customCategory.length > 0)),
				description: customDescription || defaultDescription(packageName),
				descriptionCustomized: boolean(row.descriptionCustomized, boolean(row.customDescription, customDescription.length > 0)),
				enabled: boolean(row.enabled, false),
				fiberPhase,
				canEdit: boolean(row.canEdit, boolean(row.editable, true)),
				...row.version === void 0 ? {} : { version: text(row.version) },
				...source === void 0 ? {} : { source },
				...row.installedAt === void 0 ? {} : { installedAt: text(row.installedAt) },
				...row.degradedReason === void 0 ? {} : { degradedReason: text(row.degradedReason) }
			};
		}
		function normalizeList(value) {
			const root = record(value);
			return (Array.isArray(value) ? value : Array.isArray(root.plugins) ? root.plugins : Array.isArray(root.items) ? root.items : Array.isArray(root.entries) ? root.entries : []).map(normalizeItem);
		}
		function createPluginOrganizerApi(api) {
			return {
				async list(signal) {
					return normalizeList(await getPersonal(api, "/plugins", signal));
				},
				async update(item, patch) {
					await putPersonal(api, "/plugins", {
						id: item.id,
						entryId: item.entryId,
						packageName: item.packageName,
						category: patch.category,
						description: patch.description
					});
				}
			};
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "personalApi"];
		/** Register a metadata organizer beside, rather than in place of, the native Plugins page. */
		function apply(ctx) {
			const api = createPluginOrganizerApi(requirePersonalApi(ctx.get("personalApi")));
			const injected = () => ({ api });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "personal-plugin-organizer",
				order: 50,
				label: "插件整理",
				inject: injected
			}, PluginOrganizerSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map