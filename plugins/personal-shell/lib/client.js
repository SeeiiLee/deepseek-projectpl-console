window.__ModuleLoader__.load({
	id: "@cyrus/dsh-personal-shell",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		//#region src/client/ErrorBoundary.tsx
		/**
		* 面板级错误边界：任何子插件渲染崩溃只影响本面板，并显示错误信息，
		* 而不是把整个 Gate-1 网格（连同工作台）一起卸载。
		*/
		var PanelErrorBoundary = class extends react.Component {
			state = { error: null };
			static getDerivedStateFromError(error) {
				return { error };
			}
			componentDidCatch(error, info) {
				console.error("[personal-shell] panel crashed:", error, info.componentStack);
			}
			render() {
				if (this.state.error === null) return this.props.children;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "panel-crash",
					"data-personal-boundary-fallback": true,
					role: "alert",
					style: {
						padding: 16,
						color: "#c0392b",
						fontSize: 13,
						overflow: "auto"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "此面板发生错误，已隔离（其余界面不受影响）。" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: { whiteSpace: "pre-wrap" },
							children: String(this.state.error?.message ?? this.state.error)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: { marginTop: 8 },
							onClick: () => {
								this.setState({ error: null });
							},
							children: "重试"
						})
					]
				});
			}
		};
		/** Viewport breakpoint used by the rc.5 sidebar's automatic rail mode. */
		const SIDEBAR_AUTO_COLLAPSE = 1024;
		/** Project Console maximum draggable width. */
		const PROJECT_MAX = 1e3;
		/** Workbench maximum draggable width; effectively viewport-limited so wide monitors can use all available space. */
		const WORKBENCH_MAX = 4e3;
		/** Clamp and round a panel width. */
		function clampWidth(px, min, max) {
			return Math.min(max, Math.max(min, Number.isFinite(px) ? Math.round(px) : min));
		}
		/** Spend a deficit by shrinking one open panel to minimum, then to its rail. */
		function concede(width, open, minimum, rail, deficit) {
			if (!open || deficit <= 0) return deficit;
			if (width.value > minimum) {
				const shrink = Math.min(deficit, width.value - minimum);
				width.value -= shrink;
				deficit -= shrink;
			}
			if (deficit > 0 && width.value > rail) {
				deficit -= width.value - rail;
				width.value = rail;
			}
			return Math.max(0, deficit);
		}
		/**
		* Resolve the four Gate 1 tracks without mutating user preferences.
		*
		* Workbench normally concedes before Project Console. A recent explicit
		* project/workbench operation transiently gives that panel priority, so a
		* rail click always has a visible result in a 1380px-class window. Widening
		* the viewport automatically restores both preferred widths. If even both
		* rails cannot preserve the 560px target, Conversation gets all remaining
		* space and no auxiliary panel overlays it.
		*/
		function computeColumns(viewport, preferences) {
			const safeViewport = Number.isFinite(viewport) ? Math.max(0, viewport) : 0;
			const sidebar = preferences.sidebarCollapsed ? 56 : 280;
			const project = { value: preferences.projectOpen ? clampWidth(preferences.projectWidth, 320, PROJECT_MAX) : 40 };
			const workbench = { value: preferences.workbenchOpen ? clampWidth(preferences.workbenchWidth, 360, WORKBENCH_MAX) : 44 };
			if (preferences.workbenchFullscreen) return {
				sidebar,
				project: 40,
				conversation: 0,
				workbench: Math.max(0, safeViewport - sidebar - 40)
			};
			let deficit = Math.max(0, sidebar + project.value + workbench.value + 560 - safeViewport);
			if (preferences.preferredAuxiliary === "workbench") {
				deficit = concede(project, preferences.projectOpen, 320, 40, deficit);
				concede(workbench, preferences.workbenchOpen, 360, 44, deficit);
			} else {
				deficit = concede(workbench, preferences.workbenchOpen, 360, 44, deficit);
				concede(project, preferences.projectOpen, 320, 40, deficit);
			}
			return {
				sidebar,
				project: project.value,
				conversation: Math.max(0, safeViewport - sidebar - project.value - workbench.value),
				workbench: workbench.value
			};
		}
		//#endregion
		//#region \0dsh-css:D:\Deepseek Harness Personal\plugins\personal-shell\src\client\AppFrame.module.css.mjs
		const css = ".rFZhXG_frame{background:var(--dsw-alias-bg-base);height:100%;transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out);grid-template-rows:100%;display:grid;position:relative;overflow:hidden}.rFZhXG_frame[data-dragging]{transition:none}.rFZhXG_sidebarCol,.rFZhXG_projectCol,.rFZhXG_conversationCol,.rFZhXG_workbenchCol{min-width:0;overflow:hidden}.rFZhXG_sidebarCol{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1)}.rFZhXG_projectCol,.rFZhXG_workbenchCol{background:var(--dsw-alias-bg-layer-1);flex-direction:column;display:flex;position:relative}.rFZhXG_projectCol{border-right:1px solid var(--dsw-alias-border-l2)}.rFZhXG_workbenchCol{border-left:1px solid var(--dsw-alias-border-l2)}.rFZhXG_projectCol[data-collapsed=true],.rFZhXG_workbenchCol[data-collapsed=true]{background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 76%, transparent)}.rFZhXG_conversationCol{flex-direction:column;display:flex}.rFZhXG_panelHeader{z-index:4;box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 88%, transparent);flex:none;justify-content:space-between;align-items:center;min-width:240px;height:48px;padding:0 12px 0 16px;display:flex;position:relative}.rFZhXG_panelHeader[data-collapsed=true]{background:0 0;border-bottom-color:#0000;justify-content:center;min-width:0;padding:0}.rFZhXG_panelHeading{align-items:center;gap:9px;min-width:0;display:flex}.rFZhXG_panelActions{align-items:center;gap:2px;display:flex}.rFZhXG_projectAccent{background:var(--dsw-alias-state-business-primary);width:7px;height:7px;box-shadow:0 0 0 4px color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);border-radius:50%;flex:none}.rFZhXG_workbenchIcon{fill:none;width:16px;height:16px;stroke:var(--dsw-alias-state-business-primary);stroke-linecap:round;stroke-linejoin:round;stroke-width:1.5px;flex:none}.rFZhXG_panelTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:20px;overflow:hidden}.rFZhXG_panelCollapse,.rFZhXG_panelExpand{width:30px;height:30px;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out);background:0 0;border:none;border-radius:9px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.rFZhXG_panelCollapse:hover,.rFZhXG_panelExpand:hover{background:var(--dsw-alias-interactive-bg-hover)}.rFZhXG_panelCollapse:focus-visible,.rFZhXG_panelExpand:focus-visible,.rFZhXG_sidebarProjectAction:focus-visible,.rFZhXG_divider:focus-visible,.rFZhXG_layoutMenuSummary:focus-visible,.rFZhXG_layoutMenuPopup button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.rFZhXG_layoutMenu{position:relative}.rFZhXG_layoutMenuSummary{box-sizing:border-box;width:30px;height:30px;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:9px;justify-content:center;align-items:center;list-style:none;display:inline-flex}.rFZhXG_layoutMenuSummary::-webkit-details-marker{display:none}.rFZhXG_layoutMenuSummary:hover,.rFZhXG_layoutMenu[open] .rFZhXG_layoutMenuSummary{background:var(--dsw-alias-interactive-bg-hover)}.rFZhXG_layoutMenuSummary svg{fill:currentColor;width:17px;height:17px}.rFZhXG_layoutMenuPopup{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;width:136px;padding:6px;display:grid;position:absolute;top:34px;right:0;box-shadow:0 8px 24px #0000002e}.rFZhXG_layoutMenuPopup button{width:100%;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-align:left;background:0 0;border:0;border-radius:7px;padding:7px 9px}.rFZhXG_layoutMenuPopup button:hover{background:var(--dsw-alias-interactive-bg-hover)}.rFZhXG_panelCollapse svg,.rFZhXG_panelExpand svg{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.7px;width:17px;height:17px}.rFZhXG_panelBody{flex:1;min-height:0;overflow:hidden}.rFZhXG_panelBody[data-collapsed=true]{visibility:hidden;pointer-events:none}.rFZhXG_sidebarProjectAction{box-sizing:border-box;width:calc(100% + 8px);height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;flex:none;align-items:center;gap:8px;margin:4px -4px 0;padding:6px 2px 6px 10px;font-family:inherit;font-size:14px;line-height:22px;display:flex;overflow:hidden}.rFZhXG_sidebarProjectAction:hover{background:var(--dsw-alias-interactive-bg-hover)}.rFZhXG_sidebarProjectAction[data-wide=false]{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;margin:8px 0 0;padding:0}.rFZhXG_sidebarProjectIcon{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.6px;flex:none;width:16px;height:16px}.rFZhXG_sidebarProjectAction[data-wide=false] .rFZhXG_sidebarProjectIcon{width:18px;height:18px}.rFZhXG_sidebarProjectLabel{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}[data-slot=\"sidebar.footer.action\"]:has(.rFZhXG_sidebarProjectAction){flex-direction:column;width:100%;display:flex!important}.rFZhXG_divider{z-index:3;cursor:col-resize;touch-action:none;width:8px;transition:left var(--ds-transition-duration-slow) var(--ds-ease-in-out);margin-left:-4px;position:absolute;top:0;bottom:0}.rFZhXG_divider:after{content:\"\";box-sizing:border-box;background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2-darkmode-thin);opacity:0;width:12px;height:32px;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out), background var(--ds-transition-duration-slow) var(--ds-ease-in-out);border-radius:10px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}.rFZhXG_divider:hover:after,.rFZhXG_divider:focus-visible:after,.rFZhXG_divider[data-dragging=true]:after{opacity:1;background:var(--dsw-alias-button-floating-hover)}.rFZhXG_frame[data-dragging] .rFZhXG_divider{transition:none}.rFZhXG_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}.rFZhXG_overlayLayer>*{pointer-events:auto}@media (prefers-reduced-motion:reduce){.rFZhXG_frame,.rFZhXG_panelCollapse,.rFZhXG_panelExpand,.rFZhXG_divider{transition:none}}";
		const tagId = "@cyrus/dsh-personal-shell/AppFrame.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-personal-shell";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var AppFrame_module_css_default = {
			"conversationCol": "rFZhXG_conversationCol",
			"divider": "rFZhXG_divider",
			"frame": "rFZhXG_frame",
			"layoutMenu": "rFZhXG_layoutMenu",
			"layoutMenuPopup": "rFZhXG_layoutMenuPopup",
			"layoutMenuSummary": "rFZhXG_layoutMenuSummary",
			"overlayLayer": "rFZhXG_overlayLayer",
			"panelActions": "rFZhXG_panelActions",
			"panelBody": "rFZhXG_panelBody",
			"panelCollapse": "rFZhXG_panelCollapse",
			"panelExpand": "rFZhXG_panelExpand",
			"panelHeader": "rFZhXG_panelHeader",
			"panelHeading": "rFZhXG_panelHeading",
			"panelTitle": "rFZhXG_panelTitle",
			"projectAccent": "rFZhXG_projectAccent",
			"projectCol": "rFZhXG_projectCol",
			"sidebarCol": "rFZhXG_sidebarCol",
			"sidebarProjectAction": "rFZhXG_sidebarProjectAction",
			"sidebarProjectIcon": "rFZhXG_sidebarProjectIcon",
			"sidebarProjectLabel": "rFZhXG_sidebarProjectLabel",
			"workbenchCol": "rFZhXG_workbenchCol",
			"workbenchIcon": "rFZhXG_workbenchIcon"
		};
		//#endregion
		//#region src/client/AppFrame.tsx
		function ProjectColumn(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: AppFrame_module_css_default.projectCol,
				"data-personal-project-panel": true,
				"data-collapsed": props.collapsed || void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
					className: AppFrame_module_css_default.panelHeader,
					"data-personal-project-header": true,
					"data-collapsed": props.collapsed || void 0,
					children: props.collapsed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: AppFrame_module_css_default.panelExpand,
						type: "button",
						"aria-label": "展开项目控制台",
						title: "展开项目控制台",
						onClick: props.onExpand,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chevron, { direction: "right" })
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: AppFrame_module_css_default.panelHeading,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: AppFrame_module_css_default.projectAccent,
							"aria-hidden": "true"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: AppFrame_module_css_default.panelTitle,
							children: "项目控制台"
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: AppFrame_module_css_default.panelCollapse,
						type: "button",
						"aria-label": "收起项目控制台",
						title: "收起项目控制台",
						onClick: props.onCollapse,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chevron, { direction: "left" })
					})] })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: AppFrame_module_css_default.panelBody,
					"data-collapsed": props.collapsed || void 0,
					children: props.children
				})]
			});
		}
		function WorkbenchColumn(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: AppFrame_module_css_default.workbenchCol,
				"data-personal-workbench-panel": true,
				"data-collapsed": props.collapsed || void 0,
				children: [props.collapsed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
					className: AppFrame_module_css_default.panelHeader,
					"data-personal-workbench-header": true,
					"data-collapsed": props.collapsed || void 0,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: AppFrame_module_css_default.panelExpand,
						type: "button",
						"aria-label": "展开工作台",
						title: "展开工作台",
						onClick: props.onExpand,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Chevron, { direction: "left" })
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: AppFrame_module_css_default.panelBody,
					"data-collapsed": props.collapsed || void 0,
					children: props.children
				})]
			});
		}
		function Chevron({ direction }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 20 20",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: direction === "left" ? "M12.5 4.5 7 10l5.5 5.5" : "m7.5 4.5 5.5 5.5-5.5 5.5" })
			});
		}
		function ConversationColumn(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("main", {
				className: AppFrame_module_css_default.conversationCol,
				"data-personal-conversation-column": true,
				children: props.children
			});
		}
		const KEYBOARD_RESIZE_STEP = 16;
		/** Pointer, keyboard and reset affordance for one auxiliary-panel boundary. */
		function Divider(props) {
			const [dragging, setDragging] = (0, react.useState)(false);
			const origin = (0, react.useRef)(0);
			const latest = (0, react.useRef)(0);
			const frame = (0, react.useRef)(null);
			const callbacks = (0, react.useRef)({
				onStart: props.onStart,
				onDrag: props.onDrag,
				onEnd: props.onEnd
			});
			callbacks.current = {
				onStart: props.onStart,
				onDrag: props.onDrag,
				onEnd: props.onEnd
			};
			const onPointerDown = (0, react.useCallback)((event) => {
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				origin.current = event.clientX;
				latest.current = event.clientX;
				callbacks.current.onStart();
				setDragging(true);
			}, []);
			const onPointerMove = (0, react.useCallback)((event) => {
				if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
				latest.current = event.clientX;
				frame.current ??= requestAnimationFrame(() => {
					frame.current = null;
					callbacks.current.onDrag(latest.current - origin.current);
				});
			}, []);
			const finishPointer = (0, react.useCallback)((event) => {
				if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
				event.currentTarget.releasePointerCapture(event.pointerId);
				if (frame.current !== null) {
					cancelAnimationFrame(frame.current);
					frame.current = null;
				}
				callbacks.current.onDrag(latest.current - origin.current);
				setDragging(false);
				callbacks.current.onEnd();
			}, []);
			const onKeyDown = (0, react.useCallback)((event) => {
				let next;
				if (event.key === "ArrowLeft") next = props.value + (props.side === "project" ? -16 : KEYBOARD_RESIZE_STEP);
				else if (event.key === "ArrowRight") next = props.value + (props.side === "project" ? KEYBOARD_RESIZE_STEP : -16);
				else if (event.key === "Home") {
					event.preventDefault();
					props.onReset();
					return;
				} else if (event.key === "Enter") {
					event.preventDefault();
					props.onToggle();
					return;
				}
				if (next !== void 0) {
					event.preventDefault();
					props.onSet(next);
				}
			}, [props]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: AppFrame_module_css_default.divider,
				style: { left: props.left },
				"data-personal-divider": props.side,
				"data-dragging": dragging || void 0,
				role: "separator",
				tabIndex: 0,
				"aria-label": props.side === "project" ? "调整项目控制台宽度" : "调整工作台宽度",
				"aria-orientation": "vertical",
				"aria-valuemin": props.min,
				"aria-valuemax": props.max,
				"aria-valuenow": Math.round(props.value),
				onDoubleClick: props.onReset,
				onKeyDown,
				onPointerDown,
				onPointerMove,
				onPointerUp: finishPointer,
				onPointerCancel: finishPointer
			});
		}
		/** Four-track Personal Desktop shell formalised for Gate 1. */
		function AppFrame({ useStore, useSessions, actions, renderSlot }) {
			const panels = useStore((state) => state);
			const detailsSession = useSessions((state) => {
				const current = state.current;
				return current !== void 0 && state.byId[current]?.blank === false ? current : void 0;
			});
			const frameRef = (0, react.useRef)(null);
			const [viewport, setViewport] = (0, react.useState)(() => window.innerWidth);
			const lastSession = (0, react.useRef)(detailsSession);
			(0, react.useLayoutEffect)(() => {
				if (lastSession.current !== detailsSession) actions.clearDetails();
				lastSession.current = detailsSession;
			}, [actions, detailsSession]);
			(0, react.useEffect)(() => {
				const element = frameRef.current;
				/* v8 ignore next -- the frame renders unconditionally before this effect. */
				if (element === null) return;
				let pendingFrame = null;
				const observer = new ResizeObserver(() => {
					pendingFrame ??= requestAnimationFrame(() => {
						pendingFrame = null;
						const width = element.getBoundingClientRect().width;
						if (width > 0) setViewport(width);
					});
				});
				observer.observe(element);
				return () => {
					observer.disconnect();
					if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
				};
			}, []);
			const narrow = viewport < SIDEBAR_AUTO_COLLAPSE;
			(0, react.useEffect)(() => {
				actions.setNarrow(narrow);
			}, [actions, narrow]);
			const sidebarCollapsed = narrow ? !panels.narrowExpanded : !panels.sidebarOpen;
			const columns = computeColumns(viewport, {
				sidebarCollapsed,
				projectOpen: panels.projectOpen,
				projectWidth: panels.projectWidth,
				workbenchOpen: panels.workbenchOpen,
				workbenchWidth: panels.workbenchWidth,
				preferredAuxiliary: panels.preferredAuxiliary,
				workbenchFullscreen: panels.workbenchFullscreen
			});
			const projectCollapsed = columns.project === 40;
			const workbenchCollapsed = columns.workbench === 44;
			const columnsRef = (0, react.useRef)(columns);
			columnsRef.current = columns;
			const projectBase = (0, react.useRef)(360);
			const workbenchBase = (0, react.useRef)(640);
			const [dragging, setDragging] = (0, react.useState)(false);
			const finishProjectDrag = (0, react.useCallback)(() => {
				actions.commitProject();
				setDragging(false);
			}, [actions]);
			const finishWorkbenchDrag = (0, react.useCallback)(() => {
				actions.commitWorkbench();
				setDragging(false);
			}, [actions]);
			const startProjectDrag = (0, react.useCallback)(() => {
				projectBase.current = columnsRef.current.project;
				setDragging(true);
			}, []);
			const startWorkbenchDrag = (0, react.useCallback)(() => {
				workbenchBase.current = columnsRef.current.workbench;
				setDragging(true);
			}, []);
			const dragProject = (0, react.useCallback)((dx) => {
				actions.previewProject(projectBase.current + dx);
			}, [actions]);
			const dragWorkbench = (0, react.useCallback)((dx) => {
				actions.previewWorkbench(workbenchBase.current - dx);
			}, [actions]);
			const resetProject = (0, react.useCallback)(() => {
				actions.setProject(360);
			}, [actions]);
			const resetWorkbench = (0, react.useCallback)(() => {
				actions.setWorkbench(640);
			}, [actions]);
			const legacyDetails = renderSlot("details", {});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: frameRef,
				className: AppFrame_module_css_default.frame,
				style: { gridTemplateColumns: `${columns.sidebar}px ${columns.project}px ${panels.workbenchFullscreen ? "0px" : "minmax(0, 1fr)"} ${columns.workbench}px` },
				"data-personal-shell": "gate-1",
				"data-sidebar-collapsed": sidebarCollapsed || void 0,
				"data-project-collapsed": projectCollapsed || void 0,
				"data-workbench-collapsed": workbenchCollapsed || void 0,
				"data-workbench-fullscreen": panels.workbenchFullscreen || void 0,
				"data-dragging": dragging || void 0,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: AppFrame_module_css_default.sidebarCol,
						"data-personal-sidebar-column": true,
						children: renderSlot("sidebar", {
							collapsed: sidebarCollapsed,
							width: columns.sidebar
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectColumn, {
						collapsed: projectCollapsed,
						onCollapse: actions.closeProject,
						onExpand: actions.openProject,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PanelErrorBoundary, { children: renderSlot("project.control", {}) })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConversationColumn, { children: renderSlot("conversation", {}) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkbenchColumn, {
						collapsed: workbenchCollapsed,
						onExpand: actions.openWorkbench,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PanelErrorBoundary, { children: renderSlot("workbench.panel", {
							legacyDetails,
							detailsCommand: panels.detailsCommand,
							fullscreen: panels.workbenchFullscreen
						}) })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: AppFrame_module_css_default.overlayLayer,
						"data-shell-overlay": true,
						children: renderSlot("shell.overlay", {})
					}),
					!projectCollapsed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Divider, {
						side: "project",
						left: columns.sidebar + columns.project,
						value: columns.project,
						min: 320,
						max: 1e3,
						onStart: startProjectDrag,
						onDrag: dragProject,
						onEnd: finishProjectDrag,
						onSet: actions.setProject,
						onReset: resetProject,
						onToggle: actions.toggleProject
					}),
					!workbenchCollapsed && !panels.workbenchFullscreen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Divider, {
						side: "workbench",
						left: viewport - columns.workbench,
						value: columns.workbench,
						min: 360,
						max: 4e3,
						onStart: startWorkbenchDrag,
						onDrag: dragWorkbench,
						onEnd: finishWorkbenchDrag,
						onSet: actions.setWorkbench,
						onReset: resetWorkbench,
						onToggle: actions.toggleWorkbench
					})
				]
			});
		}
		//#endregion
		//#region src/client/ProjectSidebarAction.tsx
		/** Native-sidebar entry that toggles the Project Console without covering chat. */
		function ProjectSidebarAction({ wide, toggleProject }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				className: AppFrame_module_css_default.sidebarProjectAction,
				type: "button",
				"data-wide": wide,
				"data-personal-project-entry": "sidebar",
				"aria-label": "切换项目控制台",
				...!wide ? { title: "项目控制台" } : {},
				onClick: toggleProject,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					className: AppFrame_module_css_default.sidebarProjectIcon,
					viewBox: "0 0 20 20",
					"aria-hidden": "true",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "3",
						y: "3",
						width: "14",
						height: "14",
						rx: "3"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M7.25 3v14M7.25 8h9.75" })]
				}), wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: AppFrame_module_css_default.sidebarProjectLabel,
					children: "项目控制台"
				})]
			});
		}
		//#endregion
		//#region src/client/service.ts
		/** rc.5 layout compatibility plus the Personal Shell Gate 1 service face. */
		var LayoutController = class {
			#panels;
			/** Attach the current root entry's bound actions. */
			attachPanels(actions) {
				this.#panels = actions;
			}
			/** Toggle the native sidebar between its full form and 56px rail. */
			toggleSidebar() {
				this.#require().toggleSidebar();
			}
			/** Expand Workbench and signal that its legacy Details surface was requested. */
			openDetails() {
				this.#require().openDetails();
			}
			/** Preserve the official close contract by collapsing the containing Workbench. */
			closeDetails() {
				this.#require().closeDetails();
			}
			openProject() {
				this.#require().openProject();
			}
			closeProject() {
				this.#require().closeProject();
			}
			toggleProject() {
				this.#require().toggleProject();
			}
			openWorkbench() {
				this.#require().openWorkbench();
			}
			closeWorkbench() {
				this.#require().closeWorkbench();
			}
			toggleWorkbench() {
				this.#require().toggleWorkbench();
			}
			toggleWorkbenchFullscreen() {
				this.#require().toggleWorkbenchFullscreen();
			}
			focusConversation() {
				this.#require().focusConversation();
			}
			resetLayout() {
				this.#require().resetLayout();
			}
			#require() {
				if (this.#panels === void 0) throw new Error("personal-shell: panel actions not wired (root entry not mounted)");
				return this.#panels;
			}
		};
		//#endregion
		//#region src/client/preferences.ts
		/** Versioned browser key owned only by Personal Shell. */
		const LAYOUT_STORAGE_KEY = "dsh.personal-shell.layout.v1";
		/** Contract defaults used for first boot, corrupt storage and reset layout. */
		function defaultLayoutPreferences() {
			return {
				version: 1,
				sidebarOpen: true,
				project: {
					open: true,
					width: 360
				},
				workbench: {
					open: true,
					width: 640
				}
			};
		}
		function record(value) {
			return typeof value === "object" && value !== null ? value : void 0;
		}
		function cleanBoolean(value, fallback) {
			return typeof value === "boolean" ? value : fallback;
		}
		function cleanWidth(value, fallback, min, max) {
			return typeof value === "number" && Number.isFinite(value) ? clampWidth(value, min, max) : fallback;
		}
		/** Validate and clamp an untrusted localStorage payload into the current schema. */
		function sanitizeLayoutPreferences(value) {
			const fallback = defaultLayoutPreferences();
			const source = record(value);
			if (source?.version !== 1) return fallback;
			const project = record(source.project);
			const workbench = record(source.workbench);
			return {
				version: 1,
				sidebarOpen: cleanBoolean(source.sidebarOpen, fallback.sidebarOpen),
				project: {
					open: cleanBoolean(project?.open, fallback.project.open),
					width: cleanWidth(project?.width, fallback.project.width, 320, PROJECT_MAX)
				},
				workbench: {
					open: cleanBoolean(workbench?.open, fallback.workbench.open),
					width: cleanWidth(workbench?.width, fallback.workbench.width, 360, WORKBENCH_MAX)
				}
			};
		}
		function browserStorage() {
			try {
				return typeof localStorage === "undefined" ? void 0 : localStorage;
			} catch {
				return;
			}
		}
		/** Load preferences and immediately rewrite a clean, current-version payload. */
		function loadLayoutPreferences(storage = browserStorage()) {
			let candidate;
			if (storage !== void 0) try {
				const raw = storage.getItem(LAYOUT_STORAGE_KEY);
				candidate = raw === null ? void 0 : JSON.parse(raw);
			} catch {
				candidate = void 0;
			}
			const clean = sanitizeLayoutPreferences(candidate);
			if (storage !== void 0) try {
				storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(clean));
			} catch {}
			return clean;
		}
		/** Extract, clamp and persist only user preferences, never derived viewport state. */
		function saveLayoutPreferences(state, storage = browserStorage()) {
			if (storage === void 0) return;
			const clean = sanitizeLayoutPreferences({
				version: 1,
				sidebarOpen: state.sidebarOpen,
				project: {
					open: state.projectOpen,
					width: state.projectWidth
				},
				workbench: {
					open: state.workbenchOpen,
					width: state.workbenchWidth
				}
			});
			try {
				storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(clean));
			} catch {}
		}
		//#endregion
		//#region src/client/layout-state.ts
		/** Build clean in-memory state from the already-sanitised preference schema. */
		function layoutStateFromPreferences(preferences) {
			return {
				sidebarOpen: preferences.sidebarOpen,
				projectOpen: preferences.project.open,
				projectWidth: preferences.project.width,
				workbenchOpen: preferences.workbench.open,
				workbenchWidth: preferences.workbench.width,
				preferredAuxiliary: "project",
				narrow: false,
				narrowExpanded: false,
				workbenchFullscreen: false,
				detailsCommand: {
					kind: "dismiss",
					revision: 0
				}
			};
		}
		/** Build the complete first-boot/reset state for reducer-level tests and store init. */
		function defaultLayoutState() {
			return layoutStateFromPreferences(defaultLayoutPreferences());
		}
		function nextRevision(current) {
			return current >= Number.MAX_SAFE_INTEGER || current < 0 ? 1 : current + 1;
		}
		function command(draft, kind) {
			draft.detailsCommand = {
				kind,
				revision: nextRevision(draft.detailsCommand.revision)
			};
		}
		/** Pure mutable reducers shared by the engine store and action-level tests. */
		const layoutMutations = {
			setProject(draft, px) {
				draft.projectWidth = clampWidth(px, 320, PROJECT_MAX);
				draft.projectOpen = true;
				draft.preferredAuxiliary = "project";
				draft.workbenchFullscreen = false;
			},
			toggleProject(draft) {
				draft.projectOpen = !draft.projectOpen;
				draft.preferredAuxiliary = draft.projectOpen ? "project" : "workbench";
				if (draft.projectOpen) draft.workbenchFullscreen = false;
			},
			openProject(draft) {
				draft.projectOpen = true;
				draft.preferredAuxiliary = "project";
				draft.workbenchFullscreen = false;
			},
			closeProject(draft) {
				draft.projectOpen = false;
				draft.preferredAuxiliary = "workbench";
			},
			setWorkbench(draft, px) {
				draft.workbenchWidth = clampWidth(px, 360, WORKBENCH_MAX);
				draft.workbenchOpen = true;
				draft.preferredAuxiliary = "workbench";
				draft.workbenchFullscreen = false;
			},
			toggleWorkbench(draft) {
				draft.workbenchOpen = !draft.workbenchOpen;
				draft.preferredAuxiliary = draft.workbenchOpen ? "workbench" : "project";
			},
			setWorkbenchFullscreen(draft, fullscreen) {
				if (draft.workbenchFullscreen === fullscreen) return;
				draft.workbenchFullscreen = fullscreen;
				if (fullscreen) {
					draft.workbenchOpen = true;
					draft.preferredAuxiliary = "workbench";
				}
			},
			openWorkbench(draft) {
				draft.workbenchOpen = true;
				draft.preferredAuxiliary = "workbench";
			},
			closeWorkbench(draft) {
				draft.workbenchOpen = false;
				draft.preferredAuxiliary = "project";
				draft.workbenchFullscreen = false;
			},
			toggleSidebar(draft) {
				if (draft.narrow) draft.narrowExpanded = !draft.narrowExpanded;
				else draft.sidebarOpen = !draft.sidebarOpen;
			},
			setNarrow(draft, narrow) {
				if (draft.narrow === narrow) return;
				draft.narrow = narrow;
				draft.narrowExpanded = false;
			},
			openDetails(draft) {
				draft.workbenchOpen = true;
				draft.preferredAuxiliary = "workbench";
				command(draft, "open");
			},
			closeDetails(draft) {
				command(draft, "dismiss");
				draft.workbenchOpen = false;
				draft.preferredAuxiliary = "project";
			},
			clearDetails(draft) {
				command(draft, "dismiss");
			},
			focusConversation(draft) {
				draft.projectOpen = false;
				draft.workbenchOpen = false;
				draft.preferredAuxiliary = "project";
				draft.workbenchFullscreen = false;
			},
			resetLayout(draft) {
				const revision = nextRevision(draft.detailsCommand.revision);
				Object.assign(draft, defaultLayoutState());
				draft.detailsCommand = {
					kind: "dismiss",
					revision
				};
			}
		};
		//#endregion
		//#region src/client/stores.ts
		function persist(draft) {
			saveLayoutPreferences(draft);
		}
		/** Create the Gate 1 root layout store with cleansed, versioned preferences. */
		function createLayoutStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
				init: () => layoutStateFromPreferences(loadLayoutPreferences()),
				actions: {
					previewProject: (draft, px) => {
						layoutMutations.setProject(draft, px);
					},
					commitProject: (draft) => {
						persist(draft);
					},
					setProject: (draft, px) => {
						layoutMutations.setProject(draft, px);
						persist(draft);
					},
					toggleProject: (draft) => {
						layoutMutations.toggleProject(draft);
						persist(draft);
					},
					openProject: (draft) => {
						layoutMutations.openProject(draft);
						persist(draft);
					},
					closeProject: (draft) => {
						layoutMutations.closeProject(draft);
						persist(draft);
					},
					previewWorkbench: (draft, px) => {
						layoutMutations.setWorkbench(draft, px);
					},
					commitWorkbench: (draft) => {
						persist(draft);
					},
					setWorkbench: (draft, px) => {
						layoutMutations.setWorkbench(draft, px);
						persist(draft);
					},
					toggleWorkbench: (draft) => {
						layoutMutations.toggleWorkbench(draft);
						persist(draft);
					},
					openWorkbench: (draft) => {
						layoutMutations.openWorkbench(draft);
						persist(draft);
					},
					closeWorkbench: (draft) => {
						layoutMutations.closeWorkbench(draft);
						persist(draft);
					},
					toggleWorkbenchFullscreen: (draft) => {
						layoutMutations.setWorkbenchFullscreen(draft, !draft.workbenchFullscreen);
					},
					toggleSidebar: (draft) => {
						const persistWidePreference = !draft.narrow;
						layoutMutations.toggleSidebar(draft);
						if (persistWidePreference) persist(draft);
					},
					setNarrow: (draft, narrow) => {
						layoutMutations.setNarrow(draft, narrow);
					},
					openDetails: (draft) => {
						layoutMutations.openDetails(draft);
						persist(draft);
					},
					closeDetails: (draft) => {
						layoutMutations.closeDetails(draft);
						persist(draft);
					},
					clearDetails: (draft) => {
						layoutMutations.clearDetails(draft);
					},
					focusConversation: (draft) => {
						layoutMutations.focusConversation(draft);
						persist(draft);
					},
					resetLayout: (draft) => {
						layoutMutations.resetLayout(draft);
						persist(draft);
					}
				}
			});
		}
		//#endregion
		//#region src/client/theme-presenter.ts
		/** Body attribute selecting the dark token palette. */
		const DARK_ATTRIBUTE = "data-ds-dark-theme";
		/** Projects the active theme onto the document without a React subscription. */
		var ThemePresenter = class {
			appliedTokens = [];
			themeColorMeta;
			constructor() {
				this.themeColorMeta = document.createElement("meta");
				this.themeColorMeta.name = "theme-color";
			}
			/**
			* Apply one resolved theme snapshot.
			* @param snapshot - Current theme state from ctx.theme.
			*/
			apply(snapshot) {
				const scheme = snapshot.active.colorScheme;
				document.documentElement.style.colorScheme = scheme;
				const body = document.body;
				if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, "");
				else body.removeAttribute(DARK_ATTRIBUTE);
				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				for (const [name, value] of Object.entries(snapshot.active.tokens)) {
					body.style.setProperty(name, value);
					this.appliedTokens.push(name);
				}
				this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
				if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
			}
			/** Retract only the document state owned by this presenter. */
			dispose() {
				document.documentElement.style.removeProperty("color-scheme");
				const body = document.body;
				body.removeAttribute(DARK_ATTRIBUTE);
				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				this.themeColorMeta.remove();
			}
		};
		//#endregion
		//#region src/client/index.ts
		/** Client services required by the replacement shell. */
		const inject = ["slots", "theme"];
		/**
		* Provide both shell services, occupy root, and declare all compatible child slots.
		* @param ctx - Personal Desktop client root context.
		*/
		function apply(ctx) {
			const layout = new LayoutController();
			ctx.effect(() => {
				const disposeLayout = ctx.reflect.provide("layout", layout);
				const disposePersonalShell = ctx.reflect.provide("personalShell", layout);
				const disposeRoot = ctx.slots.register({
					name: "root",
					children: {
						"sidebar": {
							kind: "single",
							scope: "root"
						},
						"project.control": {
							kind: "single",
							scope: "root"
						},
						"conversation": {
							kind: "single",
							scope: "session-maybe"
						},
						"details": {
							kind: "single",
							scope: "session"
						},
						"workbench.panel": {
							kind: "single",
							scope: "root"
						},
						"shell.overlay": {
							kind: "list",
							scope: "root"
						}
					},
					store: createLayoutStore,
					inject: (actions) => {
						layout.attachPanels(actions);
						return {};
					}
				}, AppFrame);
				return () => {
					disposeRoot();
					disposePersonalShell();
					disposeLayout();
				};
			}, "personal-shell: Gate 1 services + root registration");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "personal-project-control",
				order: -100,
				inject: () => ({ toggleProject: () => {
					layout.toggleProject();
				} })
			}, ProjectSidebarAction));
			ctx.effect(() => {
				const presenter = new ThemePresenter();
				presenter.apply(ctx.theme.getTheme());
				const off = ctx.on("theme/change", (snapshot) => {
					presenter.apply(snapshot);
				});
				return () => {
					off();
					presenter.dispose();
				};
			}, "personal-shell: theme presenter");
		}
		//#endregion
		exports.LayoutController = LayoutController;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map