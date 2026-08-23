window.__ModuleLoader__.load({
	id: "@cyrus/dsh-trajectory-island",
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
		//#region src/client/jump.ts
		function anchorElement(key) {
			return [...document.querySelectorAll("[data-chat-anchor-key]")].find((element) => element.dataset.chatAnchorKey === key);
		}
		function reveal(element) {
			element.scrollIntoView({
				behavior: "smooth",
				block: "center"
			});
			element.animate?.([
				{
					outline: "2px solid transparent",
					outlineOffset: "2px"
				},
				{
					outline: "2px solid currentColor",
					outlineOffset: "4px"
				},
				{
					outline: "2px solid transparent",
					outlineOffset: "6px"
				}
			], {
				duration: 900,
				easing: "ease-out"
			});
		}
		function nextFrame() {
			return new Promise((resolve) => requestAnimationFrame(() => {
				resolve();
			}));
		}
		/** Use the stable upstream chat anchor; if Chat is unmounted, switch its first view tab and retry. */
		async function jumpToChatAnchor(key, index, total) {
			if (key !== void 0) {
				const direct = anchorElement(key);
				if (direct !== void 0) {
					reveal(direct);
					return "exact";
				}
			}
			const chatTab = [...document.querySelectorAll("[role=\"tablist\"]")].find((list) => list.querySelectorAll("button[role=\"tab\"]").length > 1)?.querySelector("button[role=\"tab\"]");
			if (chatTab !== null && chatTab !== void 0 && chatTab.getAttribute("aria-selected") !== "true") {
				chatTab.click();
				await nextFrame();
				await nextFrame();
			}
			if (key !== void 0) {
				const afterSwitch = anchorElement(key);
				if (afterSwitch !== void 0) {
					reveal(afterSwitch);
					return "exact";
				}
			}
			const scroll = document.querySelector("[data-conversation-scroll]");
			if (scroll === null || total <= 0) return "unavailable";
			const ratio = total <= 1 ? 1 : index / (total - 1);
			scroll.scrollTo({
				top: Math.max(0, (scroll.scrollHeight - scroll.clientHeight) * ratio),
				behavior: "smooth"
			});
			return "approximate";
		}
		//#endregion
		//#region src/client/model.ts
		const SIGNALS = {
			user: {
				kind: "user",
				label: "问"
			},
			steering: {
				kind: "user",
				label: "续"
			},
			assistant: {
				kind: "assistant",
				label: "答"
			},
			"tool-call": {
				kind: "tool",
				label: "工"
			},
			"model-retry": {
				kind: "retry",
				label: "重"
			},
			"turn-error": {
				kind: "error",
				label: "错"
			},
			"turn-max-tokens": {
				kind: "error",
				label: "限"
			},
			compaction: {
				kind: "compaction",
				label: "压"
			},
			"manual-compaction": {
				kind: "compaction",
				label: "压"
			},
			command: {
				kind: "command",
				label: "令"
			},
			context: {
				kind: "context",
				label: "境"
			}
		};
		function nodeSignal(node) {
			const signal = SIGNALS[node.kind];
			if (signal === void 0) return void 0;
			return {
				...signal,
				status: signal.kind === "error" ? "error" : "complete"
			};
		}
		function distinctSignals(signals) {
			const seen = /* @__PURE__ */ new Set();
			return signals.filter((signal) => {
				const key = `${signal.kind}:${signal.status}:${signal.label}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		}
		/** Fold upstream chat anchors plus trajectory request state into one compact per-turn rail. */
		function deriveTrajectoryIsland(source) {
			const order = [...source.turnOrder];
			const known = new Set(order);
			const extras = /* @__PURE__ */ new Set();
			for (const request of source.requests) if (!known.has(request.turn)) extras.add(request.turn);
			for (const turn of source.runningToolTurns) if (!known.has(turn)) extras.add(turn);
			order.push(...[...extras].sort((left, right) => left - right));
			return order.map((turn) => {
				const visible = source.nodeKeys(turn).flatMap((key) => {
					const value = source.node(key);
					return value === void 0 ? [] : [value];
				}).filter((node) => node.visibility !== "hidden");
				const preferred = visible.find((node) => node.kind === "user" || node.kind === "steering") ?? visible[0];
				const requests = source.requests.filter((request) => request.turn === turn);
				const toolRunning = source.runningToolTurns.includes(turn);
				const signals = distinctSignals([
					...visible.flatMap((node) => {
						const signal = nodeSignal(node);
						return signal === void 0 ? [] : [signal];
					}),
					...requests.filter((request) => request.status === "running").map(() => ({
						kind: "request",
						status: "running",
						label: "模"
					})),
					...requests.filter((request) => request.status === "error").map(() => ({
						kind: "error",
						status: "error",
						label: "错"
					})),
					...toolRunning ? [{
						kind: "tool",
						status: "running",
						label: "工"
					}] : []
				]);
				const terminalRequest = requests.at(-1);
				const error = visible.some((node) => node.kind === "turn-error" || node.kind === "turn-max-tokens") || terminalRequest?.status === "error";
				const running = signals.some((signal) => signal.status === "running") || source.turnStatus(turn) === "open";
				return {
					turn,
					status: error ? "error" : running ? "running" : source.turnStatus(turn) === "closed" ? "complete" : "unknown",
					...preferred === void 0 ? {} : { anchorKey: preferred.key },
					...preferred?.anchorSeq === void 0 ? {} : { anchorSeq: preferred.anchorSeq },
					signals
				};
			});
		}
		//#endregion
		//#region \0dsh-css:D:\Deepseek Harness Personal\plugins\trajectory-island\src\client\SessionMinimap.module.css.mjs
		const css = ".wwlXWq_rail{z-index:60;box-sizing:border-box;opacity:.5;pointer-events:auto;background:0 0;border-radius:8px;width:14px;padding:2px 0;transition:opacity .16s,background-color .16s;display:flex;position:fixed}.wwlXWq_rail:hover,.wwlXWq_rail:focus-within{opacity:1;background:color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent);backdrop-filter:blur(6px)}.wwlXWq_track{flex-direction:column;flex:1;justify-content:center;gap:3px;min-height:0;display:flex;overflow:hidden}.wwlXWq_tick{appearance:none;cursor:pointer;background:0 0;border:0;flex:1 1 0;justify-content:center;align-items:center;min-height:4px;max-height:14px;padding:0;display:flex}.wwlXWq_tick i{background:var(--dsw-alias-label-tertiary);border-radius:1px;flex:none;width:3px;height:2px;transition:width .14s,background-color .14s;display:block}.wwlXWq_tick[data-kind=user] i{background:var(--dsw-alias-label-secondary);width:4px}.wwlXWq_tick:hover i{background:var(--dsw-alias-label-primary);width:12px}.wwlXWq_tick[data-status=running] i{background:var(--dsw-alias-state-business-primary);animation:1.1s ease-in-out infinite wwlXWq_minimapPulse}.wwlXWq_tick[data-status=error] i{background:var(--dsw-alias-state-danger,#e5534b)}.wwlXWq_tick[data-active=true] i{background:var(--dsw-alias-state-business-primary);width:12px}.wwlXWq_rail:hover .wwlXWq_tick i{height:3px}.wwlXWq_preview{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,#26282e);pointer-events:none;border-radius:8px;width:212px;padding:8px 10px;position:absolute;right:22px;box-shadow:0 8px 24px #00000038}.wwlXWq_preview strong{color:var(--dsw-alias-label-secondary);margin-bottom:3px;font-size:11px;font-weight:600;display:block}.wwlXWq_preview p{color:var(--dsw-alias-label-primary);-webkit-line-clamp:4;-webkit-box-orient:vertical;margin:0;font-size:12px;line-height:1.5;display:-webkit-box;overflow:hidden}@keyframes wwlXWq_minimapPulse{0%,to{opacity:1}50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.wwlXWq_rail,.wwlXWq_tick i{transition:none}.wwlXWq_tick[data-status=running] i{animation:none}}";
		const tagId = "@cyrus/dsh-trajectory-island/SessionMinimap.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-trajectory-island";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SessionMinimap_module_css_default = {
			"minimapPulse": "wwlXWq_minimapPulse",
			"preview": "wwlXWq_preview",
			"rail": "wwlXWq_rail",
			"tick": "wwlXWq_tick",
			"track": "wwlXWq_track"
		};
		//#endregion
		//#region src/client/SessionMinimap.tsx
		const EMPTY_SUBSCRIBE = () => () => {};
		function conversationScroller() {
			return document.querySelector("[data-conversation-scroll]");
		}
		function measureRail() {
			const scroller = conversationScroller();
			if (scroller === null) return void 0;
			const rect = scroller.getBoundingClientRect();
			if (rect.height < 120 || rect.width < 120) return void 0;
			return {
				top: rect.top + 8,
				height: rect.height - 16,
				left: rect.right - 20
			};
		}
		/** 主刻度类型：该轮有用户消息记 user（长刻度），否则 assistant（短刻度）。 */
		function tickKind(turn) {
			return turn.signals.some((signal) => signal.kind === "user") ? "user" : "assistant";
		}
		function SessionMinimap({ useSessions, resolveSession }) {
			const current = useSessions((state) => state.current);
			const session = current === void 0 ? void 0 : resolveSession(current);
			const subscribe = (0, react.useCallback)((notify) => session?.subscribe(notify) ?? EMPTY_SUBSCRIBE(), [session]);
			const getSnapshot = (0, react.useCallback)(() => session?.getSnapshot() ?? null, [session]);
			const snapshot = (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
			const [geometry, setGeometry] = (0, react.useState)();
			const [activeIndex, setActiveIndex] = (0, react.useState)(-1);
			const [hoverIndex, setHoverIndex] = (0, react.useState)(-1);
			const [hoverTop, setHoverTop] = (0, react.useState)(0);
			const turns = (0, react.useMemo)(() => {
				if (snapshot === null) return [];
				const trajectory = trajectoryOf(snapshot);
				if (trajectory === void 0) return [];
				return deriveTrajectoryIsland({
					turnOrder: snapshot.chat.timeline.turnOrder,
					turnStatus: (turn) => snapshot.chat.timeline.turns.get(turn)?.status,
					nodeKeys: (turn) => snapshot.chat.locations.getTurn(turn),
					node: (key) => {
						const node = snapshot.chat.nodes.get(key);
						return node === void 0 ? void 0 : {
							key: node.key,
							kind: node.kind,
							visibility: node.visibility,
							anchorSeq: node.anchorSeq
						};
					},
					requests: trajectory.requests.flatMap((request) => request.purpose === "assistant" ? [{
						turn: request.turn,
						status: request.status
					}] : request.turn === null ? [] : [{
						turn: request.turn,
						status: request.status
					}]),
					runningToolTurns: trajectory.runningCalls.map((call) => call.turn)
				});
			}, [snapshot]);
			const visible = (0, react.useMemo)(() => turns.slice(-64), [turns]);
			const omitted = turns.length - visible.length;
			(0, react.useEffect)(() => {
				if (visible.length === 0) return;
				let disposed = false;
				const update = () => {
					if (!disposed) setGeometry(measureRail());
				};
				update();
				const observer = new ResizeObserver(update);
				const scroller = conversationScroller();
				if (scroller !== null) observer.observe(scroller);
				window.addEventListener("resize", update);
				const poll = window.setInterval(update, 900);
				return () => {
					disposed = true;
					observer.disconnect();
					window.removeEventListener("resize", update);
					window.clearInterval(poll);
				};
			}, [visible.length, current]);
			(0, react.useEffect)(() => {
				const scroller = conversationScroller();
				if (scroller === null || visible.length === 0) return;
				let frame = 0;
				const onScroll = () => {
					cancelAnimationFrame(frame);
					frame = requestAnimationFrame(() => {
						const rect = scroller.getBoundingClientRect();
						const line = rect.top + rect.height * .35;
						let active = -1;
						for (let index = 0; index < visible.length; index += 1) {
							const key = visible[index]?.anchorKey;
							if (key === void 0) continue;
							const element = [...document.querySelectorAll("[data-chat-anchor-key]")].find((candidate) => candidate.dataset.chatAnchorKey === key);
							if (element !== void 0 && element.getBoundingClientRect().top <= line) active = index;
						}
						setActiveIndex(active);
					});
				};
				onScroll();
				scroller.addEventListener("scroll", onScroll, { passive: true });
				return () => {
					cancelAnimationFrame(frame);
					scroller.removeEventListener("scroll", onScroll);
				};
			}, [visible, current]);
			if (visible.length === 0 || geometry === void 0) return null;
			const jump = (index) => {
				const turn = visible[index];
				if (turn === void 0) return;
				jumpToChatAnchor(turn.anchorKey, omitted + index, turns.length);
			};
			const hoverTurn = hoverIndex >= 0 ? visible[hoverIndex] : void 0;
			let hoverPreview;
			if (hoverTurn !== void 0) {
				const snippet = ((hoverTurn.anchorKey === void 0 ? void 0 : [...document.querySelectorAll("[data-chat-anchor-key]")].find((candidate) => candidate.dataset.chatAnchorKey === hoverTurn.anchorKey))?.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 180);
				const maxTop = window.innerHeight - 120;
				hoverPreview = {
					title: `Turn ${String(hoverTurn.turn)}`,
					snippet: snippet === "" ? "该轮内容尚未渲染到聊天区" : snippet,
					top: Math.min(Math.max(hoverTop - 28, 8), maxTop)
				};
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
				className: SessionMinimap_module_css_default.rail,
				"aria-label": "会话导航轨",
				"data-session-minimap": true,
				style: {
					top: geometry.top,
					height: geometry.height,
					left: geometry.left
				},
				onMouseLeave: () => {
					setHoverIndex(-1);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SessionMinimap_module_css_default.track,
					children: visible.map((turn, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: SessionMinimap_module_css_default.tick,
						"data-kind": tickKind(turn),
						"data-status": turn.status,
						"data-active": index === activeIndex ? "true" : void 0,
						title: `Turn ${String(turn.turn)} · 点击定位`,
						"aria-label": `定位到第 ${String(turn.turn)} 轮`,
						onClick: () => {
							jump(index);
						},
						onMouseEnter: (event) => {
							setHoverIndex(index);
							setHoverTop(event.currentTarget.getBoundingClientRect().top);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {})
					}, turn.turn))
				}), hoverPreview !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: SessionMinimap_module_css_default.preview,
					style: { top: hoverPreview.top - geometry.top },
					role: "tooltip",
					"data-session-minimap-preview": true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: hoverPreview.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: hoverPreview.snippet })]
				})]
			});
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "sessions"];
		/** Register an additive root overlay; upstream layout, conversation and trajectory remain owners. */
		function apply(ctx) {
			const injected = () => ({ resolveSession: (sessionId) => ctx.sessions.binding(sessionId)?.session });
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "personal-session-minimap",
				order: 60,
				inject: injected
			}, SessionMinimap));
		}
		//#endregion
		exports.apply = apply;
		exports.deriveTrajectoryIsland = deriveTrajectoryIsland;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map