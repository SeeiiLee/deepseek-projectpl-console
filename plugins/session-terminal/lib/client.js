window.__ModuleLoader__.load({
	id: "@cyrus/dsh-session-terminal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:D:\Deepseek Harness Personal\plugins\session-terminal\src\client\SessionTerminalDock.module.css.mjs
		const css = ".E-X8RW_dockCollapsed,.E-X8RW_dockExpanded{color:var(--dsw-alias-label-primary);justify-content:flex-end;font-size:12px;display:flex;position:absolute;bottom:12px;left:clamp(72px,20vw,330px);right:16px}.E-X8RW_dockCollapsed{left:auto}.E-X8RW_collapsedButton{border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, transparent);min-height:34px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;backdrop-filter:blur(14px);border-radius:999px;align-items:center;gap:8px;padding:7px 12px;display:flex;box-shadow:0 8px 24px #0000002e}.E-X8RW_collapsedButton i{background:var(--dsw-alias-state-success-primary);width:6px;height:6px;box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 15%, transparent);border-radius:50%}.E-X8RW_collapsedButton:disabled{cursor:not-allowed;opacity:.55}.E-X8RW_panel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:13px;grid-template-rows:auto minmax(0,1fr) auto auto;width:100%;height:min(360px,100vh - 110px);display:grid;overflow:hidden;box-shadow:0 18px 46px #00000047}.E-X8RW_header{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:6px 8px;display:flex}.E-X8RW_tabs,.E-X8RW_headerActions{align-items:center;gap:4px;min-width:0;display:flex}.E-X8RW_tabs{flex:auto;overflow-x:auto}.E-X8RW_tab,.E-X8RW_activeTab,.E-X8RW_addTab,.E-X8RW_headerActions button,.E-X8RW_composer button,.E-X8RW_empty button{color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:1px solid #0000;border-radius:7px}.E-X8RW_tab,.E-X8RW_activeTab{flex:none;align-items:center;gap:7px;max-width:170px;min-height:28px;padding:4px 6px 4px 9px;display:flex}.E-X8RW_activeTab{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.E-X8RW_tab span,.E-X8RW_activeTab span{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.E-X8RW_tab i,.E-X8RW_activeTab i{background:var(--dsw-alias-label-tertiary);border-radius:50%;flex:none;width:6px;height:6px}.E-X8RW_tab i[data-status=running],.E-X8RW_activeTab i[data-status=running]{background:var(--dsw-alias-state-success-primary)}.E-X8RW_tab i[data-status=failed],.E-X8RW_activeTab i[data-status=failed]{background:var(--dsw-alias-state-error-primary)}.E-X8RW_addTab,.E-X8RW_headerActions button{min-width:28px;min-height:28px;padding:4px 7px}.E-X8RW_headerActions{flex:none}.E-X8RW_headerActions>span{max-width:170px;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.E-X8RW_addTab:hover:not(:disabled),.E-X8RW_headerActions button:hover:not(:disabled),.E-X8RW_composer button:hover:not(:disabled),.E-X8RW_empty button:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}.E-X8RW_outputWrap{background:var(--dsw-alias-bg-base);min-height:0;position:relative}.E-X8RW_output{box-sizing:border-box;width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary);tab-size:4;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;outline:none;margin:0;padding:14px 16px 34px;font-family:Cascadia Mono,Cascadia Code,Consolas,monospace;font-size:12px;line-height:19px;overflow:auto}.E-X8RW_connectionState{pointer-events:none;gap:8px;display:flex;position:absolute;bottom:7px;right:10px}.E-X8RW_connectionState span{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 88%, transparent);color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:3px 7px;font-size:10px}.E-X8RW_connectionState span[data-kind=warning]{color:var(--dsw-alias-state-warning-primary)}.E-X8RW_connectionState span[data-kind=error]{color:var(--dsw-alias-state-error-primary)}.E-X8RW_composer{border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 10px;display:grid}.E-X8RW_promptMark{color:var(--dsw-alias-state-business-primary);flex:none;font-family:Cascadia Mono,Consolas,monospace;font-weight:700}.E-X8RW_composer textarea{box-sizing:border-box;resize:vertical;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);width:100%;min-height:30px;max-height:76px;color:var(--dsw-alias-label-primary);border-radius:7px;outline:none;padding:6px 8px;font-family:Cascadia Mono,Consolas,monospace;font-size:12px;line-height:17px}.E-X8RW_composer textarea:focus{border-color:var(--dsw-alias-state-business-primary)}.E-X8RW_composer button,.E-X8RW_empty button{min-height:30px;padding:5px 10px}.E-X8RW_empty{min-height:0;color:var(--dsw-alias-label-tertiary);flex-direction:column;justify-content:center;align-items:center;gap:8px;display:flex}.E-X8RW_empty p,.E-X8RW_notice{margin:0}.E-X8RW_notice{border-top:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);color:var(--dsw-alias-state-error-primary);padding:6px 10px;font-size:11px}.E-X8RW_dockExpanded button:disabled,.E-X8RW_dockExpanded textarea:disabled{cursor:not-allowed;opacity:.5}@media (width<=820px){.E-X8RW_dockExpanded{left:68px}.E-X8RW_headerActions>span,.E-X8RW_headerActions button:not(:last-child){display:none}}";
		const tagId = "@cyrus/dsh-session-terminal/SessionTerminalDock.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-session-terminal";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SessionTerminalDock_module_css_default = {
			"activeTab": "E-X8RW_activeTab",
			"addTab": "E-X8RW_addTab",
			"collapsedButton": "E-X8RW_collapsedButton",
			"composer": "E-X8RW_composer",
			"connectionState": "E-X8RW_connectionState",
			"dockCollapsed": "E-X8RW_dockCollapsed",
			"dockExpanded": "E-X8RW_dockExpanded",
			"empty": "E-X8RW_empty",
			"header": "E-X8RW_header",
			"headerActions": "E-X8RW_headerActions",
			"notice": "E-X8RW_notice",
			"output": "E-X8RW_output",
			"outputWrap": "E-X8RW_outputWrap",
			"panel": "E-X8RW_panel",
			"promptMark": "E-X8RW_promptMark",
			"tab": "E-X8RW_tab",
			"tabs": "E-X8RW_tabs"
		};
		//#endregion
		//#region src/client/SessionTerminalDock.tsx
		const EMPTY_OUTPUT = {
			cursor: 0,
			text: "",
			reconnecting: false,
			truncated: false
		};
		const CLIENT_OUTPUT_LIMIT = 786432;
		/** Floating bottom dock whose Host-side PTYs survive this component and its HTTP connection. */
		function SessionTerminalDock({ api, useSessions }) {
			const sessionId = useSessions((state) => state.current);
			const sessionCwd = useSessions((state) => state.current === void 0 ? void 0 : state.byId[state.current]?.cwd);
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [tabs, setTabs] = (0, react.useState)([]);
			const [activeId, setActiveId] = (0, react.useState)();
			const [outputs, setOutputs] = (0, react.useState)({});
			const [draft, setDraft] = (0, react.useState)("");
			const [historyIndex, setHistoryIndex] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)();
			const outputRef = (0, react.useRef)(null);
			const shouldFollowOutput = (0, react.useRef)(true);
			const cursorRef = (0, react.useRef)({});
			const active = (0, react.useMemo)(() => tabs.find((tab) => tab.terminalId === activeId), [activeId, tabs]);
			const output = activeId === void 0 ? EMPTY_OUTPUT : outputs[activeId] ?? EMPTY_OUTPUT;
			(0, react.useEffect)(() => {
				let cancelled = false;
				setTabs([]);
				setActiveId(void 0);
				setNotice(void 0);
				setDraft("");
				setHistoryIndex(void 0);
				if (sessionId === void 0) return () => {
					cancelled = true;
				};
				api.list(sessionId).then((items) => {
					if (cancelled) return;
					setTabs(items);
					setActiveId((current) => items.some((item) => item.terminalId === current) ? current : items[0]?.terminalId);
				}).catch((error) => {
					if (!cancelled) setNotice(messageOf(error));
				});
				return () => {
					cancelled = true;
				};
			}, [api, sessionId]);
			(0, react.useEffect)(() => {
				if (sessionId === void 0 || activeId === void 0) return;
				let cancelled = false;
				let timer;
				const tick = async () => {
					try {
						const result = await api.read(sessionId, activeId, cursorRef.current[activeId] ?? 0);
						if (cancelled) return;
						cursorRef.current[activeId] = result.cursor;
						setTabs((items) => replaceTab(items, result.terminal));
						setOutputs((current) => {
							const previous = current[activeId] ?? EMPTY_OUTPUT;
							const nextText = result.truncated ? result.output : previous.text + result.output;
							return {
								...current,
								[activeId]: {
									cursor: result.cursor,
									text: tail(nextText, CLIENT_OUTPUT_LIMIT),
									reconnecting: false,
									truncated: previous.truncated || result.truncated
								}
							};
						});
					} catch (_temporaryDisconnect) {
						if (!cancelled) setOutputs((current) => ({
							...current,
							[activeId]: {
								...current[activeId] ?? EMPTY_OUTPUT,
								reconnecting: true
							}
						}));
					} finally {
						if (!cancelled) timer = setTimeout(() => {
							tick();
						}, expanded ? 350 : 1500);
					}
				};
				tick();
				return () => {
					cancelled = true;
					if (timer !== void 0) clearTimeout(timer);
				};
			}, [
				activeId,
				api,
				expanded,
				sessionId
			]);
			(0, react.useEffect)(() => {
				const element = outputRef.current;
				if (element !== null && shouldFollowOutput.current) element.scrollTop = element.scrollHeight;
			}, [output.text]);
			const run = async (operation) => {
				setBusy(true);
				setNotice(void 0);
				try {
					await operation();
				} catch (error) {
					setNotice(messageOf(error));
				} finally {
					setBusy(false);
				}
			};
			const createTab = () => {
				if (sessionId === void 0) return;
				run(async () => {
					const terminal = await api.open(sessionId);
					cursorRef.current[terminal.terminalId] = 0;
					setTabs((items) => [...items, terminal]);
					setActiveId(terminal.terminalId);
					setExpanded(true);
				});
			};
			const toggle = () => {
				if (sessionId === void 0) return;
				if (!expanded && tabs.length === 0) createTab();
				else setExpanded((value) => !value);
			};
			const send = () => {
				if (sessionId === void 0 || active === void 0 || draft.length === 0 || active.status.kind !== "running") return;
				const command = draft;
				setDraft("");
				setHistoryIndex(void 0);
				run(async () => {
					const terminal = await api.write(sessionId, active.terminalId, command);
					setTabs((items) => replaceTab(items, terminal));
				});
			};
			const onInputKeyDown = (event) => {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					send();
					return;
				}
				if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
				const history = active?.history ?? [];
				if (history.length === 0) return;
				event.preventDefault();
				const next = event.key === "ArrowUp" ? Math.max(0, historyIndex === void 0 ? history.length - 1 : historyIndex - 1) : historyIndex === void 0 ? void 0 : historyIndex + 1 >= history.length ? void 0 : historyIndex + 1;
				setHistoryIndex(next);
				setDraft(next === void 0 ? "" : history[next] ?? "");
			};
			const clear = () => {
				if (sessionId === void 0 || active === void 0) return;
				run(async () => {
					const result = await api.clear(sessionId, active.terminalId);
					cursorRef.current[active.terminalId] = result.cursor;
					setOutputs((current) => ({
						...current,
						[active.terminalId]: {
							cursor: result.cursor,
							text: "",
							reconnecting: false,
							truncated: false
						}
					}));
				});
			};
			const restart = () => {
				if (sessionId === void 0 || active === void 0) return;
				if (!window.confirm(`确认重启“${active.name}”吗？正在运行的命令会结束。`)) return;
				run(async () => {
					const terminal = await api.restart(sessionId, active.terminalId);
					cursorRef.current[active.terminalId] = 0;
					setOutputs((current) => ({
						...current,
						[active.terminalId]: EMPTY_OUTPUT
					}));
					setTabs((items) => replaceTab(items, terminal));
				});
			};
			const close = (terminal) => {
				if (sessionId === void 0) return;
				if (!window.confirm(`确认关闭“${terminal.name}”吗？其中的进程会一并结束。`)) return;
				run(async () => {
					await api.close(sessionId, terminal.terminalId);
					setTabs((items) => {
						const next = items.filter((item) => item.terminalId !== terminal.terminalId);
						setActiveId((current) => current === terminal.terminalId ? next[0]?.terminalId : current);
						return next;
					});
					setOutputs((current) => {
						const next = { ...current };
						delete next[terminal.terminalId];
						return next;
					});
					delete cursorRef.current[terminal.terminalId];
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: expanded ? SessionTerminalDock_module_css_default.dockExpanded : SessionTerminalDock_module_css_default.dockCollapsed,
				"aria-label": "会话 PowerShell",
				children: !expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					className: SessionTerminalDock_module_css_default.collapsedButton,
					type: "button",
					disabled: sessionId === void 0 || busy,
					onClick: toggle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: SessionTerminalDock_module_css_default.promptMark,
							children: ">_"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: sessionId === void 0 ? "选择会话后使用终端" : tabs.length === 0 ? "打开 PowerShell" : `${tabs.length} 个 PowerShell` }),
						tabs.some((tab) => tab.status.kind === "running") ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { "aria-label": "终端正在运行" }) : null
					]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: SessionTerminalDock_module_css_default.panel,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: SessionTerminalDock_module_css_default.header,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SessionTerminalDock_module_css_default.tabs,
								role: "tablist",
								"aria-label": "PowerShell 标签页",
								children: [tabs.map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									className: tab.terminalId === activeId ? SessionTerminalDock_module_css_default.activeTab : SessionTerminalDock_module_css_default.tab,
									type: "button",
									role: "tab",
									"aria-selected": tab.terminalId === activeId,
									title: tab.cwd,
									onClick: () => {
										setActiveId(tab.terminalId);
										setHistoryIndex(void 0);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tab.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { "data-status": tab.status.kind })]
								}, tab.terminalId)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: SessionTerminalDock_module_css_default.addTab,
									type: "button",
									disabled: busy || sessionId === void 0,
									"aria-label": "新建 PowerShell",
									onClick: createTab,
									children: "＋"
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SessionTerminalDock_module_css_default.headerActions,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										title: sessionCwd,
										children: shortPath(sessionCwd)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: busy || active?.status.kind !== "running",
										onClick: () => {
											if (sessionId !== void 0 && active !== void 0) run(async () => {
												await api.interrupt(sessionId, active.terminalId);
											});
										},
										children: "中断"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: busy || active === void 0,
										onClick: clear,
										children: "清屏"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: busy || active === void 0,
										onClick: restart,
										children: "重启"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled: busy || active === void 0,
										onClick: () => {
											if (active !== void 0) close(active);
										},
										children: "关闭"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-label": "收起终端",
										onClick: () => {
											setExpanded(false);
										},
										children: "⌄"
									})
								]
							})]
						}),
						active === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: SessionTerminalDock_module_css_default.empty,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前会话还没有终端。" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: busy,
								onClick: createTab,
								children: "新建 PowerShell"
							})]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: SessionTerminalDock_module_css_default.outputWrap,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								ref: outputRef,
								className: SessionTerminalDock_module_css_default.output,
								tabIndex: 0,
								onScroll: (event) => {
									const element = event.currentTarget;
									shouldFollowOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 36;
								},
								children: output.text || "PowerShell 已连接，输入命令后按 Enter。"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SessionTerminalDock_module_css_default.connectionState,
								children: [
									output.reconnecting ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"data-kind": "warning",
										children: "连接中断，正在按游标重连…"
									}) : null,
									output.truncated ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"data-kind": "warning",
										children: "较早输出已超出缓冲区。"
									}) : null,
									active.status.kind === "exited" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										"进程已退出（",
										active.status.exitCode ?? active.status.signal ?? "未知状态",
										"）"
									] }) : null,
									active.status.kind === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"data-kind": "error",
										children: active.status.message
									}) : null
								]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: SessionTerminalDock_module_css_default.composer,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: SessionTerminalDock_module_css_default.promptMark,
									children: "PS"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									rows: 1,
									value: draft,
									disabled: busy || active.status.kind !== "running",
									"aria-label": "PowerShell 命令",
									placeholder: active.status.kind === "running" ? "输入命令；Shift+Enter 换行" : "终端未运行，请重启",
									onChange: (event) => {
										setDraft(event.target.value);
										setHistoryIndex(void 0);
									},
									onKeyDown: onInputKeyDown
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: busy || draft.length === 0 || active.status.kind !== "running",
									onClick: send,
									children: "运行"
								})
							]
						})] }),
						notice !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: SessionTerminalDock_module_css_default.notice,
							role: "status",
							children: notice
						}) : null
					]
				})
			});
		}
		function replaceTab(items, next) {
			return items.map((item) => item.terminalId === next.terminalId ? next : item);
		}
		function messageOf(error) {
			return error instanceof Error && error.message.trim() !== "" ? error.message : "终端操作失败。";
		}
		function tail(value, limit) {
			return value.length <= limit ? value : value.slice(-limit);
		}
		function shortPath(value) {
			if (value === void 0 || value === "") return "无工作区";
			const parts = value.split(/[\\/]/u).filter(Boolean);
			return parts.length <= 2 ? value : `…\\${parts.slice(-2).join("\\")}`;
		}
		//#endregion
		//#region src/client/terminalApi.ts
		const API_PREFIX = "/__personal/terminal";
		/** Same-origin JSON client; the custom header prevents ordinary cross-origin form posts. */
		function createSessionTerminalApi(fetchImpl = fetch) {
			const request = async (path, init) => {
				const response = await fetchImpl(API_PREFIX + path, {
					...init,
					cache: "no-store",
					headers: {
						"x-dsh-personal-terminal": "1",
						...init?.body === void 0 ? {} : { "content-type": "application/json" },
						...init?.headers
					}
				});
				const envelope = await response.json();
				if (!response.ok || !envelope.ok || envelope.data === void 0) throw new Error(envelope.error?.message ?? `终端请求失败（HTTP ${response.status}）。`);
				return envelope.data;
			};
			const mutate = (path, method, body) => request(path, {
				method,
				body: JSON.stringify(body)
			});
			return {
				async list(sessionId) {
					return (await request(`/tabs?sessionId=${encodeURIComponent(sessionId)}`)).terminals;
				},
				open: (sessionId) => mutate("/tabs", "POST", { sessionId }),
				read: (sessionId, terminalId, cursor) => request(`/output?sessionId=${encodeURIComponent(sessionId)}&terminalId=${encodeURIComponent(terminalId)}&cursor=${cursor}`),
				write: (sessionId, terminalId, text) => mutate("/input", "POST", {
					sessionId,
					terminalId,
					text,
					submit: true
				}),
				clear: (sessionId, terminalId) => mutate("/clear", "POST", {
					sessionId,
					terminalId
				}),
				interrupt: (sessionId, terminalId) => mutate("/interrupt", "POST", {
					sessionId,
					terminalId
				}),
				restart: (sessionId, terminalId) => mutate("/restart", "POST", {
					sessionId,
					terminalId
				}),
				close: (sessionId, terminalId) => mutate("/tabs", "DELETE", {
					sessionId,
					terminalId
				})
			};
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots"];
		/** Register the session terminal as an additive frame overlay. */
		function apply(ctx) {
			const api = createSessionTerminalApi();
			const injected = () => ({ api });
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "personal-session-terminal",
				order: 80,
				inject: injected
			}, SessionTerminalDock));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map