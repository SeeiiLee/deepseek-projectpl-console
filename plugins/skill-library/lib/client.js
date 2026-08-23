window.__ModuleLoader__.load({
	id: "@cyrus/dsh-skill-library",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:D:\Deepseek Harness Personal\plugins\skill-library\src\client\SkillLibrarySection.module.css.mjs
		const css = ".zWP_8W_section{width:100%;max-width:820px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:16px;display:flex}.zWP_8W_header{justify-content:space-between;align-items:flex-start;gap:18px;display:flex}.zWP_8W_header h2,.zWP_8W_header p,.zWP_8W_formCard h3,.zWP_8W_groupHeading h3,.zWP_8W_card p,.zWP_8W_status,.zWP_8W_notice,.zWP_8W_failure p{margin:0}.zWP_8W_header h2{font-size:18px;line-height:26px}.zWP_8W_header p{max-width:600px;color:var(--dsw-alias-label-tertiary);margin-top:4px;font-size:13px;line-height:20px}.zWP_8W_primaryButton,.zWP_8W_actions button,.zWP_8W_cardActions button,.zWP_8W_failure button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:7px;padding:7px 12px}.zWP_8W_primaryButton{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:#fff;white-space:nowrap}.zWP_8W_formCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;flex-direction:column;gap:12px;padding:16px;display:flex}.zWP_8W_formGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;display:grid}.zWP_8W_formCard label,.zWP_8W_search{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:6px;font-size:12px;display:flex}.zWP_8W_formCard input,.zWP_8W_formCard textarea,.zWP_8W_search input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);resize:vertical;background:var(--dsw-alias-bg-layer-1);width:100%;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;padding:9px 11px;font-size:13px}.zWP_8W_formCard input:focus,.zWP_8W_formCard textarea:focus,.zWP_8W_search input:focus{border-color:var(--dsw-alias-state-business-primary)}.zWP_8W_actions{justify-content:flex-end;gap:8px;display:flex}.zWP_8W_search{gap:7px}.zWP_8W_notice{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);color:var(--dsw-alias-label-secondary);border-radius:8px;padding:9px 12px;font-size:13px}.zWP_8W_status,.zWP_8W_failure{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}.zWP_8W_failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex}.zWP_8W_groups{flex-direction:column;gap:18px;display:flex}.zWP_8W_group{flex-direction:column;gap:9px;display:flex}.zWP_8W_groupHeading{align-items:baseline;gap:7px;display:flex}.zWP_8W_groupHeading h3{font-size:14px}.zWP_8W_groupHeading span{color:var(--dsw-alias-label-tertiary);font-size:12px}.zWP_8W_cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none;display:grid}.zWP_8W_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;flex-direction:column;justify-content:space-between;gap:12px;min-width:0;padding:14px;display:flex}.zWP_8W_cardCopy{min-width:0}.zWP_8W_cardCopy strong{text-overflow:ellipsis;white-space:nowrap;font-size:14px;display:block;overflow:hidden}.zWP_8W_cardCopy p{color:var(--dsw-alias-label-secondary);-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-top:5px;font-size:13px;line-height:19px;display:-webkit-box;overflow:hidden}.zWP_8W_cardCopy small{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;margin-top:7px;font-size:11px;display:block;overflow:hidden}.zWP_8W_cardActions{justify-content:flex-end;gap:7px;display:flex}.zWP_8W_cardActions button{padding:5px 9px;font-size:12px}.zWP_8W_dangerButton{color:var(--dsw-alias-state-error-primary)!important}.zWP_8W_section button:disabled{opacity:.45;cursor:not-allowed!important}@media (width<=680px){.zWP_8W_header{flex-direction:column}.zWP_8W_cards,.zWP_8W_formGrid{grid-template-columns:1fr}}";
		const tagId = "@cyrus/dsh-skill-library/SkillLibrarySection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-skill-library";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SkillLibrarySection_module_css_default = {
			"actions": "zWP_8W_actions",
			"card": "zWP_8W_card",
			"cardActions": "zWP_8W_cardActions",
			"cardCopy": "zWP_8W_cardCopy",
			"cards": "zWP_8W_cards",
			"dangerButton": "zWP_8W_dangerButton",
			"failure": "zWP_8W_failure",
			"formCard": "zWP_8W_formCard",
			"formGrid": "zWP_8W_formGrid",
			"group": "zWP_8W_group",
			"groupHeading": "zWP_8W_groupHeading",
			"groups": "zWP_8W_groups",
			"header": "zWP_8W_header",
			"notice": "zWP_8W_notice",
			"primaryButton": "zWP_8W_primaryButton",
			"search": "zWP_8W_search",
			"section": "zWP_8W_section",
			"status": "zWP_8W_status"
		};
		//#endregion
		//#region src/client/SkillLibrarySection.tsx
		const EMPTY_NEW = {
			name: "",
			category: "",
			description: "",
			content: ""
		};
		function messageOf(error) {
			return error instanceof Error && error.message.trim().length > 0 ? error.message : "请求失败，请稍后重试。";
		}
		/** Searchable, category-grouped Skill catalog with guarded mutations. */
		function SkillLibrarySection({ api }) {
			const [state, setState] = (0, react.useState)({ status: "loading" });
			const [query, setQuery] = (0, react.useState)("");
			const [adding, setAdding] = (0, react.useState)(false);
			const [draft, setDraft] = (0, react.useState)(EMPTY_NEW);
			const [editing, setEditing] = (0, react.useState)(null);
			const [editCategory, setEditCategory] = (0, react.useState)("");
			const [editDescription, setEditDescription] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(null);
			const load = async () => {
				if (api === void 0) {
					setState({
						status: "error",
						message: "Skill API 尚未挂载。"
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
			const groups = (0, react.useMemo)(() => {
				if (state.status !== "ready") return [];
				const needle = query.trim().toLocaleLowerCase();
				const matching = needle.length === 0 ? state.items : state.items.filter((item) => [
					item.name,
					item.description,
					item.category
				].some((value) => value.toLocaleLowerCase().includes(needle)));
				const grouped = /* @__PURE__ */ new Map();
				for (const item of matching) {
					const list = grouped.get(item.category) ?? [];
					list.push(item);
					grouped.set(item.category, list);
				}
				return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right, "zh-CN")).map(([category, items]) => ({
					category,
					items: items.sort((a, b) => a.name.localeCompare(b.name))
				}));
			}, [query, state]);
			const runMutation = async (operation, success) => {
				setBusy(true);
				setNotice(null);
				try {
					await operation();
					setNotice(success);
					await load();
				} catch (error) {
					setNotice(messageOf(error));
				} finally {
					setBusy(false);
				}
			};
			const submitNew = (event) => {
				event.preventDefault();
				if (api === void 0 || draft.name.trim().length === 0 || draft.description.trim().length === 0) return;
				const input = {
					name: draft.name.trim(),
					category: draft.category.trim() || "未分类",
					description: draft.description.trim(),
					content: draft.content.trim()
				};
				runMutation(async () => {
					await api.create(input);
					setDraft(EMPTY_NEW);
					setAdding(false);
				}, `已添加 ${input.name}。`);
			};
			const startEdit = (item) => {
				setEditing(item);
				setEditCategory(item.category);
				setEditDescription(item.description === "暂无简介" ? "" : item.description);
				setNotice(null);
			};
			const submitEdit = (event) => {
				event.preventDefault();
				if (api === void 0 || editing === null || editDescription.trim().length === 0) return;
				const patch = {
					category: editCategory.trim() || "未分类",
					description: editDescription.trim()
				};
				runMutation(async () => {
					await api.update(editing, patch);
					setEditing(null);
				}, `已更新 ${editing.name}。`);
			};
			const remove = (item) => {
				if (api === void 0 || !item.canDelete) return;
				if (!window.confirm(`确认删除 Skill“${item.name}”吗？此操作只会在 API 明确允许时执行。`)) return;
				runMutation(() => api.remove(item), `已删除 ${item.name}。`);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: SkillLibrarySection_module_css_default.section,
				"aria-busy": state.status === "loading" || busy,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: SkillLibrarySection_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "Skill 资料库" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "整理个人 Skill 的分类与一句话简介；实际生效范围仍由 Harness 的 Skill 目录和会话决定。" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: SkillLibrarySection_module_css_default.primaryButton,
							type: "button",
							onClick: () => {
								setAdding((value) => !value);
								setEditing(null);
							},
							children: adding ? "取消添加" : "添加 Skill"
						})]
					}),
					adding ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: SkillLibrarySection_module_css_default.formCard,
						onSubmit: submitNew,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "添加 Skill" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SkillLibrarySection_module_css_default.formGrid,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["名称", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									required: true,
									value: draft.name,
									placeholder: "例如：weekly-review",
									onChange: (event) => {
										setDraft((value) => ({
											...value,
											name: event.target.value
										}));
									}
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["分类", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: draft.category,
									placeholder: "未分类",
									onChange: (event) => {
										setDraft((value) => ({
											...value,
											category: event.target.value
										}));
									}
								})] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["一句话简介", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								required: true,
								value: draft.description,
								placeholder: "说明它在什么情况下最有用",
								onChange: (event) => {
									setDraft((value) => ({
										...value,
										description: event.target.value
									}));
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["初始内容", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								value: draft.content,
								rows: 5,
								placeholder: "Skill 的 Markdown 指令内容（可留空后再编辑）",
								onChange: (event) => {
									setDraft((value) => ({
										...value,
										content: event.target.value
									}));
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: SkillLibrarySection_module_css_default.actions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: SkillLibrarySection_module_css_default.primaryButton,
									disabled: busy,
									type: "submit",
									children: "保存"
								})
							})
						]
					}) : null,
					editing !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: SkillLibrarySection_module_css_default.formCard,
						onSubmit: submitEdit,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", { children: ["编辑 ", editing.name] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["分类", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: editCategory,
								onChange: (event) => {
									setEditCategory(event.target.value);
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["一句话简介", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								required: true,
								value: editDescription,
								onChange: (event) => {
									setEditDescription(event.target.value);
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SkillLibrarySection_module_css_default.actions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										setEditing(null);
									},
									children: "取消"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: SkillLibrarySection_module_css_default.primaryButton,
									disabled: busy,
									type: "submit",
									children: "保存修改"
								})]
							})
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: SkillLibrarySection_module_css_default.search,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "搜索" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "search",
							value: query,
							placeholder: "按名称、分类或简介搜索",
							onChange: (event) => {
								setQuery(event.target.value);
							}
						})]
					}),
					notice !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SkillLibrarySection_module_css_default.notice,
						role: "status",
						children: notice
					}) : null,
					state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SkillLibrarySection_module_css_default.status,
						children: "正在读取 Skill…"
					}) : null,
					state.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SkillLibrarySection_module_css_default.failure,
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
						className: SkillLibrarySection_module_css_default.status,
						children: "资料库中还没有 Skill。"
					}) : null,
					state.status === "ready" && state.items.length > 0 && groups.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SkillLibrarySection_module_css_default.status,
						children: "没有匹配的 Skill。"
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: SkillLibrarySection_module_css_default.groups,
						children: groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: SkillLibrarySection_module_css_default.group,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SkillLibrarySection_module_css_default.groupHeading,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: group.category }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: group.items.length })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: SkillLibrarySection_module_css_default.cards,
								children: group.items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
									className: SkillLibrarySection_module_css_default.card,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: SkillLibrarySection_module_css_default.cardCopy,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.name }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												title: item.description,
												children: item.description
											}),
											item.source !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: item.source }) : null
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: SkillLibrarySection_module_css_default.cardActions,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											disabled: !item.canEdit || busy,
											type: "button",
											onClick: () => {
												startEdit(item);
											},
											children: "编辑"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: SkillLibrarySection_module_css_default.dangerButton,
											disabled: !item.canDelete || busy,
											title: item.canDelete ? "删除" : "此 Skill 未被 API 标记为可删除",
											type: "button",
											onClick: () => {
												remove(item);
											},
											children: "删除"
										})]
									})]
								}, item.id))
							})]
						}, group.category))
					})
				]
			});
		}
		//#endregion
		//#region src/client/personalApi.ts
		/** Fail clearly when the foundation package is not mounted. */
		function requirePersonalApi(value) {
			if (typeof value !== "object" || value === null) throw new Error("personalApi service is unavailable");
			const api = value;
			if (typeof api.request !== "function") throw new Error("personalApi service has no request method");
			return api;
		}
		/** Keep all foundation-call compatibility in one small adapter. */
		async function callPersonalApi(api, method, path, body, signal) {
			return api.request(path, {
				method,
				...body === void 0 ? {} : { body },
				...signal === void 0 ? {} : { signal }
			});
		}
		//#endregion
		//#region src/client/skillApi.ts
		function record(value) {
			return typeof value === "object" && value !== null ? value : {};
		}
		function text(value, fallback = "") {
			return typeof value === "string" ? value.trim() : fallback;
		}
		function bool(value, fallback) {
			return typeof value === "boolean" ? value : fallback;
		}
		function normalizeItem(value, index) {
			const row = record(value);
			const name = text(row.name, text(row.id, `skill-${index + 1}`));
			const actions = record(row.actions);
			const canDelete = bool(row.canDelete, bool(row.deletable, bool(actions.delete, false)));
			return {
				id: text(row.id, name),
				name,
				category: text(row.category, "未分类"),
				description: text(row.description, text(row.summary, "暂无简介")),
				...text(row.source).length > 0 ? { source: text(row.source) } : {},
				canDelete,
				canEdit: bool(row.canEdit, bool(row.editable, true))
			};
		}
		function normalizeList(value) {
			const root = record(value);
			return (Array.isArray(value) ? value : Array.isArray(root.skills) ? root.skills : Array.isArray(root.items) ? root.items : []).map(normalizeItem);
		}
		/** Adapt the stable personal REST collection to the Skill page. */
		function createSkillLibraryApi(api) {
			return {
				async list(signal) {
					return normalizeList(await callPersonalApi(api, "GET", "/skills", void 0, signal));
				},
				async create(input) {
					await callPersonalApi(api, "POST", "/skills", input);
				},
				async update(item, patch) {
					await callPersonalApi(api, "PUT", "/skills", {
						id: item.id,
						name: item.name,
						...patch
					});
				},
				async remove(item) {
					await callPersonalApi(api, "DELETE", "/skills", {
						id: item.id,
						name: item.name
					});
				}
			};
		}
		//#endregion
		//#region src/client/index.ts
		/** Runtime services used by the settings contribution. */
		const inject = ["slots", "personalApi"];
		/** Register the personal Skill library as an independent Settings section. */
		function apply(ctx) {
			const api = createSkillLibraryApi(requirePersonalApi(ctx.get("personalApi")));
			const injected = () => ({ api });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "personal-skill-library",
				order: 40,
				label: "Skill 资料库",
				inject: injected
			}, SkillLibrarySection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map