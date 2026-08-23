window.__ModuleLoader__.load({
	id: "@cyrus/dsh-update-center",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:D:\Deepseek Harness Personal\plugins\update-center\src\client\UpdateCenterSection.module.css.mjs
		const css = ".RHT9Va_section{color:var(--dsw-color-text-primary,#171719);flex-direction:column;gap:18px;padding:2px 0 30px;display:flex}.RHT9Va_header{justify-content:space-between;align-items:flex-start;gap:20px;display:flex}.RHT9Va_header h2,.RHT9Va_card h3,.RHT9Va_pluginCard h3,.RHT9Va_settings h3{margin:0}.RHT9Va_header p,.RHT9Va_card p,.RHT9Va_pluginCard p{color:var(--dsw-color-text-secondary,#6b6b70);margin:6px 0 0;line-height:1.55}.RHT9Va_primary,.RHT9Va_actions .RHT9Va_primary{background:var(--dsw-color-primary,#4d6bfe);color:#fff;border-color:#0000}.RHT9Va_header button,.RHT9Va_actions button,.RHT9Va_failure button,.RHT9Va_settings button{border:1px solid color-mix(in srgb,var(--dsw-color-text-primary,#171719) 16%,transparent);cursor:pointer;border-radius:9px;padding:8px 13px}.RHT9Va_header button:disabled,.RHT9Va_actions button:disabled,.RHT9Va_settings button:disabled{cursor:not-allowed;opacity:.45}.RHT9Va_status,.RHT9Va_notice,.RHT9Va_failure{background:color-mix(in srgb,var(--dsw-color-primary,#4d6bfe) 8%,transparent);border-radius:10px;margin:0;padding:12px 14px}.RHT9Va_notice{color:#2752c8}.RHT9Va_failure,.RHT9Va_warning{color:#a43a35;background:#fff1ef}.RHT9Va_summary{border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:12px;grid-template-columns:max-content 1fr;gap:5px 16px;padding:13px 15px;display:grid}.RHT9Va_summary span{color:var(--dsw-color-text-secondary,#6b6b70)}.RHT9Va_cards{grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:14px;display:grid}.RHT9Va_card,.RHT9Va_pluginCard,.RHT9Va_settings{border:1px solid color-mix(in srgb,currentColor 11%,transparent);background:color-mix(in srgb,var(--dsw-specific-content-background,#fff) 94%,transparent);border-radius:14px;padding:17px}.RHT9Va_cardHeader{justify-content:space-between;align-items:flex-start;gap:14px;display:flex}.RHT9Va_badge{white-space:nowrap;color:#4b4d55;background:#eceef5;border-radius:999px;padding:4px 9px;font-size:12px}.RHT9Va_badge[data-status=available],.RHT9Va_badge[data-status=ready]{color:#137a3d;background:#e8f7ee}.RHT9Va_badge[data-status=error]{color:#aa322a;background:#ffebe8}.RHT9Va_badge[data-status=checking],.RHT9Va_badge[data-status=preparing]{color:#315bce;background:#edf2ff}.RHT9Va_card dl{gap:7px;margin:15px 0;display:grid}.RHT9Va_card dl div{grid-template-columns:86px minmax(0,1fr);gap:10px;display:grid}.RHT9Va_card dt{color:var(--dsw-color-text-secondary,#6b6b70)}.RHT9Va_card dd{text-overflow:ellipsis;white-space:nowrap;margin:0;overflow:hidden}.RHT9Va_detail,.RHT9Va_releaseNotes{white-space:pre-wrap;overflow-wrap:anywhere}.RHT9Va_warning{border-radius:9px;padding:10px 12px}.RHT9Va_actions{flex-wrap:wrap;gap:8px;margin-top:15px;display:flex}.RHT9Va_actions button{color:inherit;background:0 0}.RHT9Va_actions .RHT9Va_primary{background:var(--dsw-color-primary,#4d6bfe);color:#fff}.RHT9Va_pluginCard ul{gap:7px;margin:14px 0 0;padding:0;list-style:none;display:grid}.RHT9Va_pluginCard li{border-top:1px solid color-mix(in srgb,currentColor 8%,transparent);grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:9px 0;display:grid}.RHT9Va_pluginCard code{text-overflow:ellipsis;overflow:hidden}.RHT9Va_pluginCard small{color:var(--dsw-color-text-secondary,#6b6b70)}.RHT9Va_settings{gap:12px;display:grid}.RHT9Va_settings>label,.RHT9Va_settingRow label{gap:6px;display:grid}.RHT9Va_settings input,.RHT9Va_settings select{box-sizing:border-box;border:1px solid color-mix(in srgb,currentColor 18%,transparent);width:100%;color:inherit;background:0 0;border-radius:9px;padding:9px 10px}.RHT9Va_settingRow{grid-template-columns:1fr 1fr;gap:14px;display:grid}.RHT9Va_checkbox{align-self:end;align-items:center;padding:9px 0;grid-template-columns:auto 1fr!important;display:flex!important}.RHT9Va_checkbox input{width:auto}.RHT9Va_checkbox span{white-space:nowrap}@media (width<=760px){.RHT9Va_header{flex-direction:column}.RHT9Va_cards,.RHT9Va_settingRow{grid-template-columns:1fr}.RHT9Va_pluginCard li{grid-template-columns:1fr auto}.RHT9Va_pluginCard li small{grid-column:1/-1}}";
		const tagId = "@cyrus/dsh-update-center/UpdateCenterSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-update-center";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var UpdateCenterSection_module_css_default = {
			"actions": "RHT9Va_actions",
			"badge": "RHT9Va_badge",
			"card": "RHT9Va_card",
			"cardHeader": "RHT9Va_cardHeader",
			"cards": "RHT9Va_cards",
			"checkbox": "RHT9Va_checkbox",
			"detail": "RHT9Va_detail",
			"failure": "RHT9Va_failure",
			"header": "RHT9Va_header",
			"notice": "RHT9Va_notice",
			"pluginCard": "RHT9Va_pluginCard",
			"primary": "RHT9Va_primary",
			"releaseNotes": "RHT9Va_releaseNotes",
			"section": "RHT9Va_section",
			"settingRow": "RHT9Va_settingRow",
			"settings": "RHT9Va_settings",
			"status": "RHT9Va_status",
			"summary": "RHT9Va_summary",
			"warning": "RHT9Va_warning"
		};
		//#endregion
		//#region src/client/UpdateCenterSection.tsx
		const STATUS_COPY = {
			idle: "尚未检查",
			checking: "正在检查",
			current: "已是最新",
			available: "发现更新",
			blocked: "更新被兼容门阻断",
			preparing: "正在准备",
			ready: "可以安装",
			error: "检查失败",
			unsupported: "当前不可用"
		};
		function messageOf(error) {
			return error instanceof Error && error.message.trim().length > 0 ? error.message : "更新操作失败，请稍后重试。";
		}
		function shortCommit(value) {
			return value === void 0 ? "未知" : value.slice(0, 10);
		}
		function dateTime(value) {
			if (value === void 0) return "尚未检查";
			const date = new Date(value);
			return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN");
		}
		/** Settings surface for desktop releases, versioned Harness runtimes, and bundled plugins. */
		function UpdateCenterSection({ bridge }) {
			const [view, setView] = (0, react.useState)({ status: "loading" });
			const [busy, setBusy] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const load = async () => {
				if (bridge === void 0) {
					setView({
						status: "error",
						message: "桌面更新服务尚未挂载。"
					});
					return;
				}
				try {
					const value = await bridge.getState();
					setView({
						status: "ready",
						value
					});
					setDraft(value.settings);
				} catch (error) {
					setView({
						status: "error",
						message: messageOf(error)
					});
				}
			};
			(0, react.useEffect)(() => {
				load();
			}, [bridge]);
			const run = async (label, operation, success) => {
				setBusy(label);
				setNotice(null);
				try {
					const result = await operation();
					if (result !== void 0) {
						setView({
							status: "ready",
							value: result
						});
						setDraft(result.settings);
					}
					setNotice(success);
				} catch (error) {
					setNotice(messageOf(error));
				} finally {
					setBusy(null);
				}
			};
			const save = (event) => {
				event.preventDefault();
				if (bridge === void 0 || draft === null) return;
				run("save", () => bridge.configure(draft), "更新设置已保存。");
			};
			const state = view.status === "ready" ? view.value : void 0;
			const desktopSummary = (0, react.useMemo)(() => {
				if (state === void 0) return "";
				return state.desktop.latestVersion === void 0 ? `当前 ${state.desktop.currentVersion}` : `当前 ${state.desktop.currentVersion} · 最新 ${state.desktop.latestVersion}`;
			}, [state]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: UpdateCenterSection_module_css_default.section,
				"aria-busy": busy !== null || view.status === "loading",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: UpdateCenterSection_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "更新中心" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "分别管理桌面客户端、Harness 运行时和随客户端发布的个人插件。" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: UpdateCenterSection_module_css_default.primary,
							disabled: bridge === void 0 || busy !== null,
							type: "button",
							onClick: () => {
								if (bridge !== void 0) run("check", () => bridge.check(), "检查完成。");
							},
							children: "检查更新"
						})]
					}),
					view.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: UpdateCenterSection_module_css_default.status,
						children: "正在读取更新状态…"
					}) : null,
					view.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: UpdateCenterSection_module_css_default.failure,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							children: view.message
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								load();
							},
							children: "重试"
						})]
					}) : null,
					notice !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: UpdateCenterSection_module_css_default.notice,
						role: "status",
						children: notice
					}) : null,
					state !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: UpdateCenterSection_module_css_default.summary,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "最近检查" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: dateTime(state.lastCheckedAt) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "更新策略" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "发现后提示，由你确认下载和重启" })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: UpdateCenterSection_module_css_default.cards,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
								className: UpdateCenterSection_module_css_default.card,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: UpdateCenterSection_module_css_default.cardHeader,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Personal 客户端" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: desktopSummary })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusBadge, { status: state.desktop.status })]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "分发形态" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: state.desktop.packaging === "nsis" ? "Windows 安装版" : state.desktop.packaging === "portable" ? "Portable" : "开发环境" })] }), state.desktop.publishedAt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "发布时间" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: dateTime(state.desktop.publishedAt) })] }) : null] }),
									state.desktop.message !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: UpdateCenterSection_module_css_default.detail,
										children: state.desktop.message
									}) : null,
									state.desktop.releaseNotes !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "更新说明" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: UpdateCenterSection_module_css_default.releaseNotes,
										children: state.desktop.releaseNotes
									})] }) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: UpdateCenterSection_module_css_default.actions,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												disabled: busy !== null || state.desktop.releaseUrl === void 0,
												type: "button",
												onClick: () => {
													if (bridge !== void 0) run("open-desktop", async () => {
														await bridge.openRelease("desktop");
													}, "已打开版本页面。");
												},
												children: "版本页面"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												disabled: busy !== null || !state.desktop.canDownload,
												type: "button",
												onClick: () => {
													if (bridge !== void 0) run("download", () => bridge.downloadDesktop(), "更新已下载。");
												},
												children: "下载更新"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: UpdateCenterSection_module_css_default.primary,
												disabled: busy !== null || !state.desktop.canInstall,
												type: "button",
												onClick: () => {
													if (bridge !== void 0) run("install", () => bridge.installDesktop(), "正在退出并安装更新。");
												},
												children: "重启安装"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												disabled: busy !== null || !state.desktop.canRollbackDesktop,
												type: "button",
												onClick: () => {
													if (bridge !== void 0 && window.confirm("确认重装上一已知良好客户端吗？")) run("rollback-desktop", () => bridge.rollbackDesktop(), "正在退出并回滚客户端。");
												},
												children: "回滚客户端"
											})
										]
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
								className: UpdateCenterSection_module_css_default.card,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: UpdateCenterSection_module_css_default.cardHeader,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "DeepSeek Harness" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
											shortCommit(state.harness.currentCommit),
											" → ",
											shortCommit(state.harness.remoteCommit)
										] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusBadge, { status: state.harness.status })]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "当前目录" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
										title: state.harness.sourceRoot,
										children: state.harness.sourceRoot
									})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "安全方式" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: "独立版本目录准备，验证后重启切换" })] })] }),
									state.harness.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: UpdateCenterSection_module_css_default.warning,
										children: "当前上游存在 tracked 修改；更新中心不会覆盖它。"
									}) : null,
									state.harness.message !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: UpdateCenterSection_module_css_default.detail,
										children: state.harness.message
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: UpdateCenterSection_module_css_default.actions,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												disabled: busy !== null,
												type: "button",
												onClick: () => {
													if (bridge !== void 0) run("open-harness", async () => {
														await bridge.openRelease("harness");
													}, "已打开 Harness 项目页面。");
												},
												children: "项目页面"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												disabled: busy !== null || !state.harness.canPrepare,
												type: "button",
												onClick: () => {
													if (bridge !== void 0) run("prepare", () => bridge.prepareHarness(), "新运行时已下载并通过准备检查。");
												},
												children: "下载并验证"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: UpdateCenterSection_module_css_default.primary,
												disabled: busy !== null || !state.harness.canActivate,
												type: "button",
												onClick: () => {
													if (bridge !== void 0 && window.confirm("切换 Harness 版本需要关闭当前会话并重启客户端，是否继续？")) run("activate", () => bridge.activateHarness(), "正在重启并切换 Harness。");
												},
												children: "切换并重启"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												disabled: busy !== null || !state.harness.canRollback,
												type: "button",
												onClick: () => {
													if (bridge !== void 0 && window.confirm("确认回到上一套已验证的 Harness 运行时吗？")) run("rollback", () => bridge.rollbackHarness(), "正在重启并回滚 Harness。");
												},
												children: "回滚"
											})
										]
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
							className: UpdateCenterSection_module_css_default.pluginCard,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: UpdateCenterSection_module_css_default.cardHeader,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "个人插件" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "内置集合与独立更新通道分开显示；下载验证通过后重启整批激活。" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusBadge, { status: state.pluginChannel?.status ?? "idle" })]
								}),
								state.pluginChannel?.message !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: UpdateCenterSection_module_css_default.detail,
									children: state.pluginChannel.message
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: state.plugins.map((plugin) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: plugin.packageName }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: plugin.version }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: plugin.updateWithDesktop ? "随客户端更新" : "独立更新源" })
								] }, plugin.packageName)) }),
								state.pluginChannel?.available !== void 0 && state.pluginChannel.available.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "可更新插件" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: state.pluginChannel.available.map((plugin) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: plugin.packageName }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										plugin.currentVersion ?? "未安装",
										" → ",
										plugin.version
									] })] }, plugin.packageName)) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: UpdateCenterSection_module_css_default.actions,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: UpdateCenterSection_module_css_default.primary,
											disabled: busy !== null,
											type: "button",
											onClick: () => {
												if (bridge !== void 0) run("prepare-plugin", () => bridge.preparePluginGeneration(), "插件 generation 已准备，重启后激活。");
											},
											children: "下载并准备插件更新"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											disabled: busy !== null || !state.pluginChannel.canRollback,
											type: "button",
											onClick: () => {
												if (bridge !== void 0 && window.confirm("确认回滚到上一外部 generation 或内置插件基线吗？")) run("rollback-plugin", () => bridge.rollbackPluginGeneration(), "回滚已记录，重启后生效。");
											},
											children: "回滚插件"
										})]
									})
								] }) : null,
								state.pluginChannel?.blocked !== void 0 && state.pluginChannel.blocked.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "被兼容门阻断" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: state.pluginChannel.blocked.map((plugin) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: plugin.packageName }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										plugin.currentVersion ?? "未安装",
										" → ",
										plugin.version
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: plugin.blockedReason })
								] }, plugin.packageName)) })] }) : null
							]
						}),
						draft !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
							className: UpdateCenterSection_module_css_default.settings,
							onSubmit: save,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "更新设置" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["Personal GitHub 仓库", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: draft.desktopRepository,
									placeholder: "owner/repository；发布仓库建立后填写",
									onChange: (event) => {
										setDraft((value) => value === null ? value : {
											...value,
											desktopRepository: event.target.value
										});
									}
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["插件 GitHub 仓库", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: draft.pluginRepository,
									placeholder: "owner/repository；留空则只使用本地 fixture/内置",
									onChange: (event) => {
										setDraft((value) => value === null ? value : {
											...value,
											pluginRepository: event.target.value
										});
									}
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["Harness GitHub 仓库", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									readOnly: true,
									value: draft.harnessRepository,
									title: "为避免执行任意仓库脚本，此来源固定为官方仓库。"
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: UpdateCenterSection_module_css_default.settingRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["通道", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										value: draft.channel,
										onChange: (event) => {
											setDraft((value) => value === null ? value : {
												...value,
												channel: event.target.value
											});
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "stable",
											children: "稳定版"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "beta",
											children: "测试版"
										})]
									})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: UpdateCenterSection_module_css_default.checkbox,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											checked: draft.autoCheck,
											type: "checkbox",
											onChange: (event) => {
												setDraft((value) => value === null ? value : {
													...value,
													autoCheck: event.target.checked
												});
											}
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "启动后自动检查" })]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: UpdateCenterSection_module_css_default.actions,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: UpdateCenterSection_module_css_default.primary,
										disabled: busy !== null,
										type: "submit",
										children: "保存设置"
									})
								})
							]
						}) : null
					] }) : null
				]
			});
		}
		function StatusBadge({ status }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: UpdateCenterSection_module_css_default.badge,
				"data-status": status,
				children: STATUS_COPY[status]
			});
		}
		//#endregion
		//#region src/client/desktopBridge.ts
		/** Resolve the narrow context-isolated update bridge exposed by the desktop shell. */
		function requireUpdateBridge() {
			const bridge = window.deepseekHarnessPersonal?.updates;
			if (bridge === void 0) throw new Error("更新服务只在 DeepSeek Harness Personal 桌面客户端中可用。");
			return bridge;
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots"];
		/** Register the desktop update center in Settings. */
		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "personal-update-center",
				order: 80,
				label: "更新中心",
				inject: () => ({ bridge: requireUpdateBridge() })
			}, UpdateCenterSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map