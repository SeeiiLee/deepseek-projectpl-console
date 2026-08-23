window.__ModuleLoader__.load({
	id: "@cyrus/dsh-desktop-integration",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:D:\Deepseek Harness Personal\plugins\desktop-integration\src\client\DesktopIntegrationSection.module.css.mjs
		const css = ".iVtX0G_section{color:var(--dsw-color-text-primary,#171719);flex-direction:column;gap:16px;padding:2px 0 30px;display:flex}.iVtX0G_section header{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}.iVtX0G_section h2,.iVtX0G_section h3,.iVtX0G_section p{margin:0}.iVtX0G_section header p,.iVtX0G_section article p{color:var(--dsw-color-text-secondary,#6b6b70);margin-top:6px;line-height:1.5}.iVtX0G_builtin{color:#315ac5;background:#e8f1ff;border-radius:999px;padding:5px 10px;font-size:12px}.iVtX0G_notice,.iVtX0G_error{color:#315ac5;background:#edf2ff;border-radius:9px;padding:11px 13px}.iVtX0G_error{color:#a43a35;background:#ffefec}.iVtX0G_identity{border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:13px;align-items:center;gap:12px;padding:14px;display:flex}.iVtX0G_identity>div:last-child{gap:4px;display:grid}.iVtX0G_identity span{color:var(--dsw-color-text-secondary,#6b6b70)}.iVtX0G_mark{color:#fff;background:linear-gradient(145deg,#744dff,#00c8e8);border-radius:13px;place-items:center;width:46px;height:46px;font-size:24px;font-weight:800;display:grid}.iVtX0G_grid{grid-template-columns:1fr 1fr;gap:14px;display:grid}.iVtX0G_grid article,.iVtX0G_shortcuts{border:1px solid color-mix(in srgb,currentColor 10%,transparent);background:color-mix(in srgb,var(--dsw-specific-content-background,#fff) 95%,transparent);border-radius:13px;padding:16px}.iVtX0G_section label{align-items:center;gap:8px;margin-top:14px;display:flex}.iVtX0G_section input{accent-color:var(--dsw-color-primary,#4d6bfe)}.iVtX0G_section dl{gap:6px;margin:14px 0 0;display:grid}.iVtX0G_section dl div{justify-content:space-between;gap:16px;display:flex}.iVtX0G_section dt{color:var(--dsw-color-text-secondary,#6b6b70)}.iVtX0G_section dd{margin:0}.iVtX0G_shortcuts>.iVtX0G_options{flex-wrap:wrap;align-items:center;gap:13px;margin-top:13px;display:flex}.iVtX0G_options label{margin:0}.iVtX0G_options button{border:1px solid color-mix(in srgb,currentColor 16%,transparent);color:inherit;cursor:pointer;background:0 0;border-radius:9px;margin-left:auto;padding:8px 12px}.iVtX0G_options button:disabled{cursor:not-allowed;opacity:.45}.iVtX0G_shortcuts ul{gap:7px;margin:14px 0 0;padding:0;list-style:none;display:grid}.iVtX0G_shortcuts li{border-top:1px solid color-mix(in srgb,currentColor 8%,transparent);grid-template-columns:70px minmax(0,1fr) auto;gap:10px;padding-top:9px;display:grid}.iVtX0G_shortcuts code{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.iVtX0G_shortcuts small{color:var(--dsw-color-text-secondary,#6b6b70)}@media (width<=760px){.iVtX0G_grid,.iVtX0G_shortcuts li{grid-template-columns:1fr}.iVtX0G_options button{margin-left:0}}";
		const tagId = "@cyrus/dsh-desktop-integration/DesktopIntegrationSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-desktop-integration";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var DesktopIntegrationSection_module_css_default = {
			"builtin": "iVtX0G_builtin",
			"error": "iVtX0G_error",
			"grid": "iVtX0G_grid",
			"identity": "iVtX0G_identity",
			"mark": "iVtX0G_mark",
			"notice": "iVtX0G_notice",
			"options": "iVtX0G_options",
			"section": "iVtX0G_section",
			"shortcuts": "iVtX0G_shortcuts"
		};
		//#endregion
		//#region src/client/DesktopIntegrationSection.tsx
		function messageOf(error) {
			return error instanceof Error && error.message.trim() !== "" ? error.message : "桌面设置操作失败。";
		}
		/** Native desktop settings and process-guardian status. */
		function DesktopIntegrationSection({ bridge }) {
			const [state, setState] = (0, react.useState)({ status: "loading" });
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(null);
			const load = async () => {
				if (bridge === void 0) {
					setState({
						status: "error",
						message: "桌面集成服务尚未挂载。"
					});
					return;
				}
				try {
					setState({
						status: "ready",
						value: await bridge.getState()
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
			}, [bridge]);
			const configure = async (patch) => {
				if (bridge === void 0 || state.status !== "ready") return;
				setBusy(true);
				setNotice(null);
				try {
					const current = state.value;
					setState({
						status: "ready",
						value: await bridge.configure({
							closeToTray: patch.closeToTray ?? current.closeToTray,
							maintainShortcuts: patch.maintainShortcuts ?? current.maintainShortcuts
						})
					});
					setNotice("桌面设置已保存。");
				} catch (error) {
					setNotice(messageOf(error));
				} finally {
					setBusy(false);
				}
			};
			const repair = async () => {
				if (bridge === void 0) return;
				setBusy(true);
				setNotice(null);
				try {
					setState({
						status: "ready",
						value: await bridge.repairShortcuts()
					});
					setNotice("快捷方式检查完成。");
				} catch (error) {
					setNotice(messageOf(error));
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: DesktopIntegrationSection_module_css_default.section,
				"aria-busy": busy || state.status === "loading",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "桌面集成" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "管理托盘、快捷方式和退出时的后台进程清理。" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: DesktopIntegrationSection_module_css_default.builtin,
						children: "内置必需"
					})] }),
					notice !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DesktopIntegrationSection_module_css_default.notice,
						role: "status",
						children: notice
					}) : null,
					state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "正在读取桌面状态…" }) : null,
					state.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DesktopIntegrationSection_module_css_default.error,
						role: "alert",
						children: state.message
					}) : null,
					state.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DesktopIntegrationSection_module_css_default.identity,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DesktopIntegrationSection_module_css_default.mark,
								children: "H"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: state.value.appName }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								state.value.appVersion,
								" · ",
								state.value.packaging === "nsis" ? "安装版" : state.value.packaging === "portable" ? "Portable" : "开发环境"
							] })] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DesktopIntegrationSection_module_css_default.grid,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "托盘行为" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: state.value.trayAvailable ? "托盘图标已启动，可快速显示、隐藏或退出。" : "当前环境没有可用托盘。" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									checked: state.value.closeToTray,
									disabled: busy || !state.value.trayAvailable,
									type: "checkbox",
									onChange: (event) => {
										configure({ closeToTray: event.target.checked });
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "关闭窗口时最小化到托盘" })] })
							] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "进程守护" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: state.value.processGuardian.strategy === "windows-job-object" ? "Windows Job Object 已接管 Helper 进程树；应用异常关闭时也会清理。" : "使用 Harness 优雅退出和 PID 进程树强制清理。" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "守护状态" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: state.value.processGuardian.active ? "运行中" : "未启动" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Helper" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: state.value.processGuardian.helperAssigned ? "已纳入守护" : "等待启动" })] })] })
							] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
							className: DesktopIntegrationSection_module_css_default.shortcuts,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "快捷方式维护" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "只维护带有本应用所有权标记的快捷方式，不覆盖同名的其他应用链接。" })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: DesktopIntegrationSection_module_css_default.options,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											checked: state.value.maintainShortcuts.desktop,
											disabled: busy || state.value.packaging === "development",
											type: "checkbox",
											onChange: (event) => {
												configure({ maintainShortcuts: {
													...state.value.maintainShortcuts,
													desktop: event.target.checked
												} });
											}
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "桌面" })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											checked: state.value.maintainShortcuts.startMenu,
											disabled: busy || state.value.packaging === "development",
											type: "checkbox",
											onChange: (event) => {
												configure({ maintainShortcuts: {
													...state.value.maintainShortcuts,
													startMenu: event.target.checked
												} });
											}
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "开始菜单" })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											disabled: busy || state.value.packaging === "development",
											type: "button",
											onClick: () => {
												repair();
											},
											children: "立即检查并修复"
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: state.value.shortcuts.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.location === "desktop" ? "桌面" : "开始菜单" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										title: item.path,
										children: item.path
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: item.exists ? item.managed ? "由本应用维护" : "已存在但不属于本应用" : "尚未创建" })
								] }, item.location)) })
							]
						})
					] }) : null
				]
			});
		}
		//#endregion
		//#region src/client/desktopBridge.ts
		function requireDesktopBridge() {
			const bridge = window.deepseekHarnessPersonal?.desktop;
			if (bridge === void 0) throw new Error("桌面集成服务只在 Personal 客户端中可用。");
			return bridge;
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots"];
		/** Register desktop-native controls as one visible built-in plugin surface. */
		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "personal-desktop-integration",
				order: 70,
				label: "桌面集成",
				inject: () => ({ bridge: requireDesktopBridge() })
			}, DesktopIntegrationSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map