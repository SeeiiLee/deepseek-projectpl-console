window.__ModuleLoader__.load({
	id: "@cyrus/dsh-workspace-hub",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/reducer.ts
		const WORKSPACE_CONTEXT_ID = "personal-workspace-context";
		const W0_CAPABILITIES = ["read-files"];
		/** 语义签名：任一轴或主根变化即 revision+1；无变化返回原对象引用。 */
		function semanticSignature(inputs, target, primaryMountId) {
			return JSON.stringify([
				target.mode,
				target.consoleProjectId ?? null,
				target.pinMountId ?? null,
				inputs.currentSessionId ?? null,
				inputs.sessionCwd ?? null,
				inputs.nativeWorkspace ? [
					inputs.nativeWorkspace.workspaceId,
					inputs.nativeWorkspace.title,
					inputs.nativeWorkspace.path
				] : null,
				inputs.projectRootMatch ? [inputs.projectRootMatch.projectId, inputs.projectRootMatch.root] : null,
				primaryMountId ?? null
			]);
		}
		function sessionMount(inputs) {
			const matchRoot = inputs.projectRootMatch?.root;
			if (inputs.nativeWorkspace !== void 0) return {
				mountId: "native:" + inputs.nativeWorkspace.workspaceId,
				label: inputs.nativeWorkspace.title,
				kind: "primary",
				path: matchRoot ?? inputs.nativeWorkspace.path,
				access: "read-write",
				trust: "trusted",
				persistence: "global",
				status: "ready",
				capabilities: W0_CAPABILITIES
			};
			if (inputs.currentSessionId === void 0) return void 0;
			return {
				mountId: "session:" + inputs.currentSessionId,
				label: "当前会话工作区",
				kind: "primary",
				...(matchRoot ?? inputs.sessionCwd) !== void 0 && (matchRoot ?? inputs.sessionCwd) !== "" ? { path: matchRoot ?? inputs.sessionCwd } : {},
				access: "read-write",
				trust: "trusted",
				persistence: "session",
				status: "ready",
				capabilities: W0_CAPABILITIES
			};
		}
		function consoleMount(inputs, target) {
			if (target.consoleProjectId === void 0) return void 0;
			return {
				mountId: "project:" + target.consoleProjectId,
				label: target.consoleProjectId,
				kind: "primary",
				...inputs.consoleProjectRoot !== void 0 && inputs.consoleProjectRoot !== "" ? { path: inputs.consoleProjectRoot } : {},
				projectId: target.consoleProjectId,
				access: "read-write",
				trust: "trusted",
				persistence: "project",
				status: inputs.consoleProjectRoot === void 0 || inputs.consoleProjectRoot === "" ? "missing" : "ready",
				capabilities: W0_CAPABILITIES
			};
		}
		/**
		* 解析下一个 Context 快照。
		* @param prev 前一快照（首次为 undefined → revision 1）
		* @param inputs 当前 Session/Workspace 投影
		* @param target 当前目标状态（模式/控制台项目/固定挂载）
		* @param reason 本次变化原因
		* @param changedAt 时间戳（可注入便于测试）
		*/
		function resolveContext(prev, inputs, target, reason, changedAt = (/* @__PURE__ */ new Date()).toISOString()) {
			let primaryMount;
			let status = "unbound";
			let resolvedProjectId;
			if (target.mode === "pinned") {
				const retained = prev?.mounts.find((mount) => mount.mountId === target.pinMountId);
				if (retained !== void 0) {
					primaryMount = retained;
					status = "ready";
				} else status = "missing";
				resolvedProjectId = prev?.resolvedProjectId;
			} else if (target.mode === "follow-console") if (target.consoleProjectId === void 0) status = "unbound";
			else {
				primaryMount = consoleMount(inputs, target);
				status = primaryMount?.status === "ready" ? "ready" : "missing";
				resolvedProjectId = target.consoleProjectId;
			}
			else if (target.mode === "follow-session") if (inputs.currentSessionId === void 0) status = "unbound";
			else {
				const match = inputs.projectRootMatch;
				const rawPath = inputs.nativeWorkspace?.path ?? inputs.sessionCwd;
				const hasPath = rawPath !== void 0 && rawPath !== "";
				primaryMount = sessionMount(inputs);
				status = hasPath ? "ready" : "missing";
				if (hasPath && match !== void 0) resolvedProjectId = match.projectId;
			}
			const primaryMountId = primaryMount?.mountId;
			const signature = semanticSignature(inputs, target, primaryMountId);
			if (prev !== void 0 && prev.revisionKey === signature) return prev;
			const mounts = primaryMount === void 0 ? [] : [primaryMount];
			return {
				contextId: WORKSPACE_CONTEXT_ID,
				revision: (prev?.revision ?? 0) + 1,
				revisionKey: signature,
				mode: target.mode,
				...inputs.currentSessionId !== void 0 ? { currentSessionId: inputs.currentSessionId } : {},
				...inputs.nativeWorkspace !== void 0 ? { nativeWorkspace: {
					workspaceId: inputs.nativeWorkspace.workspaceId,
					title: inputs.nativeWorkspace.title,
					primaryMountId: "native:" + inputs.nativeWorkspace.workspaceId
				} } : {},
				...target.consoleProjectId !== void 0 ? { consoleProjectId: target.consoleProjectId } : {},
				...resolvedProjectId !== void 0 ? { resolvedProjectId } : {},
				...primaryMountId !== void 0 ? { primaryMountId } : {},
				mounts,
				status,
				capabilities: W0_CAPABILITIES,
				changedAt,
				reason
			};
		}
		//#endregion
		//#region src/client/store.ts
		function createSnapshotStore(initial) {
			let snapshot = initial;
			const listeners = /* @__PURE__ */ new Set();
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set(next) {
					if (next === snapshot) return;
					snapshot = next;
					for (const listener of [...listeners]) listener();
				}
			};
		}
		//#endregion
		//#region src/client/projectIndex.ts
		/**
		* W1 Task D：Project Control 紧凑工作区索引与「会话工作区 → 项目根」匹配。
		* 一次 GET /projects/workspace-index 消除旧联动的 N+1；按 updatedAt 指纹缓存避免重复拉取。
		* 匹配结果只作为 Context 投影建议（不写库、不建立 binding；W3 才正式化 Project↔Workspace 绑定）。
		*/
		/**
		* 会话工作区路径匹配项目根：相等或处于根目录内（分隔符边界），多根命中时最长者优先。
		* 与旧 projectWorkspaceLink 同规则（W3 前保持兼容行为）。
		*/
		function matchProjectRoot(workspacePath, roots) {
			const target = canonicalPath(workspacePath);
			if (target === "") return void 0;
			let best;
			let bestLength = -1;
			for (const entry of roots) {
				const root = canonicalPath(entry.root);
				if (root === "") continue;
				if (target !== root && !target.startsWith(root + "\\")) continue;
				if (root.length > bestLength) {
					best = entry;
					bestLength = root.length;
				}
			}
			return best;
		}
		/** 拉取紧凑索引（条件请求：带 etag 时 304 返回 null，零状态更新）。 */
		async function fetchProjectIndex(fetchImpl, etag) {
			const response = await fetchImpl("/__personal/project-control/v1alpha1/projects/workspace-index", {
				cache: "no-store",
				credentials: "same-origin",
				headers: {
					accept: "application/json",
					"x-dsh-personal-client": "1",
					...etag === void 0 ? {} : { "if-none-match": etag }
				}
			});
			if (response.status === 304) return null;
			const envelope = await response.json();
			if (envelope?.ok !== true || !Array.isArray(envelope?.data?.projects)) throw new Error("project-control: 工作区索引不可用");
			const projects = [];
			for (const item of envelope.data.projects) {
				const projectId = typeof item?.projectId === "string" ? item.projectId : "";
				const root = typeof item?.root === "string" ? item.root : "";
				const updatedAt = typeof item?.updatedAt === "string" ? item.updatedAt : "";
				if (projectId === "" || root === "" || updatedAt === "") continue;
				projects.push({
					projectId,
					root,
					updatedAt
				});
			}
			const nextEtag = response.headers.get("etag");
			return nextEtag === null ? { projects } : {
				projects,
				etag: nextEtag
			};
		}
		/** 带指纹缓存的索引加载器：指纹（projectId+updatedAt 列表）不变则不重拉。 */
		var ProjectIndex = class {
			#roots = [];
			#fingerprint;
			#etag;
			#inflight;
			#fetchImpl;
			constructor(fetchImpl) {
				this.#fetchImpl = fetchImpl;
			}
			roots() {
				return this.#roots;
			}
			fingerprint() {
				return JSON.stringify(this.#roots.map((entry) => [entry.projectId, entry.updatedAt]));
			}
			/** 刷新（幂等）：指纹变化或首次才真正拉取；并发调用共享同一次拉取。 */
			async refresh() {
				if (this.#inflight !== void 0) return this.#inflight;
				this.#inflight = (async () => {
					const result = await fetchProjectIndex(this.#fetchImpl, this.#etag);
					if (result === null) return;
					const fingerprint = JSON.stringify(result.projects.map((entry) => [entry.projectId, entry.updatedAt]));
					if (fingerprint !== this.#fingerprint) {
						this.#roots = result.projects;
						this.#fingerprint = fingerprint;
					}
					if (result.etag !== void 0) this.#etag = result.etag;
				})().finally(() => {
					this.#inflight = void 0;
				});
				return this.#inflight;
			}
			/** 强制重拉（例如显式刷新命令）。 */
			async forceRefresh() {
				this.#fingerprint = void 0;
				return this.refresh();
			}
		};
		//#endregion
		//#region src/client/adapter.ts
		/** 带项目匹配的输入投影（纯函数；命令路径与订阅路径共用，避免匹配丢失）。 */
		function withProjectMatch(inputs, roots) {
			const raw = inputs.nativeWorkspace?.path ?? inputs.sessionCwd;
			if (raw === void 0 || raw === "") return inputs;
			const match = matchProjectRoot(raw, roots);
			if (match === void 0) return inputs;
			return {
				...inputs,
				projectRootMatch: match
			};
		}
		/** 归一化：大小写不敏感、两种分隔符统一为反斜杠、去尾分隔符（与旧联动规则镜像）。 */
		function canonicalPath(raw) {
			let path = raw.trim();
			while (path.endsWith("\\") || path.endsWith("/")) path = path.slice(0, -1);
			return path.toLowerCase().replace(/\//g, "\\");
		}
		/** 读取当前投影输入（原生工作区成员优先于会话 cwd，与旧联动一致）。 */
		function projectInputs(sessions, workspaces) {
			const sessionList = sessions.list.getSnapshot();
			const currentSessionId = sessionList.current;
			if (currentSessionId === void 0) return {};
			const membership = workspaces.list.getSnapshot().items.find((item) => item.sessionIds.includes(currentSessionId));
			const sessionCwd = sessionList.byId[currentSessionId]?.cwd;
			if (membership !== void 0 && membership.path !== "") {
				const title = membership.title !== void 0 && membership.title !== "" ? membership.title : membership.path.replace(/[\\/]+$/u, "").split(/[\\/]/u).pop() ?? membership.workspaceId;
				return {
					currentSessionId,
					...sessionCwd !== void 0 && sessionCwd !== "" ? { sessionCwd } : {},
					nativeWorkspace: {
						workspaceId: membership.workspaceId,
						title,
						path: membership.path
					}
				};
			}
			return {
				currentSessionId,
				...sessionCwd !== void 0 && sessionCwd !== "" ? { sessionCwd } : {}
			};
		}
		/** 影子差异：hub 解析的根 vs 旧 workbench 绑定根；返回差异描述或 undefined。 */
		function shadowDifference(workbench, inputs) {
			if (workbench === void 0) return void 0;
			const hubPath = inputs.nativeWorkspace?.path ?? inputs.sessionCwd;
			if (hubPath === void 0 || hubPath === "") return void 0;
			const binding = workbench.getSnapshot().projectWorkspace;
			if (binding === void 0) return void 0;
			if (canonicalPath(hubPath) === canonicalPath(binding.root)) return void 0;
			return {
				hubPath,
				bindingRoot: binding.root,
				projectId: binding.projectId
			};
		}
		/** 安装适配器：返回 dispose。 */
		function installNativeWorkspaceAdapter(input) {
			const { sessions, workspaces, recompute } = input;
			const shadowEnabled = input.shadowEnabled ?? (typeof process === "undefined" || {}.DSH_WORKSPACE_HUB_SHADOW !== "0");
			const projectIndex = input.projectIndex ?? new ProjectIndex(input.fetchImpl ?? globalThis.fetch);
			const onDifference = input.onShadowDifference ?? ((diff) => console.warn("workspace-hub shadow: 旧绑定与 Hub Context 差异", diff));
			let lastInputs = {};
			let disposed = false;
			const read = (inputs, reason) => {
				lastInputs = inputs;
				recompute(inputs, reason);
				if (shadowEnabled) {
					const diff = shadowDifference(input.workbench, inputs);
					if (diff !== void 0) onDifference(diff);
				}
			};
			/** 带项目匹配的输入投影。 */
			const withMatch = (inputs) => withProjectMatch(inputs, projectIndex.roots());
			/** 索引刷新后重算（匹配建议可能变化）；dispose 后不再触发。 */
			const refreshIndex = async () => {
				try {
					await projectIndex.refresh();
					if (disposed) return;
					read(withMatch(projectInputs(sessions, workspaces)), "workspace-changed");
				} catch {}
			};
			const onSessions = () => {
				const inputs = projectInputs(sessions, workspaces);
				const reason = inputs.currentSessionId !== lastInputs.currentSessionId ? "session-changed" : "workspace-changed";
				read(withMatch(inputs), reason);
				refreshIndex();
			};
			const onWorkspaces = () => {
				read(withMatch(projectInputs(sessions, workspaces)), "workspace-changed");
				refreshIndex();
			};
			const offSessions = sessions.list.subscribe(onSessions);
			const offWorkspaces = workspaces.list.subscribe(onWorkspaces);
			read(withMatch(projectInputs(sessions, workspaces)), "initial");
			refreshIndex();
			return () => {
				disposed = true;
				offSessions();
				offWorkspaces();
			};
		}
		//#endregion
		//#region src/client/index.ts
		/** W0：只注入会话与工作区注册表（无 UI、无数据库写）。 */
		const inject = ["sessions", "workspaces"];
		/** 注册 Workspace Hub 只读 Context 服务（W0）。 */
		function apply(ctx) {
			const store = createSnapshotStore(resolveContext(void 0, {}, {
				mode: "follow-session",
				consoleProjectId: void 0,
				pinMountId: void 0
			}, "initial"));
			const target = {
				mode: "follow-session",
				consoleProjectId: void 0,
				pinMountId: void 0
			};
			const recompute = (inputs, reason) => {
				store.set(resolveContext(store.getSnapshot(), inputs, target, reason));
			};
			const projectIndex = new ProjectIndex(globalThis.fetch);
			const currentInputs = () => withProjectMatch(projectInputs(ctx.sessions, ctx.workspaces), projectIndex.roots());
			const workbench = ctx.reflect.get("workbench", false);
			const disposeAdapter = installNativeWorkspaceAdapter({
				sessions: ctx.sessions,
				workspaces: ctx.workspaces,
				recompute,
				projectIndex,
				...workbench !== void 0 ? { workbench } : {}
			});
			const service = {
				getSnapshot: store.getSnapshot,
				subscribe: store.subscribe,
				setMode: async (mode) => {
					target.mode = mode;
					recompute(currentInputs(), "mode-changed");
				},
				pinMount: async (mountId) => {
					target.pinMountId = mountId;
					recompute(currentInputs(), "pinned");
				},
				clearPin: async () => {
					target.pinMountId = void 0;
					recompute(currentInputs(), "unpinned");
				},
				setConsoleProject: (projectId) => {
					target.consoleProjectId = projectId;
					recompute(currentInputs(), "console-project-changed");
				}
			};
			ctx.effect(() => {
				const disposeProvide = ctx.reflect.provide("workspaceHub", service);
				return () => {
					disposeAdapter();
					disposeProvide();
				};
			}, "workspace-hub: context service + native workspace adapter");
		}
		//#endregion
		exports.WORKSPACE_CONTEXT_ID = WORKSPACE_CONTEXT_ID;
		exports.apply = apply;
		exports.canonicalPath = canonicalPath;
		exports.createSnapshotStore = createSnapshotStore;
		exports.inject = inject;
		exports.installNativeWorkspaceAdapter = installNativeWorkspaceAdapter;
		exports.projectInputs = projectInputs;
		exports.resolveContext = resolveContext;
		exports.shadowDifference = shadowDifference;
		exports.withProjectMatch = withProjectMatch;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map