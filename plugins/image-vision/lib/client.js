window.__ModuleLoader__.load({
	id: "@cyrus/dsh-image-vision",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/imageVisionApi.ts
		var ImageVisionApiError = class extends Error {
			code;
			status;
			constructor(message, code, status) {
				super(message);
				this.name = "ImageVisionApiError";
				this.code = code;
				this.status = status;
			}
		};
		function createImageVisionApi(fetchImpl = fetch) {
			const envelope = async (response) => {
				const payload = await response.json();
				if (!response.ok || !payload.ok || payload.data === void 0) throw new ImageVisionApiError(payload.error?.message ?? `识图请求失败（HTTP ${String(response.status)}）。`, payload.error?.code ?? "HTTP_ERROR", response.status);
				return payload.data;
			};
			return {
				listConnections: async (signal) => {
					return (await envelope(await fetchImpl("/__personal/image-vision/connections", {
						cache: "no-store",
						headers: { "x-dsh-image-vision": "1" },
						...signal === void 0 ? {} : { signal }
					}))).connections;
				},
				upload: async (sessionId, blob, signal) => {
					return envelope(await fetchImpl("/__personal/image-vision/upload", {
						method: "POST",
						cache: "no-store",
						headers: {
							"x-dsh-image-vision": "1",
							"x-session-id": sessionId,
							"content-type": blob.type === "" ? "application/octet-stream" : blob.type
						},
						body: blob,
						...signal === void 0 ? {} : { signal }
					}));
				},
				analyze: async (sessionId, connectionId, model, signal) => {
					return envelope(await fetchImpl("/__personal/image-vision/analyze", {
						method: "POST",
						cache: "no-store",
						headers: {
							"x-dsh-image-vision": "1",
							"content-type": "application/json"
						},
						body: JSON.stringify({
							sessionId,
							connectionId,
							model
						}),
						...signal === void 0 ? {} : { signal }
					}));
				}
			};
		}
		//#endregion
		//#region \0dsh-css:D:\Deepseek Harness Personal\plugins\image-vision\src\client\ImageVisionDock.module.css.mjs
		const css = ".kMuznG_dock{z-index:30;flex-direction:column;align-items:flex-end;gap:8px;display:flex;position:absolute;bottom:14px;right:14px}.kMuznG_toggle{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-background-panel,#ffffffeb);font:inherit;cursor:pointer;border-radius:999px;padding:7px 14px;font-size:13px;box-shadow:0 4px 16px #0000001f}.kMuznG_toggle:hover{border-color:var(--dsw-alias-state-business-primary)}.kMuznG_panel{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-background-panel,#fffffff5);width:300px;max-height:70vh;color:var(--dsw-alias-label-primary);border-radius:12px;padding:12px;overflow:auto;box-shadow:0 8px 28px #00000029}.kMuznG_header{justify-content:space-between;align-items:center;margin-bottom:10px;font-size:14px;display:flex}.kMuznG_closeButton{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;font-size:16px}.kMuznG_field{flex-direction:column;gap:4px;margin-bottom:10px;font-size:12px;display:flex}.kMuznG_field>span{color:var(--dsw-alias-label-secondary)}.kMuznG_field small{color:var(--dsw-alias-label-tertiary)}.kMuznG_field select,.kMuznG_field input[type=text]{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit;background:0 0;border-radius:8px;padding:6px 8px;font-size:12px}.kMuznG_fileInput{display:none}.kMuznG_pickButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border-radius:8px;align-self:flex-start;padding:4px 10px;font-size:12px}.kMuznG_imageRow{align-items:center;gap:8px;font-size:12px;display:flex}.kMuznG_thumbnail{object-fit:cover;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;width:56px;height:56px}.kMuznG_analyzeButton{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent);color:#fff;background:var(--dsw-alias-state-business-primary);width:100%;font:inherit;cursor:pointer;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:650}.kMuznG_analyzeButton:disabled{opacity:.45;cursor:not-allowed}.kMuznG_error{color:var(--dsw-alias-state-danger-primary,#e5484d);margin:8px 0 0;font-size:12px}.kMuznG_result{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;margin-top:12px;padding-top:10px;display:flex}.kMuznG_resultMeta{color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;gap:8px;font-size:11px;display:flex}.kMuznG_resultSection{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px}.kMuznG_resultSectionHeader{justify-content:space-between;align-items:center;margin-bottom:4px;font-size:12px;display:flex}.kMuznG_copyButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:999px;padding:1px 8px;font-size:11px}.kMuznG_resultText{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;user-select:text;margin:0;font-size:12px;line-height:1.5}.kMuznG_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px}";
		const tagId = "@cyrus/dsh-image-vision/ImageVisionDock.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-image-vision";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ImageVisionDock_module_css_default = {
			"analyzeButton": "kMuznG_analyzeButton",
			"closeButton": "kMuznG_closeButton",
			"copyButton": "kMuznG_copyButton",
			"dock": "kMuznG_dock",
			"error": "kMuznG_error",
			"field": "kMuznG_field",
			"fileInput": "kMuznG_fileInput",
			"header": "kMuznG_header",
			"hint": "kMuznG_hint",
			"imageRow": "kMuznG_imageRow",
			"panel": "kMuznG_panel",
			"pickButton": "kMuznG_pickButton",
			"result": "kMuznG_result",
			"resultMeta": "kMuznG_resultMeta",
			"resultSection": "kMuznG_resultSection",
			"resultSectionHeader": "kMuznG_resultSectionHeader",
			"resultText": "kMuznG_resultText",
			"thumbnail": "kMuznG_thumbnail",
			"toggle": "kMuznG_toggle"
		};
		//#endregion
		//#region src/client/ImageVisionDock.tsx
		const api = createImageVisionApi();
		const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
		const MODEL_PREFS_KEY = "@cyrus/dsh-image-vision:model:v1";
		function loadSavedModel() {
			try {
				const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(MODEL_PREFS_KEY);
				return typeof raw === "string" && raw.trim() !== "" ? raw.trim().slice(0, 200) : "qwen-vl-plus";
			} catch {
				return "qwen-vl-plus";
			}
		}
		function saveModel(model) {
			try {
				if (typeof localStorage === "undefined") return;
				localStorage.setItem(MODEL_PREFS_KEY, model.trim().slice(0, 200));
			} catch {}
		}
		/**
		* Chat-adjacent image vision dock: pick an image, pick a configured model
		* connection, and read the omnibus result (OCR + description + UI analysis)
		* beside the conversation. Results are copyable and reusable in follow-ups.
		*/
		function ImageVisionDock({ useSessions }) {
			const sessionId = useSessions((state) => state.current);
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [connections, setConnections] = (0, react.useState)([]);
			const [connectionId, setConnectionId] = (0, react.useState)("");
			const [model, setModel] = (0, react.useState)(loadSavedModel);
			const [image, setImage] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const [result, setResult] = (0, react.useState)();
			const fileInput = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!expanded) return;
				const controller = new AbortController();
				api.listConnections(controller.signal).then((items) => {
					if (controller.signal.aborted) return;
					setConnections(items);
					setConnectionId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
				}).catch(() => {
					if (!controller.signal.aborted) setError("模型连接列表读取失败。");
				});
				return () => {
					controller.abort();
				};
			}, [expanded]);
			const pickImage = () => {
				fileInput.current?.click();
			};
			const onFileChosen = (files) => {
				const file = files?.[0];
				setError(void 0);
				setResult(void 0);
				if (file === void 0) return;
				if (!file.type.startsWith("image/")) {
					setError("请选择图片文件。");
					return;
				}
				if (file.size > MAX_IMAGE_BYTES) {
					setError("图片超过 15 MiB 上限。");
					return;
				}
				setImage({
					blob: file,
					name: file.name,
					preview: URL.createObjectURL(file)
				});
			};
			const run = async () => {
				if (busy || image === void 0) return;
				if (sessionId === void 0) {
					setError("当前没有活动会话。");
					return;
				}
				const selected = connections.find((item) => item.id === connectionId);
				if (selected === void 0) {
					setError("请先在连接中心配置一个“模型服务（识图等）”连接。");
					return;
				}
				if (model.trim() === "") {
					setError("请填写模型名。");
					return;
				}
				setBusy(true);
				setError(void 0);
				setResult(void 0);
				try {
					await api.upload(String(sessionId), image.blob);
					const analyzed = await api.analyze(String(sessionId), selected.id, model.trim());
					setResult({
						...analyzed.result,
						connectionLabel: analyzed.connectionLabel
					});
					saveModel(model);
				} catch (runError) {
					setError(runError instanceof Error ? runError.message : "识别没有完成。");
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ImageVisionDock_module_css_default.dock,
				"data-personal-image-vision": true,
				"data-expanded": expanded || void 0,
				children: expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ImageVisionDock_module_css_default.panel,
					role: "dialog",
					"aria-label": "识图面板",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ImageVisionDock_module_css_default.header,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "🖼 识图" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: ImageVisionDock_module_css_default.closeButton,
								type: "button",
								"aria-label": "收起识图面板",
								onClick: () => {
									setExpanded(false);
								},
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ImageVisionDock_module_css_default.field,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "模型连接" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									value: connectionId,
									disabled: busy,
									onChange: (event) => {
										setConnectionId(event.target.value);
									},
									children: [connections.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "暂无模型连接"
									}), connections.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: item.id,
										children: [item.label, item.enabled ? "" : "（已停用）"]
									}, item.id))]
								}),
								connections.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "请先在「连接中心」添加“模型服务（识图等）”。" })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: ImageVisionDock_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "模型名（视觉模型）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								maxLength: 200,
								value: model,
								disabled: busy,
								placeholder: "例如 qwen-vl-plus / gpt-4o-mini",
								onChange: (event) => {
									setModel(event.target.value);
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ImageVisionDock_module_css_default.field,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "图片（≤ 15 MiB，单张）" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									ref: fileInput,
									className: ImageVisionDock_module_css_default.fileInput,
									type: "file",
									accept: "image/*",
									onChange: (event) => {
										onFileChosen(event.target.files);
										event.target.value = "";
									}
								}),
								image === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ImageVisionDock_module_css_default.pickButton,
									type: "button",
									disabled: busy,
									onClick: pickImage,
									children: "选择图片"
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ImageVisionDock_module_css_default.imageRow,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
											className: ImageVisionDock_module_css_default.thumbnail,
											src: image.preview,
											alt: "待识别图片"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: image.name }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: ImageVisionDock_module_css_default.pickButton,
											type: "button",
											disabled: busy,
											onClick: pickImage,
											children: "更换"
										})
									]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ImageVisionDock_module_css_default.analyzeButton,
							type: "button",
							disabled: busy || image === void 0 || sessionId === void 0 || connectionId === "",
							onClick: () => {
								run();
							},
							children: busy ? "识别中…" : "开始识别"
						}),
						error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: ImageVisionDock_module_css_default.error,
							role: "alert",
							children: error
						}),
						result !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ImageVisionDock_module_css_default.result,
							"data-image-vision-result": true,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ImageVisionDock_module_css_default.resultMeta,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: result.connectionLabel ?? "模型" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: result.model }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: result.provider })
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ResultSection, {
									title: "概括",
									text: result.summary
								}),
								result.ocr !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ResultSection, {
									title: "OCR 文字",
									text: result.ocr
								}),
								result.uiAnalysis !== "" && result.uiAnalysis !== "不适用" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ResultSection, {
									title: "界面分析",
									text: result.uiAnalysis
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: ImageVisionDock_module_css_default.hint,
									children: "结果已显示在这里，可逐段复制后回到聊天继续追问。"
								})
							]
						})
					]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: ImageVisionDock_module_css_default.toggle,
					type: "button",
					"aria-label": "打开识图面板",
					onClick: () => {
						setExpanded(true);
					},
					children: "🖼 识图"
				})
			});
		}
		function ResultSection({ title, text }) {
			const [copied, setCopied] = (0, react.useState)(false);
			const copy = async () => {
				try {
					await navigator.clipboard.writeText(text);
					setCopied(true);
					setTimeout(() => {
						setCopied(false);
					}, 1200);
				} catch {}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ImageVisionDock_module_css_default.resultSection,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ImageVisionDock_module_css_default.resultSectionHeader,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: ImageVisionDock_module_css_default.copyButton,
						type: "button",
						onClick: () => {
							copy();
						},
						children: copied ? "已复制" : "复制"
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: ImageVisionDock_module_css_default.resultText,
					children: text
				})]
			});
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots"];
		/** Register the chat-adjacent image vision dock. */
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "personal-image-vision",
				order: 70
			}, ImageVisionDock));
		}
		//#endregion
		exports.ImageVisionDock = ImageVisionDock;
		exports.apply = apply;
		exports.createImageVisionApi = createImageVisionApi;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map