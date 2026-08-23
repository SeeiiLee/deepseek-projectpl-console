window.__ModuleLoader__.load({
	id: "@cyrus/dsh-personal-theme",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		const DEFAULT_THEME_CONFIG = Object.freeze({
			fontFamily: "Inter, \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif",
			baseFontSize: 14,
			zoom: 1,
			accentColor: "#4d6bfe",
			backgroundColor: "#f7f8fa",
			sidebarColor: "#f1f2f5",
			textColor: "#171719",
			panelOpacity: .96
		});
		function createDefaultThemeDocument() {
			return {
				version: 1,
				global: { ...DEFAULT_THEME_CONFIG },
				workspaces: {}
			};
		}
		/**
		* Accept a persisted document defensively. Unknown/missing values fall back
		* field-by-field so a partially-written or older file never breaks the UI.
		*/
		function normalizeThemeDocument(value) {
			if (!isRecord$1(value)) return createDefaultThemeDocument();
			const global = normalizeThemeConfig(value.global, DEFAULT_THEME_CONFIG);
			const workspaces = {};
			if (isRecord$1(value.workspaces)) for (const [rawKey, rawConfig] of Object.entries(value.workspaces)) {
				const key = normalizeWorkspaceKey(rawKey);
				if (key === "") continue;
				workspaces[key] = normalizeThemeConfig(rawConfig, global);
			}
			return {
				version: 1,
				global,
				workspaces
			};
		}
		function normalizeThemeConfig(value, fallback = DEFAULT_THEME_CONFIG) {
			const candidate = isRecord$1(value) ? value : {};
			return {
				fontFamily: normalizeText(candidate.fontFamily, fallback.fontFamily, 200),
				baseFontSize: clampNumber(candidate.baseFontSize, 12, 22, fallback.baseFontSize),
				zoom: clampNumber(candidate.zoom, .75, 1.5, fallback.zoom),
				accentColor: normalizeHexColor(candidate.accentColor, fallback.accentColor),
				backgroundColor: normalizeHexColor(candidate.backgroundColor, fallback.backgroundColor),
				sidebarColor: normalizeHexColor(candidate.sidebarColor, fallback.sidebarColor),
				textColor: normalizeHexColor(candidate.textColor, fallback.textColor),
				panelOpacity: clampNumber(candidate.panelOpacity, .35, 1, fallback.panelOpacity)
			};
		}
		/** Stable case-insensitive key for Windows cwd values emitted by sessions. */
		function normalizeWorkspaceKey(cwd) {
			if (cwd === void 0) return "";
			let key = cwd.trim().replaceAll("/", "\\");
			if (key === "") return "";
			while (key.length > 3 && key.endsWith("\\")) key = key.slice(0, -1);
			return /^(?:[a-z]:\\|\\\\)/iu.test(key) ? key.toLocaleLowerCase("en-US") : key;
		}
		function effectiveThemeConfig(document, workspaceKey) {
			return workspaceKey === "" ? document.global : document.workspaces[workspaceKey] ?? document.global;
		}
		function isHexColor(value) {
			return /^#[0-9a-f]{6}$/iu.test(value);
		}
		function normalizeHexColor(value, fallback) {
			if (typeof value !== "string" || !isHexColor(value.trim())) return fallback;
			return value.trim().toLowerCase();
		}
		function normalizeText(value, fallback, maxLength) {
			if (typeof value !== "string") return fallback;
			const normalized = value.trim();
			return normalized === "" ? fallback : normalized.slice(0, maxLength);
		}
		function clampNumber(value, min, max, fallback) {
			const number = typeof value === "number" ? value : NaN;
			if (!Number.isFinite(number)) return fallback;
			return Math.min(max, Math.max(min, number));
		}
		function isRecord$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		//#endregion
		//#region src/client/api-adapter.ts
		/**
		* The sole adapter between this feature and personal-foundation. Keep the
		* endpoint and transport assumptions here so the rest of the theme remains a
		* plain state/UI module.
		*/
		const PERSONAL_THEME_ENDPOINT = "/__personal/api/theme";
		function createThemePersistence(personalApi) {
			const api = personalApi;
			return {
				async read() {
					return normalizeThemeDocument(unwrapDocument(await api.request(PERSONAL_THEME_ENDPOINT, { method: "GET" })));
				},
				async write(document) {
					return normalizeThemeDocument(unwrapDocument(await api.request("/__personal/api/theme", {
						method: "PUT",
						body: document
					})) ?? document);
				}
			};
		}
		function unwrapDocument(value) {
			if (!isRecord(value)) return value;
			if ("document" in value) return value.document;
			return value;
		}
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		//#endregion
		//#region src/client/controller.ts
		var PersonalThemeController = class {
			persistence;
			listeners = /* @__PURE__ */ new Set();
			state = {
				status: "idle",
				document: createDefaultThemeDocument(),
				workspaceCwd: void 0,
				workspaceKey: "",
				scope: "global",
				dirty: false,
				saving: false,
				error: void 0,
				savedAt: void 0
			};
			editRevision = 0;
			loadPromise;
			constructor(persistence) {
				this.persistence = persistence;
			}
			getSnapshot = () => this.state;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			load() {
				this.loadPromise ??= this.performLoad();
				return this.loadPromise;
			}
			setWorkspace(cwd) {
				const workspaceKey = normalizeWorkspaceKey(cwd);
				if (workspaceKey === this.state.workspaceKey && cwd === this.state.workspaceCwd) return;
				this.publish({
					...this.state,
					workspaceCwd: cwd,
					workspaceKey,
					scope: workspaceKey === "" ? "global" : this.state.scope
				});
			}
			setScope(scope) {
				if (scope === "workspace" && this.state.workspaceKey === "") return;
				if (scope === this.state.scope) return;
				this.publish({
					...this.state,
					scope
				});
			}
			hasWorkspaceOverride(state = this.state) {
				return state.workspaceKey !== "" && state.document.workspaces[state.workspaceKey] !== void 0;
			}
			editingConfig(state = this.state) {
				if (state.scope === "workspace") return state.document.workspaces[state.workspaceKey] ?? state.document.global;
				return state.document.global;
			}
			effectiveConfig(state = this.state) {
				return effectiveThemeConfig(state.document, state.workspaceKey);
			}
			enableWorkspaceOverride() {
				const key = this.state.workspaceKey;
				if (key === "" || this.state.document.workspaces[key] !== void 0) return;
				this.commitDocument({
					...this.state.document,
					workspaces: {
						...this.state.document.workspaces,
						[key]: { ...this.state.document.global }
					}
				});
			}
			disableWorkspaceOverride() {
				const key = this.state.workspaceKey;
				if (key === "" || this.state.document.workspaces[key] === void 0) return;
				const workspaces = { ...this.state.document.workspaces };
				delete workspaces[key];
				this.commitDocument({
					...this.state.document,
					workspaces
				});
			}
			updateField(field, value) {
				const state = this.state;
				if (state.scope === "workspace") {
					const current = state.document.workspaces[state.workspaceKey];
					if (current === void 0) return;
					this.commitDocument({
						...state.document,
						workspaces: {
							...state.document.workspaces,
							[state.workspaceKey]: {
								...current,
								[field]: value
							}
						}
					});
					return;
				}
				this.commitDocument({
					...state.document,
					global: {
						...state.document.global,
						[field]: value
					}
				});
			}
			restoreDefaults() {
				if (this.state.scope === "workspace") {
					this.disableWorkspaceOverride();
					return;
				}
				this.commitDocument({
					...this.state.document,
					global: { ...DEFAULT_THEME_CONFIG }
				});
			}
			async save() {
				if (this.state.saving) return;
				const revision = this.editRevision;
				const document = normalizeThemeDocument(this.state.document);
				this.publish({
					...this.state,
					document,
					saving: true,
					error: void 0
				});
				try {
					const stored = normalizeThemeDocument(await this.persistence.write(document));
					if (this.editRevision === revision) this.publish({
						...this.state,
						document: stored,
						status: "ready",
						dirty: false,
						saving: false,
						error: void 0,
						savedAt: Date.now()
					});
					else this.publish({
						...this.state,
						status: "ready",
						saving: false,
						error: void 0
					});
				} catch (error) {
					this.publish({
						...this.state,
						saving: false,
						error: errorMessage(error, "主题保存失败。")
					});
				}
			}
			async performLoad() {
				this.publish({
					...this.state,
					status: "loading",
					error: void 0
				});
				try {
					const document = normalizeThemeDocument(await this.persistence.read());
					this.publish({
						...this.state,
						status: "ready",
						document,
						dirty: false,
						error: void 0
					});
				} catch (error) {
					this.publish({
						...this.state,
						status: "error",
						error: errorMessage(error, "个人主题读取失败，当前使用默认值。")
					});
				}
			}
			commitDocument(document) {
				this.editRevision += 1;
				this.publish({
					...this.state,
					document,
					dirty: true,
					error: void 0
				});
			}
			publish(state) {
				this.state = state;
				for (const listener of [...this.listeners]) listener();
			}
		};
		function errorMessage(error, fallback) {
			if (error instanceof Error && error.message.trim() !== "") return error.message;
			return fallback;
		}
		//#endregion
		//#region src/client/theme-runtime.ts
		const TOKEN_SOURCE = "@cyrus/dsh-personal-theme";
		/** ThemeRuntime override layer for the user's current effective configuration. */
		function buildThemeTokenOverrides(config) {
			const same = (value) => ({
				light: value,
				dark: value
			});
			const panel = withAlpha(config.backgroundColor, config.panelOpacity);
			const nestedPanel = withAlpha(config.backgroundColor, Math.min(1, config.panelOpacity + .035));
			const sidebar = withAlpha(config.sidebarColor, config.panelOpacity);
			const borderSubtle = withAlpha(config.textColor, .07);
			const borderStrong = withAlpha(config.textColor, .14);
			const interactiveHover = withAlpha(config.textColor, .08);
			const interactiveActive = withAlpha(config.textColor, .14);
			const accentForeground = readableForeground(config.accentColor);
			const accentHover = mixHex(config.accentColor, accentForeground === "#ffffff" ? "#ffffff" : "#000000", .12);
			return {
				"--dsw-font-family": same(config.fontFamily),
				"--dsw-alias-brand-primary": same(config.accentColor),
				"--dsw-alias-brand-primary-new-colorprimary-new-color": same(config.accentColor),
				"--dsw-alias-brand-text": same(config.accentColor),
				"--dsw-alias-brand-primary-invert": same(accentForeground),
				"--dsw-alias-button-info-fill": same(config.accentColor),
				"--dsw-alias-button-info-hover": same(accentHover),
				"--dsw-alias-button-primary-fill": same(config.accentColor),
				"--dsw-alias-button-primary-hover": same(accentHover),
				"--dsw-alias-button-primary-dimmed": same(withAlpha(config.accentColor, .35)),
				"--dsw-alias-button-elevated-fill": same(nestedPanel),
				"--dsw-alias-button-floating-fill": same(nestedPanel),
				"--dsw-alias-button-floating-hover": same(interactiveHover),
				"--dsw-alias-button-ghost-active-border": same(borderStrong),
				"--dsw-alias-button-ghost-active-fill": same(interactiveActive),
				"--dsw-alias-button-ghost-active-hover": same(withAlpha(config.textColor, .18)),
				"--dsw-alias-label-primary-foreground": same(accentForeground),
				"--dsw-alias-bg-base": same(config.backgroundColor),
				"--dsw-alias-bg-layer-1": same(panel),
				"--dsw-alias-bg-layer-2": same(nestedPanel),
				"--dsw-alias-bg-layer-3": same(nestedPanel),
				"--dsw-alias-bg-overlay": same(nestedPanel),
				"--dsw-alias-bg-module-platform": same(nestedPanel),
				"--dsw-alias-bg-multi-select": same(nestedPanel),
				"--dsw-alias-bg-skeleton": same(withAlpha(config.textColor, .08)),
				"--dsw-alias-border-l1": same(borderSubtle),
				"--dsw-alias-border-l2-darkmode-thin": same(borderSubtle),
				"--dsw-alias-border-l2": same(borderStrong),
				"--dsw-alias-border-l3": same(withAlpha(config.textColor, .18)),
				"--dsw-alias-border-l4": same(withAlpha(config.textColor, .24)),
				"--dsw-alias-interactive-bg-active": same(interactiveActive),
				"--dsw-alias-interactive-bg-hover-accent": same(withAlpha(config.accentColor, .2)),
				"--dsw-alias-interactive-bg-hover-solid": same(interactiveHover),
				"--dsw-alias-interactive-bg-hover": same(interactiveHover),
				"--dsw-specific-sidebar-fill": same(sidebar),
				"--dsw-specific-sidebar-nav-item-active-accent": same(withAlpha(config.accentColor, .22)),
				"--dsw-specific-sidebar-nav-item-active": same(interactiveActive),
				"--dsw-specific-sidebar-nav-item-hover": same(interactiveHover),
				"--dsw-alias-label-primary": same(config.textColor),
				"--dsw-alias-label-primary-dimmed": same(withAlpha(config.textColor, .88)),
				"--dsw-alias-label-primary-inverted": same(accentForeground),
				"--dsw-alias-label-secondary": same(withAlpha(config.textColor, .72)),
				"--dsw-alias-label-tertiary": same(withAlpha(config.textColor, .56)),
				"--dsw-alias-label-caption": same(withAlpha(config.textColor, .42)),
				"--dsw-alias-label-dimmed": same(withAlpha(config.textColor, .25)),
				"--dsw-alias-markdown-citation": same(interactiveActive),
				"--dsw-alias-markdown-code-block-banner": same(nestedPanel),
				"--dsw-alias-markdown-code-block": same(panel),
				"--dsw-alias-markdown-code-segment-selected": same(interactiveActive),
				"--dsw-alias-markdown-code-segment-unselected": same(interactiveHover),
				"--dsw-alias-markdown-inline-code": same(interactiveActive),
				"--dsw-alias-markdown-placeholder": same(panel),
				"--dsw-alias-markdown-tag": same(interactiveHover),
				"--dsw-alias-scrollbar-bg-l1": same(withAlpha(config.textColor, .16)),
				"--dsw-alias-scrollbar-bg-l2": same(withAlpha(config.textColor, .16)),
				"--dsw-alias-scrollbar-hover-l1": same(withAlpha(config.textColor, .28)),
				"--dsw-alias-scrollbar-hover-l2": same(withAlpha(config.textColor, .28)),
				"--dsw-specific-bubble-highlight": same(withAlpha(config.accentColor, .24)),
				"--dsw-specific-bubble": same(withAlpha(config.accentColor, .12)),
				"--dsw-specific-input-major": same(panel),
				"--dsw-specific-login-input": same(nestedPanel),
				"--dsw-specific-menu": same(nestedPanel),
				"--dsw-specific-selector": same(nestedPanel),
				"--dsw-specific-tip": same(nestedPanel)
			};
		}
		function themeTokenSource() {
			return TOKEN_SOURCE;
		}
		/** Convert the editor's strict #rrggbb colors to an rgba token. */
		function withAlpha(hex, alpha) {
			const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
			if (match === null) return hex;
			return `rgba(${Number.parseInt(match[1] ?? "0", 16)}, ${Number.parseInt(match[2] ?? "0", 16)}, ${Number.parseInt(match[3] ?? "0", 16)}, ${Math.round(Math.min(1, Math.max(0, alpha)) * 1e3) / 1e3})`;
		}
		/** WCAG-style luminance choice for labels placed on the accent color. */
		function readableForeground(hex) {
			const rgb = parseHex(hex);
			if (rgb === void 0) return "#ffffff";
			const channels = rgb.map((channel) => {
				const value = channel / 255;
				return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
			});
			return .2126 * (channels[0] ?? 0) + .7152 * (channels[1] ?? 0) + .0722 * (channels[2] ?? 0) > .2 ? "#111318" : "#ffffff";
		}
		function mixHex(left, right, ratio) {
			const a = parseHex(left);
			const b = parseHex(right);
			if (a === void 0 || b === void 0) return left;
			const weight = Math.min(1, Math.max(0, ratio));
			return `#${a.map((value, index) => Math.round(value * (1 - weight) + (b[index] ?? 0) * weight)).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
		}
		function parseHex(hex) {
			const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
			if (match === null) return void 0;
			return [
				Number.parseInt(match[1] ?? "0", 16),
				Number.parseInt(match[2] ?? "0", 16),
				Number.parseInt(match[3] ?? "0", 16)
			];
		}
		/**
		* Own the three documentElement declarations that are not Harness theme
		* tokens. Disposal restores the exact pre-plugin inline values, but only
		* while the current value is still ours (a later owner is never clobbered).
		*/
		var RootTypographyController = class {
			root;
			original = /* @__PURE__ */ new Map();
			applied = /* @__PURE__ */ new Map();
			constructor(root = document.documentElement) {
				this.root = root;
				for (const property of [
					"font-family",
					"font-size",
					"zoom"
				]) this.original.set(property, this.read(property));
			}
			apply(config) {
				this.write("font-family", config.fontFamily);
				this.write("font-size", `${config.baseFontSize}px`);
				this.write("zoom", String(config.zoom));
			}
			dispose() {
				for (const [property, applied] of this.applied) {
					const current = this.read(property);
					if (current.value !== applied.value || current.priority !== applied.priority) continue;
					const original = this.original.get(property);
					if (original === void 0 || original.value === "") this.root.style.removeProperty(property);
					else this.root.style.setProperty(property, original.value, original.priority);
				}
				this.applied.clear();
			}
			write(property, value) {
				this.root.style.setProperty(property, value);
				this.applied.set(property, this.read(property));
			}
			read(property) {
				return {
					value: this.root.style.getPropertyValue(property),
					priority: this.root.style.getPropertyPriority(property)
				};
			}
		};
		//#endregion
		//#region \0dsh-css:D:\Deepseek Harness Personal\plugins\personal-theme\src\client\PersonalThemeSection.module.css.mjs
		const css = "._6qyASW_section{min-width:0;color:var(--dsw-alias-label-primary);flex-direction:column;gap:20px;padding-bottom:8px;display:flex}._6qyASW_heading{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}._6qyASW_heading h2{margin:0;font-size:20px;font-weight:650;line-height:28px}._6qyASW_heading p{color:var(--dsw-alias-label-secondary);margin:5px 0 0;font-size:13px;line-height:20px}._6qyASW_liveBadge{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);color:var(--dsw-alias-brand-primary);border-radius:999px;flex:none;padding:5px 9px;font-size:11px;font-weight:600}._6qyASW_scopeTabs{background:var(--dsw-alias-bg-layer-2);border-radius:11px;grid-template-columns:1fr 1fr;gap:4px;padding:4px;display:grid}._6qyASW_scopeTabs button{min-height:34px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:8px;font-size:13px}._6qyASW_scopeTabs button:hover:not(:disabled){color:var(--dsw-alias-label-primary)}._6qyASW_scopeTabs button._6qyASW_activeTab{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 4px #0000001f}._6qyASW_scopeTabs button:disabled{opacity:.42;cursor:not-allowed}._6qyASW_workspaceCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:12px;justify-content:space-between;align-items:center;gap:16px;padding:12px 14px;display:flex}._6qyASW_workspaceCopy{flex-direction:column;gap:3px;min-width:0;display:flex}._6qyASW_workspaceCopy strong{text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;overflow:hidden}._6qyASW_workspaceCopy span,._6qyASW_fieldHint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}._6qyASW_switchLabel{cursor:pointer;flex:none;align-items:center;gap:7px;font-size:12px;display:flex}._6qyASW_switchLabel input{accent-color:var(--dsw-alias-brand-primary)}._6qyASW_preview{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;grid-template-columns:92px 1fr;min-height:142px;display:grid;overflow:hidden;box-shadow:0 10px 28px #00000024}._6qyASW_preview aside{border-right:1px solid #ffffff12;flex-direction:column;gap:10px;padding:18px 16px;display:flex}._6qyASW_preview aside i{opacity:.16;background:currentColor;border-radius:99px;width:52px;height:6px}._6qyASW_previewDot{border-radius:6px;width:18px;height:18px;margin-bottom:3px}._6qyASW_previewBody{flex-direction:column;justify-content:center;align-items:flex-start;gap:7px;padding:22px 24px;display:flex}._6qyASW_previewBody strong{font-size:1.05em}._6qyASW_previewBody span{font-size:.84em}._6qyASW_previewButton{font:inherit;border-radius:7px;margin-top:6px;padding:7px 11px;font-size:.78em}._6qyASW_form{border:0;grid-template-columns:1fr 1fr;gap:16px;min-width:0;margin:0;padding:0;display:grid}._6qyASW_form:disabled{opacity:.48}._6qyASW_wideField,._6qyASW_rangeField{flex-direction:column;gap:8px;min-width:0;display:flex}._6qyASW_wideField,._6qyASW_colorGrid{grid-column:1/-1}._6qyASW_fieldTitle{font-size:12px;font-weight:600}._6qyASW_wideField>input[type=text]{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:100%;height:36px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;padding:0 11px;font-size:12px}._6qyASW_wideField>input[type=text]:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)}._6qyASW_rangeHeading{justify-content:space-between;align-items:center;gap:12px;display:flex}._6qyASW_rangeHeading output{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:11px}._6qyASW_rangeField input,._6qyASW_wideField input[type=range]{width:100%;accent-color:var(--dsw-alias-brand-primary)}._6qyASW_colorGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;display:grid}._6qyASW_colorField{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);cursor:pointer;border-radius:10px;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:9px;min-width:0;padding:10px;display:grid}._6qyASW_colorField>span:nth-child(2){flex-direction:column;gap:2px;min-width:0;display:flex}._6qyASW_colorField strong{font-size:12px}._6qyASW_colorField small{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;overflow:hidden}._6qyASW_colorField code{color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code);font-size:10px}._6qyASW_colorSwatch{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;width:32px;height:32px;position:relative;overflow:hidden;box-shadow:inset 0 0 0 2px #ffffff1a}._6qyASW_colorSwatch input{cursor:pointer;opacity:0;width:48px;height:48px;position:absolute;inset:-8px}._6qyASW_colorSwatch:focus-within{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}._6qyASW_actions{justify-content:flex-end;align-items:center;gap:9px;padding-top:2px;display:flex}._6qyASW_saveState{min-height:18px;color:var(--dsw-alias-label-tertiary);margin-right:auto;font-size:11px}._6qyASW_actions button{min-height:34px;font:inherit;cursor:pointer;border-radius:8px;padding:0 13px;font-size:12px;font-weight:600}._6qyASW_actions button:disabled{cursor:not-allowed;opacity:.45}._6qyASW_secondaryButton{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}._6qyASW_primaryButton{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);border:1px solid #0000}._6qyASW_error{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);color:var(--dsw-alias-state-error-primary);border-radius:8px;margin:-6px 0 0;padding:9px 11px;font-size:11px;line-height:17px}._6qyASW_hiddenLegend{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}@media (width<=760px){._6qyASW_form,._6qyASW_colorGrid{grid-template-columns:1fr}._6qyASW_rangeField,._6qyASW_colorGrid{grid-column:1/-1}._6qyASW_preview{grid-template-columns:72px 1fr}._6qyASW_preview aside{padding-inline:11px}._6qyASW_preview aside i{width:42px}}";
		const tagId = "@cyrus/dsh-personal-theme/PersonalThemeSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-personal-theme";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var PersonalThemeSection_module_css_default = {
			"actions": "_6qyASW_actions",
			"activeTab": "_6qyASW_activeTab",
			"colorField": "_6qyASW_colorField",
			"colorGrid": "_6qyASW_colorGrid",
			"colorSwatch": "_6qyASW_colorSwatch",
			"error": "_6qyASW_error",
			"fieldHint": "_6qyASW_fieldHint",
			"fieldTitle": "_6qyASW_fieldTitle",
			"form": "_6qyASW_form",
			"heading": "_6qyASW_heading",
			"hiddenLegend": "_6qyASW_hiddenLegend",
			"liveBadge": "_6qyASW_liveBadge",
			"preview": "_6qyASW_preview",
			"previewBody": "_6qyASW_previewBody",
			"previewButton": "_6qyASW_previewButton",
			"previewDot": "_6qyASW_previewDot",
			"primaryButton": "_6qyASW_primaryButton",
			"rangeField": "_6qyASW_rangeField",
			"rangeHeading": "_6qyASW_rangeHeading",
			"saveState": "_6qyASW_saveState",
			"scopeTabs": "_6qyASW_scopeTabs",
			"secondaryButton": "_6qyASW_secondaryButton",
			"section": "_6qyASW_section",
			"switchLabel": "_6qyASW_switchLabel",
			"wideField": "_6qyASW_wideField",
			"workspaceCard": "_6qyASW_workspaceCard",
			"workspaceCopy": "_6qyASW_workspaceCopy"
		};
		//#endregion
		//#region src/client/PersonalThemeSection.tsx
		const COLOR_FIELDS = [
			{
				field: "accentColor",
				label: "强调色",
				description: "按钮、选中态和重要提示"
			},
			{
				field: "backgroundColor",
				label: "背景色",
				description: "主内容区域的底色"
			},
			{
				field: "sidebarColor",
				label: "侧栏色",
				description: "会话与导航侧栏"
			},
			{
				field: "textColor",
				label: "文字色",
				description: "正文及其弱化层级"
			}
		];
		function PersonalThemeSection({ controller }) {
			const state = (0, react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
			const config = controller.editingConfig(state);
			const workspaceEnabled = controller.hasWorkspaceOverride(state);
			const editingDisabled = state.scope === "workspace" && !workspaceEnabled;
			const fontListId = (0, react.useId)();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: PersonalThemeSection_module_css_default.section,
				"aria-labelledby": "personal-theme-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: PersonalThemeSection_module_css_default.heading,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "personal-theme-title",
							children: "个人主题"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "为 Harness 设置统一外观，也可以让当前工作区拥有独立主题。" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: PersonalThemeSection_module_css_default.liveBadge,
							children: "实时预览"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PersonalThemeSection_module_css_default.scopeTabs,
						role: "tablist",
						"aria-label": "主题配置范围",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							"aria-selected": state.scope === "global",
							className: state.scope === "global" ? PersonalThemeSection_module_css_default.activeTab : void 0,
							onClick: () => {
								controller.setScope("global");
							},
							children: "全局配置"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							"aria-selected": state.scope === "workspace",
							className: state.scope === "workspace" ? PersonalThemeSection_module_css_default.activeTab : void 0,
							disabled: state.workspaceKey === "",
							onClick: () => {
								controller.setScope("workspace");
							},
							children: "当前工作区"
						})]
					}),
					state.scope === "workspace" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PersonalThemeSection_module_css_default.workspaceCard,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PersonalThemeSection_module_css_default.workspaceCopy,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								title: state.workspaceCwd,
								children: state.workspaceCwd ?? "当前 Session 没有工作目录"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: workspaceEnabled ? "正在覆盖全局主题" : "当前继承全局主题" })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: PersonalThemeSection_module_css_default.switchLabel,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: workspaceEnabled,
								disabled: state.workspaceKey === "",
								onChange: (event) => {
									if (event.target.checked) controller.enableWorkspaceOverride();
									else controller.disableWorkspaceOverride();
								}
							}), "使用独立主题"]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ThemePreview, { config }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
						className: PersonalThemeSection_module_css_default.form,
						disabled: editingDisabled || state.status === "loading",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", {
								className: PersonalThemeSection_module_css_default.hiddenLegend,
								children: "主题参数"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: PersonalThemeSection_module_css_default.wideField,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: PersonalThemeSection_module_css_default.fieldTitle,
										children: "字体族"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: PersonalThemeSection_module_css_default.fieldHint,
										children: "支持系统字体名或完整 CSS 字体列表"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "text",
										list: fontListId,
										value: config.fontFamily,
										onChange: (event) => {
											controller.updateField("fontFamily", event.target.value);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("datalist", {
										id: fontListId,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: "Inter, \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: "'Segoe UI', 'Microsoft YaHei', sans-serif" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: "'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: "'Inter', 'Segoe UI', sans-serif" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: "'JetBrains Mono', Consolas, monospace" })
										]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RangeField, {
								label: "基础字号",
								hint: `${formatNumber(config.baseFontSize)} px`,
								min: 12,
								max: 22,
								step: .5,
								value: config.baseFontSize,
								onChange: (value) => {
									controller.updateField("baseFontSize", value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RangeField, {
								label: "整体缩放",
								hint: `${Math.round(config.zoom * 100)}%`,
								min: .75,
								max: 1.5,
								step: .05,
								value: config.zoom,
								onChange: (value) => {
									controller.updateField("zoom", value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: PersonalThemeSection_module_css_default.colorGrid,
								children: COLOR_FIELDS.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: PersonalThemeSection_module_css_default.colorField,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: PersonalThemeSection_module_css_default.colorSwatch,
											style: { backgroundColor: config[item.field] },
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "color",
												value: config[item.field],
												"aria-label": item.label,
												onChange: (event) => {
													controller.updateField(item.field, event.target.value);
												}
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: item.description })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: config[item.field] })
									]
								}, item.field))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RangeField, {
								wide: true,
								label: "面板透明度",
								hint: `${Math.round(config.panelOpacity * 100)}%`,
								min: .35,
								max: 1,
								step: .01,
								value: config.panelOpacity,
								onChange: (value) => {
									controller.updateField("panelOpacity", value);
								}
							})
						]
					}),
					state.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PersonalThemeSection_module_css_default.error,
						role: "alert",
						children: state.error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
						className: PersonalThemeSection_module_css_default.actions,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: PersonalThemeSection_module_css_default.saveState,
								"aria-live": "polite",
								children: state.status === "loading" ? "正在读取…" : state.saving ? "正在保存…" : state.dirty ? "有未保存的修改" : state.savedAt !== void 0 ? "已保存" : ""
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: PersonalThemeSection_module_css_default.secondaryButton,
								disabled: state.saving || state.scope === "workspace" && !workspaceEnabled,
								onClick: () => {
									controller.restoreDefaults();
								},
								children: state.scope === "workspace" ? "恢复继承全局" : "恢复默认"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: PersonalThemeSection_module_css_default.primaryButton,
								disabled: state.saving || !state.dirty,
								onClick: () => {
									controller.save();
								},
								children: "保存主题"
							})
						]
					})
				]
			});
		}
		function ThemePreview({ config }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PersonalThemeSection_module_css_default.preview,
				style: {
					backgroundColor: config.backgroundColor,
					color: config.textColor,
					fontFamily: config.fontFamily,
					fontSize: `${Math.max(12, config.baseFontSize * .875)}px`
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
					style: { backgroundColor: config.sidebarColor },
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: PersonalThemeSection_module_css_default.previewDot,
							style: { backgroundColor: config.accentColor }
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: PersonalThemeSection_module_css_default.previewBody,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "让复杂工作保持清晰" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { opacity: .7 },
							children: "主题会随当前工作区自动切换。"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: PersonalThemeSection_module_css_default.previewButton,
							style: {
								backgroundColor: config.accentColor,
								color: readableForeground(config.accentColor)
							},
							children: "预览按钮"
						})
					]
				})]
			});
		}
		function RangeField(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: props.wide ? PersonalThemeSection_module_css_default.wideField : PersonalThemeSection_module_css_default.rangeField,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: PersonalThemeSection_module_css_default.rangeHeading,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: PersonalThemeSection_module_css_default.fieldTitle,
						children: props.label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("output", { children: props.hint })]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "range",
					min: props.min,
					max: props.max,
					step: props.step,
					value: props.value,
					onChange: (event) => {
						props.onChange(Number(event.target.value));
					}
				})]
			});
		}
		function formatNumber(value) {
			return Number.isInteger(value) ? String(value) : value.toFixed(1);
		}
		//#endregion
		//#region src/client/index.ts
		/** Required Cordis services; module graph ordering is also declared in package.json. */
		const inject = [
			"personalApi",
			"theme",
			"sessions",
			"slots"
		];
		function apply(ctx) {
			const controller = new PersonalThemeController(createThemePersistence(ctx.get("personalApi")));
			const syncWorkspace = () => {
				const sessions = ctx.sessions.list.getSnapshot();
				const current = sessions.current;
				controller.setWorkspace(current === void 0 ? void 0 : sessions.byId[current]?.cwd);
			};
			syncWorkspace();
			ctx.effect(() => ctx.sessions.list.subscribe(syncWorkspace), "personal-theme: current workspace selection");
			ctx.effect(() => {
				const typography = new RootTypographyController();
				let disposeOverride;
				let lastConfig;
				const project = () => {
					const state = controller.getSnapshot();
					if (state.status === "idle" || state.status === "loading") return;
					const config = controller.effectiveConfig(state);
					if (config === lastConfig) return;
					lastConfig = config;
					disposeOverride = ctx.theme.overrideTokens(themeTokenSource(), buildThemeTokenOverrides(config));
					typography.apply(config);
				};
				project();
				const unsubscribe = controller.subscribe(project);
				return () => {
					unsubscribe();
					disposeOverride?.();
					typography.dispose();
				};
			}, "personal-theme: live theme projection");
			const injected = () => ({ controller });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "personal-theme",
				order: 5,
				label: "个人主题",
				inject: injected
			}, PersonalThemeSection));
			controller.load();
		}
		//#endregion
		exports.DEFAULT_THEME_CONFIG = DEFAULT_THEME_CONFIG;
		exports.PersonalThemeController = PersonalThemeController;
		exports.RootTypographyController = RootTypographyController;
		exports.apply = apply;
		exports.buildThemeTokenOverrides = buildThemeTokenOverrides;
		exports.createDefaultThemeDocument = createDefaultThemeDocument;
		exports.effectiveThemeConfig = effectiveThemeConfig;
		exports.inject = inject;
		exports.normalizeThemeConfig = normalizeThemeConfig;
		exports.normalizeThemeDocument = normalizeThemeDocument;
		exports.normalizeWorkspaceKey = normalizeWorkspaceKey;
		exports.readableForeground = readableForeground;
		exports.withAlpha = withAlpha;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map