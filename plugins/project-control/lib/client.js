window.__ModuleLoader__.load({
	id: "@cyrus/dsh-project-control",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/projectControlApi.ts
		const API_PREFIX = "/__personal/project-control/v1alpha1";
		const PROJECT_DOCUMENT_ROLES = [
			"readme",
			"prd",
			"devlog",
			"progress",
			"next",
			"current_architecture",
			"decision",
			"other"
		];
		function createProjectControlApi(fetchImpl = fetch) {
			const request = async (method, resource, body, signal) => {
				const serialized = body === void 0 ? void 0 : JSON.stringify(body);
				if (serialized !== void 0 && utf8Bytes(serialized) > 262144) throw apiError("请求内容超过项目控制台 256 KiB 限制。", "BODY_TOO_LARGE");
				const response = await fetchImpl(`${API_PREFIX}${resource}`, {
					method,
					cache: "no-store",
					credentials: "same-origin",
					headers: {
						accept: "application/json",
						"x-dsh-personal-client": "1",
						...serialized === void 0 ? {} : { "content-type": "application/json" }
					},
					...serialized === void 0 ? {} : { body: serialized },
					...signal === void 0 ? {} : { signal }
				});
				const responseText = await response.text();
				if (utf8Bytes(responseText) > 262144) throw apiError("项目控制台响应超过 256 KiB 限制。", "RESPONSE_TOO_LARGE", response.status);
				let payload;
				try {
					payload = JSON.parse(responseText);
				} catch {
					throw apiError("项目控制台返回了无法识别的响应。", "INVALID_RESPONSE", response.status);
				}
				if (!isRecord$1(payload) || payload.ok !== true && payload.ok !== false) throw apiError("项目控制台返回了无法识别的响应。", "INVALID_RESPONSE", response.status);
				if (!response.ok || payload.ok !== true) {
					const error = payload.ok === false && isRecord$1(payload.error) ? payload.error : void 0;
					throw apiError(optionalBoundedText(error?.message, 400) ?? `项目控制台请求失败（HTTP ${String(response.status)}）。`, optionalBoundedText(error?.code, 100) ?? "HTTP_ERROR", response.status);
				}
				return payload.data;
			};
			return {
				getStatus: async (signal) => normalizeStatus(await request("GET", "/status", void 0, signal)),
				listProjects: async (signal) => normalizeProjectList(await request("GET", "/projects", void 0, signal)),
				workspaceStatus: async (projectId, signal) => normalizeProjectWorkspaceStatus(await request("GET", `/projects/${encodeURIComponent(validateIdentifier(projectId, "项目"))}/workspace/status`, void 0, signal)),
				workspaceTree: async (projectId, path, signal) => normalizeProjectWorkspaceTree(await request("GET", `/projects/${encodeURIComponent(validateIdentifier(projectId, "项目"))}/workspace/tree?path=${encodeURIComponent(path)}`, void 0, signal)),
				workspaceFile: async (projectId, path, signal) => normalizeProjectWorkspaceFile(await request("GET", `/projects/${encodeURIComponent(validateIdentifier(projectId, "项目"))}/workspace/file?path=${encodeURIComponent(path)}`, void 0, signal)),
				scan: async (mode, selection, options = {}) => normalizeScanResult(await request("POST", "/intake/scan", {
					mode,
					selection,
					...options.maxDepth === void 0 ? {} : { maxDepth: options.maxDepth }
				}, options.signal)),
				listCandidates: async (options = {}, signal) => {
					const query = new URLSearchParams();
					if (options.jobId !== void 0) query.set("jobId", validateIdentifier(options.jobId, "扫描任务"));
					if (options.view !== void 0) query.set("view", validateCandidateView(options.view));
					if (options.search !== void 0) query.set("search", validateCandidateSearch(options.search));
					if (options.limit !== void 0) query.set("limit", String(validateCandidateLimit(options.limit)));
					if (options.afterCandidateId !== void 0) query.set("afterCandidateId", validateCandidateId(options.afterCandidateId));
					return normalizeCandidateList(await request("GET", `/intake/candidates${query.size === 0 ? "" : `?${query.toString()}`}`, void 0, signal));
				},
				getCandidate: async (candidateId, signal) => normalizeCandidate(await request("GET", `/intake/candidates/${encodeURIComponent(validateCandidateId(candidateId))}`, void 0, signal)),
				setCandidateIgnored: async (candidateId, ignored, expectedRevision, signal) => normalizeCandidate(await request("POST", `/intake/candidates/${encodeURIComponent(validateCandidateId(candidateId))}/ignore`, {
					ignored,
					expectedRevision: validateRevision(expectedRevision)
				}, signal)),
				setCandidatesIgnored: async (candidates, ignored, signal) => normalizeCandidateMutationList(await request("POST", "/intake/candidates/bulk-ignore", {
					ignored,
					candidates: validateCandidateBatch(candidates)
				}, signal)),
				prepareCandidate: async (candidateId, input, signal) => {
					return requiredRecord(requiredRecord(await request("POST", `/intake/candidates/${encodeURIComponent(validateCandidateId(candidateId))}/prepare`, input, signal), "候选注册预检").command, "候选注册指令");
				},
				listTemplates: async (signal) => normalizeTemplateList(await request("GET", "/templates", void 0, signal)),
				prepareCreate: async (input, signal) => normalizePrepareCreateResult(await request("POST", "/intake/prepare-create", input, signal)),
				getProjectDocuments: async (projectId, signal) => normalizeDocumentIndex(await request("GET", `/projects/${encodeURIComponent(validateProjectId(projectId))}/documents`, void 0, signal)),
				refreshProjectDocuments: async (projectId, signal) => normalizeDocumentIndex(await request("POST", `/projects/${encodeURIComponent(validateProjectId(projectId))}/documents/refresh`, void 0, signal)),
				resolveDocumentRebind: async (projectId, proposalId, input, signal) => normalizeRebindResolutionResult(await request("POST", `/projects/${encodeURIComponent(validateProjectId(projectId))}/document-rebinds/${encodeURIComponent(validateProposalId(proposalId))}/resolve`, {
					expectedRevision: validateRevision(input.expectedRevision),
					decision: input.decision,
					...input.candidateRelativePath === void 0 ? {} : { candidateRelativePath: input.candidateRelativePath }
				}, signal)),
				submitLifecycle: async (command, signal) => normalizeLifecycleResult(await request("POST", "/lifecycle", command, signal)),
				listWorkItems: async (projectId, signal) => normalizePagedItems(await request("GET", `/projects/${encodeURIComponent(validateProjectId(projectId))}/work-items`, void 0, signal), "任务列表", normalizeWorkItem),
				listRuns: async (projectId, workItemId, signal) => normalizePagedItems(await request("GET", `/projects/${encodeURIComponent(validateProjectId(projectId))}/runs${workItemId === void 0 ? "" : `?workItemId=${encodeURIComponent(workItemId)}`}`, void 0, signal), "运行列表", normalizeRun),
				listProgressUpdates: async (projectId, signal) => normalizePagedItems(await request("GET", `/projects/${encodeURIComponent(validateProjectId(projectId))}/progress-updates`, void 0, signal), "进展更新列表", normalizeProgressUpdate),
				listReviews: async (projectId, signal) => normalizePagedItems(await request("GET", `/projects/${encodeURIComponent(validateProjectId(projectId))}/reviews`, void 0, signal), "审阅列表", normalizeReview),
				listReviewActions: async (projectId, reviewId, signal) => normalizePagedActions(await request("GET", `/projects/${encodeURIComponent(validateProjectId(projectId))}/reviews/${encodeURIComponent(validateIdentifier(reviewId, "审阅"))}/actions`, void 0, signal), "审阅记录列表"),
				listDecisions: async (projectId, signal) => normalizePagedItems(await request("GET", `/projects/${encodeURIComponent(validateProjectId(projectId))}/decisions`, void 0, signal), "决定列表", normalizeDecision),
				listEvents: async (projectId, afterSequence, signal) => normalizePagedItems(await request("GET", `/projects/${encodeURIComponent(validateProjectId(projectId))}/events${afterSequence === void 0 ? "" : `?afterSequence=${String(afterSequence)}`}`, void 0, signal), "事件列表", normalizeEvent),
				listSessions: async (projectId, signal) => normalizePagedItems(await request("GET", `/projects/${encodeURIComponent(validateProjectId(projectId))}/sessions`, void 0, signal), "会话绑定列表", normalizeSessionBinding),
				listQuarantineItems: async (signal) => {
					const payload = requiredRecord(await request("GET", "/quarantine", void 0, signal), "隔离列表");
					return {
						items: requiredArray(payload.quarantineItems, "隔离列表").map(normalizeQuarantineItem),
						total: requiredInteger(payload.total, "隔离总数", 0)
					};
				},
				resolveQuarantineItem: async (quarantineId, decision, expectedRevision, signal) => normalizeQuarantineItem(await request("POST", `/quarantine/${encodeURIComponent(validateIdentifier(quarantineId, "隔离项"))}/resolve`, {
					expectedRevision: validateRevision(expectedRevision),
					decision
				}, signal)),
				createWorkItem: async (projectId, input, signal) => normalizeWorkItem(await request("POST", `/projects/${encodeURIComponent(validateProjectId(projectId))}/work-items`, {
					title: requiredText(input.title, "任务标题", 500),
					...input.instruction === void 0 ? {} : { instruction: input.instruction },
					...input.acceptance === void 0 ? {} : { acceptance: input.acceptance },
					...input.priority === void 0 ? {} : { priority: input.priority }
				}, signal)),
				setWorkItemStatus: async (projectId, workItemId, status, expectedRevision, signal) => normalizeWorkItem(await request("POST", `/projects/${encodeURIComponent(validateProjectId(projectId))}/work-items/${encodeURIComponent(validateIdentifier(workItemId, "任务"))}/status`, {
					expectedRevision: validateRevision(expectedRevision),
					status
				}, signal)),
				startRun: async (projectId, runId, expectedRevision, signal) => normalizeRun(await request("POST", `/projects/${encodeURIComponent(validateProjectId(projectId))}/runs/${encodeURIComponent(validateIdentifier(runId, "运行"))}/start`, { expectedRevision: validateRevision(expectedRevision) }, signal)),
				requestReview: async (projectId, workItemId, expectedRevision, risk, signal) => normalizeReview(await request("POST", `/projects/${encodeURIComponent(validateProjectId(projectId))}/work-items/${encodeURIComponent(validateIdentifier(workItemId, "任务"))}/review-request`, {
					expectedRevision: validateRevision(expectedRevision),
					...risk === void 0 ? {} : { risk }
				}, signal)),
				decideReview: async (projectId, reviewId, input, signal) => normalizeReview(await request("POST", `/projects/${encodeURIComponent(validateProjectId(projectId))}/reviews/${encodeURIComponent(validateIdentifier(reviewId, "审阅"))}/decide`, {
					expectedRevision: validateRevision(input.expectedRevision),
					decision: input.decision,
					...input.rationale === void 0 ? {} : { rationale: input.rationale }
				}, signal)),
				commentReview: async (projectId, reviewId, comment, signal) => normalizeReviewAction(await request("POST", `/projects/${encodeURIComponent(validateProjectId(projectId))}/reviews/${encodeURIComponent(validateIdentifier(reviewId, "审阅"))}/comment`, { comment: requiredText(comment, "评论内容", 4e3) }, signal))
			};
		}
		function normalizeScanResult(value) {
			const object = requiredRecord(value, "扫描结果");
			const job = normalizeJob(object.job);
			return {
				sourceRoot: normalizeSourceRoot(object.sourceRoot),
				job,
				candidates: requiredArray(object.candidates, "扫描候选").map(normalizeCandidate),
				summary: object.summary === void 0 ? job.summary : normalizeSummary(object.summary),
				issues: object.issues === void 0 ? job.issues : normalizeJobIssues(object.issues)
			};
		}
		function normalizeCandidateList(value) {
			const object = requiredRecord(value, "候选列表");
			const candidates = requiredArray(object.candidates, "候选列表").map(normalizeCandidate);
			const countsObject = object.counts === void 0 ? void 0 : requiredRecord(object.counts, "候选计数");
			return {
				candidates,
				total: requiredInteger(object.total ?? candidates.length, "候选总数", candidates.length),
				counts: countsObject === void 0 ? {
					review: candidates.filter((candidate) => [
						"discovered",
						"conflict",
						"relocation_candidate"
					].includes(candidate.status)).length,
					ignored: candidates.filter((candidate) => candidate.status === "ignored").length,
					history: candidates.filter((candidate) => candidate.status === "imported").length
				} : {
					review: requiredInteger(countsObject.review, "待审阅候选数量", 0),
					ignored: requiredInteger(countsObject.ignored, "已忽略候选数量", 0),
					history: requiredInteger(countsObject.history, "历史候选数量", 0)
				},
				nextCursor: object.nextCursor === void 0 || object.nextCursor === null ? null : validateCandidateId(requiredText(object.nextCursor, "候选分页游标", 200)),
				...object.jobId === void 0 ? {} : { jobId: requiredText(object.jobId, "扫描任务", 200) }
			};
		}
		function normalizeCandidateMutationList(value) {
			return requiredArray(requiredRecord(value, "候选批量操作结果").candidates, "候选批量操作结果").map(normalizeCandidate);
		}
		/** Host DTO compatibility is deliberately centralized here instead of leaking into components. */
		function normalizeCandidate(value) {
			const object = requiredRecord(value, "项目候选");
			const status = requiredText(object.status, "候选状态", 80);
			const historyReason = object.historyReason;
			if (historyReason !== void 0 && historyReason !== "completed" && historyReason !== "superseded") throw apiError("候选历史原因无效。", "INVALID_CANDIDATE");
			const confidence = isRecord$1(object.confidence) ? object.confidence : void 0;
			const detectedMode = optionalBoundedText(object.detectedMode, 40);
			const nameSource = normalizeValueSource(object.nameSource, "名称来源");
			const summarySource = normalizeValueSource(object.summarySource, "摘要来源");
			const manifestProjectId = optionalBoundedText(object.manifestProjectId, 200);
			const documents = requiredArray(object.documents, "候选文档").map(normalizeDocument);
			const issues = requiredArray(object.issues, "候选问题").map(normalizeIssue);
			return {
				candidateId: validateCandidateId(requiredText(object.candidateId, "候选 ID", 200)),
				jobId: validateIdentifier(requiredText(object.jobId, "扫描任务 ID", 200), "扫描任务"),
				revision: requiredInteger(object.revision, "候选修订号", 0),
				rootPath: requiredText(object.rootPath, "项目根目录", 32767),
				suggestedName: requiredText(object.suggestedName, "建议项目名称", 240),
				...nameSource === void 0 ? {} : { nameSource },
				...object.summary === void 0 || object.summary === null ? {} : { summary: requiredText(object.summary, "项目摘要", 1e3) },
				...summarySource === void 0 ? {} : { summarySource },
				evidenceLevel: normalizeEvidenceLevel(object.evidenceLevel ?? confidence?.level),
				evidence: normalizeStringList(object.evidence ?? confidence?.evidence, "候选证据", 100, 500),
				status,
				...historyReason === void 0 ? {} : { historyReason },
				detectedMode: detectedMode === "managed" || detectedMode === "linked_legacy" ? detectedMode : "unknown",
				...manifestProjectId === void 0 ? {} : { manifestProjectId },
				ignored: object.ignored === void 0 ? status === "ignored" : requiredBoolean(object.ignored, "忽略状态"),
				documentCount: object.documentCount === void 0 ? documents.length : requiredInteger(object.documentCount, "候选文档数量", 0),
				issueCount: object.issueCount === void 0 ? issues.length : requiredInteger(object.issueCount, "候选问题数量", 0),
				documents,
				issues
			};
		}
		function isCandidateResourceKey(value) {
			return value !== void 0 && /^can_[A-Za-z0-9-]{8,180}$/.test(value);
		}
		function documentRoleLabel(role) {
			switch (role) {
				case "readme": return "项目说明";
				case "prd": return "产品需求";
				case "devlog": return "开发日志";
				case "progress": return "进展记录";
				case "next": return "下一步";
				case "current_architecture": return "当前架构";
				case "decision": return "架构决策";
				case "other": return "附加资料";
			}
		}
		function normalizeStatus(value) {
			const object = requiredRecord(value, "项目控制台状态");
			const storage = requiredRecord(object.storage, "存储状态");
			const counts = requiredRecord(object.counts, "项目数量");
			const state = requiredText(storage.state, "存储状态值", 80);
			if (![
				"ready",
				"read_only_newer_schema",
				"migration_failed",
				"unavailable"
			].includes(state)) throw invalidResponse("存储状态值");
			return {
				apiVersion: requiredText(object.apiVersion, "API 版本", 100),
				protocolVersion: requiredText(object.protocolVersion, "协议版本", 100),
				storage: {
					state,
					schemaVersion: storage.schemaVersion === null ? null : requiredInteger(storage.schemaVersion, "数据库版本", 0),
					writable: requiredBoolean(storage.writable, "数据库写入状态")
				},
				counts: { projects: counts.projects === null ? null : requiredInteger(counts.projects, "项目数量", 0) },
				capabilities: normalizeStringList(object.capabilities, "Host 能力", 100, 160)
			};
		}
		function normalizeProjectList(value) {
			const object = requiredRecord(value, "项目列表");
			const projects = requiredArray(object.projects, "项目列表").map((item) => {
				const project = requiredRecord(item, "登记项目");
				const mode = optionalBoundedText(project.registrationMode, 40);
				return {
					projectId: requiredText(project.projectId, "项目 ID", 200),
					name: requiredText(project.name, "项目名称", 240),
					registrationMode: mode === "managed" || mode === "linked_legacy" ? mode : "unknown",
					lifecycle: requiredText(project.lifecycle, "项目生命周期", 80),
					updatedAt: requiredText(project.updatedAt, "项目更新时间", 80)
				};
			});
			return {
				projects,
				total: requiredInteger(object.total, "项目总数", projects.length)
			};
		}
		function normalizeProjectWorkspaceStatus(value) {
			const object = requiredRecord(value, "项目工作区状态");
			return {
				projectId: validateIdentifier(requiredText(object.projectId, "项目 ID", 200), "项目"),
				root: requiredText(object.root, "工作区根路径", 2048)
			};
		}
		function normalizeProjectWorkspaceTree(value) {
			const object = requiredRecord(value, "项目工作区目录树");
			return {
				entries: requiredArray(object.entries, "目录条目").map((item) => {
					const entry = requiredRecord(item, "目录条目");
					const kind = requiredText(entry.kind, "条目类型", 20);
					if (kind !== "directory" && kind !== "file") throw invalidResponse("条目类型");
					return {
						name: requiredText(entry.name, "条目名称", 500),
						kind,
						...entry.byteSize === void 0 ? {} : { byteSize: requiredInteger(entry.byteSize, "条目大小", 0) }
					};
				}),
				truncated: optionalBoolean(object.truncated, "截断标记", false)
			};
		}
		function normalizeProjectWorkspaceFile(value) {
			const object = requiredRecord(value, "项目工作区文件");
			const kind = requiredText(object.kind, "文件类型", 20);
			const byteSize = requiredInteger(object.byteSize, "文件大小", 0);
			if (kind === "text") return {
				kind: "text",
				content: requiredText(object.content, "文件内容", 262144),
				truncated: optionalBoolean(object.truncated, "截断标记", false),
				byteSize,
				sha256: requiredText(object.sha256, "内容哈希", 80)
			};
			if (kind === "binary") return {
				kind: "binary",
				byteSize,
				...object.tooLarge === void 0 ? {} : { tooLarge: optionalBoolean(object.tooLarge, "超大标记", false) },
				mime: requiredText(object.mime, "MIME 类型", 100)
			};
			throw invalidResponse("文件类型");
		}
		function optionalBoolean(value, label, fallback) {
			if (value === void 0 || value === null) return fallback;
			if (typeof value !== "boolean") throw invalidResponse(label);
			return value;
		}
		function normalizeJob(value) {
			const object = requiredRecord(value, "扫描任务");
			const mode = requiredText(object.mode, "扫描模式", 40);
			if (mode !== "source-root" && mode !== "project-root") throw invalidResponse("扫描模式");
			return {
				jobId: validateIdentifier(requiredText(object.jobId, "扫描任务 ID", 200), "扫描任务"),
				sourceRootId: validateIdentifier(requiredText(object.sourceRootId, "来源目录 ID", 200), "来源目录"),
				mode,
				status: requiredText(object.status, "扫描任务状态", 80),
				scannerVersion: requiredText(object.scannerVersion, "扫描器版本", 100),
				startedAt: requiredText(object.startedAt, "扫描开始时间", 80),
				...object.completedAt === void 0 || object.completedAt === null ? {} : { completedAt: requiredText(object.completedAt, "扫描完成时间", 80) },
				summary: normalizeSummary(object.summary),
				issues: normalizeJobIssues(object.issues ?? [])
			};
		}
		function normalizeJobIssues(value) {
			return requiredArray(value, "扫描来源问题").map((raw) => {
				const issue = requiredRecord(raw, "扫描来源问题");
				const severity = requiredText(issue.severity, "扫描来源问题等级", 20);
				const status = requiredText(issue.status, "扫描来源问题状态", 20);
				if (![
					"info",
					"warning",
					"error",
					"blocking"
				].includes(severity) || status !== "open" && status !== "resolved") throw invalidResponse("扫描来源问题状态");
				return {
					issueId: requiredText(issue.issueId, "扫描来源问题 ID", 200),
					code: requiredText(issue.code, "扫描来源问题代码", 100),
					severity,
					status,
					message: requiredText(issue.message, "扫描来源问题说明", 500)
				};
			});
		}
		function normalizeSourceRoot(value) {
			const object = requiredRecord(value, "扫描来源目录");
			const kind = requiredText(object.kind, "来源目录类型", 40);
			if (kind !== "source-root" && kind !== "project-root") throw invalidResponse("来源目录类型");
			return {
				sourceRootId: validateIdentifier(requiredText(object.sourceRootId, "来源目录 ID", 200), "来源目录"),
				kind,
				path: requiredText(object.path, "扫描来源目录", 32767),
				revision: requiredInteger(object.revision, "来源目录修订号", 0),
				updatedAt: requiredText(object.updatedAt, "来源目录更新时间", 80)
			};
		}
		function normalizeDocument(value) {
			const object = requiredRecord(value, "候选文档");
			const contentHash = optionalBoundedText(object.contentHash, 80);
			if (contentHash !== void 0 && !/^sha256:[0-9a-f]{64}$/.test(contentHash)) throw invalidResponse("文档内容哈希");
			return {
				documentId: requiredText(object.documentId, "候选文档 ID", 200),
				relativePath: requiredText(object.relativePath, "文档相对路径", 2048),
				suggestedRole: normalizeDocumentRole(object.suggestedRole),
				...contentHash === void 0 ? {} : { contentHash },
				...object.title === void 0 || object.title === null ? {} : { title: requiredText(object.title, "文档标题", 500) },
				evidence: normalizeStringList(object.evidence, "文档证据", 50, 500),
				...object.preview === void 0 || object.preview === null ? {} : { preview: requiredText(object.preview, "文档预览", 4e3) }
			};
		}
		function normalizeIssue(value) {
			const object = requiredRecord(value, "候选问题");
			const severityValue = requiredText(object.severity, "问题级别", 40);
			const severity = severityValue === "info" || severityValue === "warning" || severityValue === "error" || severityValue === "blocking" ? severityValue : "warning";
			const details = object.details;
			const detailsObject = isRecord$1(details) ? details : void 0;
			const message = typeof details === "string" ? requiredText(details, "问题说明", 1e3) : optionalBoundedText(detailsObject?.message, 1e3) ?? optionalBoundedText(detailsObject?.detail, 1e3) ?? summarizeIssueDetails(detailsObject) ?? requiredText(object.code, "问题代码", 100);
			return {
				issueId: requiredText(object.issueId, "问题 ID", 200),
				code: requiredText(object.code, "问题代码", 100),
				severity,
				status: requiredText(object.status, "问题状态", 80),
				message,
				...detailsObject?.relativePath === void 0 ? {} : { relativePath: requiredText(detailsObject.relativePath, "问题路径", 2048) }
			};
		}
		function summarizeIssueDetails(value) {
			if (value === void 0) return void 0;
			const parts = Object.entries(value).flatMap(([key, item]) => {
				if (key === "relativePath" || key === "message" || key === "detail") return [];
				if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") return [];
				const text = `${key}: ${String(item)}`;
				return text.length <= 300 ? [text] : [];
			}).slice(0, 4);
			return parts.length === 0 ? void 0 : parts.join("；");
		}
		function normalizeLifecycleResult(value) {
			const object = requiredRecord(value, "生命周期结果");
			const status = requiredText(object.status, "生命周期状态", 40);
			if (status !== "accepted" && status !== "replayed" && status !== "rejected") throw invalidResponse("生命周期状态");
			const error = object.error === void 0 ? void 0 : requiredRecord(object.error, "生命周期错误");
			if (status === "rejected" && error === void 0) throw invalidResponse("生命周期错误");
			return {
				status,
				...object.projectId === void 0 ? {} : { projectId: requiredText(object.projectId, "项目 ID", 200) },
				...object.aggregateRevision === void 0 ? {} : { aggregateRevision: requiredInteger(object.aggregateRevision, "项目修订号", 1) },
				...error === void 0 ? {} : { error: {
					code: requiredText(error.code, "错误代码", 100),
					message: requiredText(error.message, "错误说明", 500)
				} }
			};
		}
		function normalizeValueSource(value, field) {
			if (value === void 0 || value === null) return void 0;
			if (typeof value === "string") return { relativePath: requiredText(value, field, 2048) };
			const object = requiredRecord(value, field);
			const relativePath = object.relativePath === void 0 ? void 0 : requiredText(object.relativePath, field, 2048);
			const label = object.label === void 0 ? void 0 : requiredText(object.label, field, 500);
			if (relativePath === void 0 && label === void 0) throw invalidResponse(field);
			return {
				...relativePath === void 0 ? {} : { relativePath },
				...label === void 0 ? {} : { label }
			};
		}
		function normalizeEvidenceLevel(value) {
			if (typeof value !== "string") return "unknown";
			switch (value.toLowerCase()) {
				case "high": return "high";
				case "medium": return "medium";
				case "low": return "low";
				default: return "unknown";
			}
		}
		function normalizeDocumentRole(value) {
			return typeof value === "string" && PROJECT_DOCUMENT_ROLES.includes(value) ? value : null;
		}
		function normalizeSummary(value) {
			const object = requiredRecord(value, "扫描摘要");
			const summary = {};
			for (const [key, item] of Object.entries(object)) if (/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key) && Number.isSafeInteger(item) && item >= 0) summary[key] = item;
			return summary;
		}
		function normalizeStringList(value, field, maxItems, maxItemLength) {
			if (value === void 0 || value === null) return [];
			const list = requiredArray(value, field);
			if (list.length > maxItems) throw invalidResponse(field);
			return list.map((item) => {
				if (typeof item === "string") return requiredText(item, field, maxItemLength);
				const object = requiredRecord(item, field);
				return requiredText(object.message ?? object.label ?? object.code, field, maxItemLength);
			});
		}
		function normalizePagedItems(value, field, normalize) {
			const object = requiredRecord(value, field);
			const items = requiredArray(object.items, field).map(normalize);
			return {
				items,
				total: requiredInteger(object.total ?? items.length, "总数", items.length)
			};
		}
		function normalizePagedActions(value, field) {
			const object = requiredRecord(value, field);
			const items = requiredArray(object.actions, field).map(normalizeReviewAction);
			return {
				items,
				total: requiredInteger(object.total ?? items.length, "总数", items.length)
			};
		}
		function normalizeWorkItem(value) {
			const object = requiredRecord(value, "任务");
			const executionStatus = requiredText(object.executionStatus, "执行状态", 40);
			const reviewStatus = requiredText(object.reviewStatus, "审核状态", 40);
			if (![
				"draft",
				"ready",
				"running",
				"paused",
				"blocked",
				"completed",
				"cancelled"
			].includes(executionStatus) || ![
				"not_requested",
				"pending",
				"changes_requested",
				"approved",
				"rejected"
			].includes(reviewStatus)) throw invalidResponse("任务状态");
			return {
				workItemId: validateIdentifier(requiredText(object.workItemId, "任务 ID", 200), "任务"),
				projectId: validateProjectId(requiredText(object.projectId, "项目 ID", 200)),
				title: requiredText(object.title, "任务标题", 500),
				instruction: object.instruction === void 0 || object.instruction === null ? null : requiredText(object.instruction, "任务说明", 2e4),
				acceptance: normalizeStringList(object.acceptance, "验收标准", 50, 1e3),
				executionStatus,
				reviewStatus,
				priority: requiredInteger(object.priority, "优先级", 0),
				revision: requiredInteger(object.revision, "任务修订号", 1),
				createdAt: requiredText(object.createdAt, "任务创建时间", 80),
				updatedAt: requiredText(object.updatedAt, "任务更新时间", 80),
				archivedAt: object.archivedAt === void 0 || object.archivedAt === null ? null : requiredText(object.archivedAt, "任务归档时间", 80)
			};
		}
		function normalizeRun(value) {
			const object = requiredRecord(value, "运行");
			const status = requiredText(object.status, "运行状态", 40);
			if (![
				"queued",
				"running",
				"completed",
				"failed",
				"blocked",
				"orphaned",
				"cancelled"
			].includes(status)) throw invalidResponse("运行状态");
			return {
				runId: validateIdentifier(requiredText(object.runId, "运行 ID", 200), "运行"),
				projectId: validateProjectId(requiredText(object.projectId, "项目 ID", 200)),
				workItemId: validateIdentifier(requiredText(object.workItemId, "任务 ID", 200), "任务"),
				attemptNo: requiredInteger(object.attemptNo, "尝试序号", 1),
				status,
				instructionSnapshot: object.instructionSnapshot === void 0 || object.instructionSnapshot === null ? null : requiredText(object.instructionSnapshot, "指令快照", 2e4),
				acceptanceSnapshot: object.acceptanceSnapshot ?? [],
				revision: requiredInteger(object.revision, "运行修订号", 1),
				createdAt: requiredText(object.createdAt, "运行创建时间", 80),
				startedAt: object.startedAt === void 0 || object.startedAt === null ? null : requiredText(object.startedAt, "运行开始时间", 80),
				completedAt: object.completedAt === void 0 || object.completedAt === null ? null : requiredText(object.completedAt, "运行完成时间", 80),
				updatedAt: requiredText(object.updatedAt, "运行更新时间", 80)
			};
		}
		function normalizeProgressUpdate(value) {
			const object = requiredRecord(value, "进展更新");
			const kind = requiredText(object.kind, "更新类型", 40);
			if (![
				"progress",
				"blocker",
				"completion_declared"
			].includes(kind)) throw invalidResponse("更新类型");
			const completionPercent = object.completionPercent === void 0 || object.completionPercent === null ? null : requiredInteger(object.completionPercent, "完成百分比", 0);
			if (completionPercent !== null && completionPercent > 100) throw invalidResponse("完成百分比");
			return {
				progressUpdateId: validateIdentifier(requiredText(object.progressUpdateId, "更新 ID", 200), "进展更新"),
				projectId: validateProjectId(requiredText(object.projectId, "项目 ID", 200)),
				workItemId: validateIdentifier(requiredText(object.workItemId, "任务 ID", 200), "任务"),
				runId: validateIdentifier(requiredText(object.runId, "运行 ID", 200), "运行"),
				kind,
				summary: requiredText(object.summary, "更新摘要", 1e3),
				needs: normalizeStringList(object.needs, "所需协助", 50, 1e3),
				acceptanceClaims: normalizeStringList(object.acceptanceClaims, "验收声明", 50, 1e3),
				evidence: Array.isArray(object.evidence) ? object.evidence.filter(isRecord$1) : [],
				completionPercent,
				details: object.details === void 0 || object.details === null ? null : requiredText(object.details, "更新详情", 2e4),
				threadId: object.threadId === void 0 || object.threadId === null ? null : requiredText(object.threadId, "会话线程", 128),
				sourceEventId: object.sourceEventId === void 0 || object.sourceEventId === null ? null : requiredText(object.sourceEventId, "来源事件", 80),
				commandId: requiredText(object.commandId, "指令 ID", 200),
				aggregateType: object.aggregateType === "work_item" ? "work_item" : "run",
				aggregateId: requiredText(object.aggregateId, "聚合 ID", 200),
				aggregateRevision: requiredInteger(object.aggregateRevision, "聚合修订号", 1),
				generatedBy: isRecord$1(object.generatedBy) ? object.generatedBy : {},
				createdAt: requiredText(object.createdAt, "更新创建时间", 80)
			};
		}
		function normalizeReview(value) {
			const object = requiredRecord(value, "审阅");
			const status = requiredText(object.status, "审阅状态", 40);
			if (![
				"requested",
				"in_review",
				"approved",
				"rejected",
				"superseded"
			].includes(status)) throw invalidResponse("审阅状态");
			const risk = object.risk === void 0 || object.risk === null ? null : requiredText(object.risk, "风险等级", 40);
			if (risk !== null && ![
				"unrated",
				"low",
				"medium",
				"high"
			].includes(risk)) throw invalidResponse("风险等级");
			return {
				reviewId: validateIdentifier(requiredText(object.reviewId, "审阅 ID", 200), "审阅"),
				projectId: validateProjectId(requiredText(object.projectId, "项目 ID", 200)),
				workItemId: object.workItemId === void 0 || object.workItemId === null ? null : validateIdentifier(requiredText(object.workItemId, "任务 ID", 200), "任务"),
				reviewedWorkItemRevision: object.reviewedWorkItemRevision === void 0 || object.reviewedWorkItemRevision === null ? null : requiredInteger(object.reviewedWorkItemRevision, "被审任务修订号", 1),
				artifactRefs: object.artifactRefs ?? [],
				status,
				risk,
				requestedBy: isRecord$1(object.requestedBy) ? object.requestedBy : {},
				decidedBy: object.decidedBy === void 0 || object.decidedBy === null ? null : isRecord$1(object.decidedBy) ? object.decidedBy : {},
				revision: requiredInteger(object.revision, "审阅修订号", 1),
				createdAt: requiredText(object.createdAt, "审阅创建时间", 80),
				updatedAt: requiredText(object.updatedAt, "审阅更新时间", 80),
				decidedAt: object.decidedAt === void 0 || object.decidedAt === null ? null : requiredText(object.decidedAt, "审阅决定时间", 80)
			};
		}
		function normalizeReviewAction(value) {
			const object = requiredRecord(value, "审阅记录");
			const action = requiredText(object.action, "记录动作", 40);
			if (![
				"comment",
				"request_changes",
				"approve",
				"reject",
				"supersede"
			].includes(action)) throw invalidResponse("记录动作");
			return {
				reviewActionId: validateIdentifier(requiredText(object.reviewActionId, "记录 ID", 200), "审阅记录"),
				reviewId: validateIdentifier(requiredText(object.reviewId, "审阅 ID", 200), "审阅"),
				action,
				actor: isRecord$1(object.actor) ? object.actor : {},
				comment: object.comment === void 0 || object.comment === null ? null : requiredText(object.comment, "评论内容", 4e3),
				createdAt: requiredText(object.createdAt, "记录创建时间", 80)
			};
		}
		function normalizeDecision(value) {
			const object = requiredRecord(value, "决定");
			const status = requiredText(object.status, "决定状态", 40);
			if (![
				"proposed",
				"accepted",
				"rejected",
				"superseded"
			].includes(status)) throw invalidResponse("决定状态");
			return {
				decisionId: validateIdentifier(requiredText(object.decisionId, "决定 ID", 200), "决定"),
				projectId: validateProjectId(requiredText(object.projectId, "项目 ID", 200)),
				workItemId: object.workItemId === void 0 || object.workItemId === null ? null : validateIdentifier(requiredText(object.workItemId, "任务 ID", 200), "任务"),
				title: requiredText(object.title, "决定标题", 300),
				context: object.context === void 0 || object.context === null ? null : requiredText(object.context, "决定背景", 2e4),
				options: object.options ?? [],
				status,
				rationale: object.rationale === void 0 || object.rationale === null ? null : requiredText(object.rationale, "决定理由", 4e3),
				proposedBy: isRecord$1(object.proposedBy) ? object.proposedBy : {},
				decidedBy: object.decidedBy === void 0 || object.decidedBy === null ? null : isRecord$1(object.decidedBy) ? object.decidedBy : {},
				revision: requiredInteger(object.revision, "决定修订号", 1),
				createdAt: requiredText(object.createdAt, "决定创建时间", 80),
				updatedAt: requiredText(object.updatedAt, "决定更新时间", 80),
				decidedAt: object.decidedAt === void 0 || object.decidedAt === null ? null : requiredText(object.decidedAt, "决定时间", 80)
			};
		}
		function normalizeEvent(value) {
			const object = requiredRecord(value, "事件");
			const aggregateType = requiredText(object.aggregateType, "聚合类型", 40);
			if (![
				"project",
				"work_item",
				"run"
			].includes(aggregateType)) throw invalidResponse("聚合类型");
			return {
				eventId: validateIdentifier(requiredText(object.eventId, "事件 ID", 200), "事件"),
				sequence: requiredInteger(object.sequence, "事件序号", 1),
				projectId: validateProjectId(requiredText(object.projectId, "项目 ID", 200)),
				aggregateType,
				aggregateId: requiredText(object.aggregateId, "聚合 ID", 200),
				beforeRevision: requiredInteger(object.beforeRevision, "前修订号", 0),
				afterRevision: requiredInteger(object.afterRevision, "后修订号", 1),
				eventType: requiredText(object.eventType, "事件类型", 100),
				schemaVersion: requiredText(object.schemaVersion, "事件 Schema", 80),
				data: isRecord$1(object.data) ? object.data : {},
				actor: isRecord$1(object.actor) ? object.actor : {},
				provenance: isRecord$1(object.provenance) ? object.provenance : {},
				commandId: requiredText(object.commandId, "指令 ID", 200),
				correlationId: object.correlationId === void 0 || object.correlationId === null ? null : requiredText(object.correlationId, "关联 ID", 200),
				causationId: object.causationId === void 0 || object.causationId === null ? null : requiredText(object.causationId, "起因 ID", 200),
				occurredAt: requiredText(object.occurredAt, "发生时间", 80),
				recordedAt: requiredText(object.recordedAt, "记录时间", 80)
			};
		}
		function normalizeQuarantineItem(value) {
			const object = requiredRecord(value, "隔离项");
			const status = requiredText(object.status, "隔离状态", 40);
			if (![
				"open",
				"resolved",
				"ignored"
			].includes(status)) throw invalidResponse("隔离状态");
			return {
				quarantineId: validateIdentifier(requiredText(object.quarantineId, "隔离 ID", 200), "隔离项"),
				projectId: object.projectId === void 0 || object.projectId === null ? null : validateProjectId(requiredText(object.projectId, "项目 ID", 200)),
				sourceKind: requiredText(object.sourceKind, "来源类型", 100),
				sourceRef: requiredText(object.sourceRef, "来源引用", 512),
				reasonCode: requiredText(object.reasonCode, "隔离原因", 100),
				payloadRef: object.payloadRef === void 0 || object.payloadRef === null ? null : requiredText(object.payloadRef, "载荷引用", 512),
				status,
				details: isRecord$1(object.details) ? object.details : {},
				revision: requiredInteger(object.revision, "隔离修订号", 1),
				createdAt: requiredText(object.createdAt, "隔离创建时间", 80),
				updatedAt: requiredText(object.updatedAt, "隔离更新时间", 80),
				resolvedAt: object.resolvedAt === void 0 || object.resolvedAt === null ? null : requiredText(object.resolvedAt, "隔离处理时间", 80)
			};
		}
		function normalizeSessionBinding(value) {
			const object = requiredRecord(value, "会话绑定");
			return {
				bindingId: validateIdentifier(requiredText(object.bindingId, "绑定 ID", 200), "会话绑定"),
				projectId: validateProjectId(requiredText(object.projectId, "项目 ID", 200)),
				runId: validateIdentifier(requiredText(object.runId, "运行 ID", 200), "运行"),
				harnessInstanceRef: requiredText(object.harnessInstanceRef, "Harness 实例", 127),
				sessionId: requiredText(object.sessionId, "会话 ID", 200),
				threadId: requiredText(object.threadId, "线程 ID", 128),
				createdAt: requiredText(object.createdAt, "绑定时间", 80)
			};
		}
		function validateCandidateId(value) {
			if (!isCandidateResourceKey(value)) throw apiError("候选项目标识无效。", "INVALID_CANDIDATE_ID");
			return value;
		}
		function validateCandidateView(value) {
			if (![
				"review",
				"ignored",
				"history"
			].includes(value)) throw apiError("候选中心视图无效。", "INVALID_CANDIDATE_VIEW");
			return value;
		}
		function validateCandidateSearch(value) {
			if (typeof value !== "string" || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) throw apiError("候选搜索条件无效。", "INVALID_CANDIDATE_SEARCH");
			return value;
		}
		function validateCandidateLimit(value) {
			if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw apiError("候选分页大小无效。", "INVALID_CANDIDATE_LIMIT");
			return value;
		}
		function validateCandidateBatch(candidates) {
			if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 100) throw apiError("候选批量操作必须包含 1 至 100 项。", "INVALID_CANDIDATE_BATCH");
			const normalized = candidates.map((candidate) => ({
				candidateId: validateCandidateId(candidate.candidateId),
				expectedRevision: validateRevision(candidate.expectedRevision)
			}));
			if (new Set(normalized.map((candidate) => candidate.candidateId)).size !== normalized.length) throw apiError("候选批量操作不能包含重复项目。", "INVALID_CANDIDATE_BATCH");
			return normalized;
		}
		function validateProjectId(value) {
			if (!/^prj_[A-Za-z0-9-]{8,180}$/.test(value)) throw apiError("项目标识无效。", "INVALID_PROJECT_ID");
			return value;
		}
		function validateProposalId(value) {
			if (!/^rbd_[A-Za-z0-9-]{8,180}$/.test(value)) throw apiError("重绑提案标识无效。", "INVALID_PROPOSAL_ID");
			return value;
		}
		function validateIdentifier(value, label) {
			if (!/^[A-Za-z][A-Za-z0-9_.:-]{2,199}$/.test(value)) throw apiError(`${label}标识无效。`, "INVALID_IDENTIFIER");
			return value;
		}
		function validateRevision(value) {
			if (!Number.isSafeInteger(value) || value < 0) throw apiError("候选项目修订号无效。", "INVALID_REVISION");
			return value;
		}
		function normalizeTemplateList(value) {
			const templates = requiredArray(requiredRecord(value, "模板列表").templates, "模板列表").map((raw, index) => {
				const template = requiredRecord(raw, `模板 ${String(index + 1)}`);
				return {
					templateId: requiredText(template.templateId, "templateId", 128),
					templateVersion: requiredText(template.templateVersion, "templateVersion", 64),
					displayName: requiredText(template.displayName, "displayName", 120),
					description: optionalBoundedText(template.description, 2e3) ?? null,
					protocolVersion: requiredText(template.protocolVersion, "protocolVersion", 80),
					templateHash: requiredText(template.templateHash, "templateHash", 80)
				};
			});
			return {
				templates,
				total: templates.length
			};
		}
		function normalizePrepareCreateResult(value) {
			const object = requiredRecord(value, "新建项目预检");
			const template = requiredRecord(object.template, "新建项目模板");
			return {
				template: {
					templateId: requiredText(template.templateId, "templateId", 128),
					templateVersion: requiredText(template.templateVersion, "templateVersion", 64),
					displayName: requiredText(template.displayName, "displayName", 120),
					description: optionalBoundedText(template.description, 2e3) ?? null,
					protocolVersion: "project-control.dsh/v1alpha1",
					templateHash: requiredText(template.templateHash, "templateHash", 80)
				},
				projectId: requiredText(object.projectId, "projectId", 80),
				targetDisplayPath: requiredText(object.targetDisplayPath, "targetDisplayPath", 2048),
				directoryName: requiredText(object.directoryName, "directoryName", 120),
				expiresAt: requiredText(object.expiresAt, "expiresAt", 80),
				writePlan: requiredRecord(object.writePlan, "写入计划"),
				command: requiredRecord(object.command, "新建指令")
			};
		}
		function normalizeDocumentIndex(value) {
			const object = requiredRecord(value, "项目文档索引");
			const mode = requiredText(object.mode, "项目模式", 40);
			if (mode !== "linked_legacy" && mode !== "managed") throw invalidResponse("项目模式");
			return {
				projectId: requiredText(object.projectId, "项目 ID", 200),
				mode,
				name: requiredText(object.name, "项目名称", 240),
				revision: requiredInteger(object.revision, "项目修订号", 1),
				locationDisplayPath: optionalBoundedText(object.locationDisplayPath, 32767) ?? null,
				documents: requiredArray(object.documents, "文档状态").map(normalizeDocumentState),
				proposals: requiredArray(object.proposals, "重绑提案").map(normalizeRebindProposal)
			};
		}
		function normalizeDocumentState(value) {
			const object = requiredRecord(value, "文档状态");
			const state = requiredText(object.state, "文档状态", 40);
			const bindingSource = requiredText(object.bindingSource, "绑定来源", 40);
			if (![
				"ok",
				"changed",
				"missing",
				"unreadable"
			].includes(state) || !["user_confirmed", "manifest"].includes(bindingSource)) throw invalidResponse("文档状态");
			const contentHash = optionalBoundedText(object.contentHash, 80);
			if (contentHash !== void 0 && !/^sha256:[0-9a-f]{64}$/.test(contentHash)) throw invalidResponse("文档内容哈希");
			return {
				role: normalizeDocumentRole(object.role) ?? "other",
				relativePath: requiredText(object.relativePath, "文档相对路径", 2048),
				bindingSource,
				state,
				contentHash: contentHash ?? null,
				byteSize: object.byteSize === null || object.byteSize === void 0 ? null : requiredInteger(object.byteSize, "文档字节数", 0),
				parseIssues: requiredArray(object.parseIssues, "解析诊断").map((raw) => {
					const issue = requiredRecord(raw, "解析诊断");
					const severity = requiredText(issue.severity, "诊断级别", 20);
					if (![
						"info",
						"warning",
						"error",
						"blocking"
					].includes(severity)) throw invalidResponse("诊断级别");
					return {
						code: requiredText(issue.code, "诊断代码", 100),
						severity,
						message: requiredText(issue.message, "诊断说明", 1e3),
						line: issue.line === null || issue.line === void 0 ? null : requiredInteger(issue.line, "诊断行号", 1)
					};
				}),
				revision: requiredInteger(object.revision, "文档修订号", 1),
				firstSeenAt: requiredText(object.firstSeenAt, "首次发现时间", 80),
				lastVerifiedAt: requiredText(object.lastVerifiedAt, "上次核对时间", 80)
			};
		}
		function normalizeRebindProposal(value) {
			const object = requiredRecord(value, "重绑提案");
			const status = requiredText(object.status, "提案状态", 40);
			if (![
				"proposed",
				"accepted",
				"rejected",
				"superseded"
			].includes(status)) throw invalidResponse("提案状态");
			const candidates = requiredArray(object.candidateRelativePaths, "重绑候选路径").map((item, index) => requiredText(item, `重绑候选路径 ${String(index + 1)}`, 2048));
			if (candidates.length === 0) throw invalidResponse("重绑候选路径");
			return {
				proposalId: requiredText(object.proposalId, "提案 ID", 200),
				role: normalizeDocumentRole(object.role) ?? "other",
				missingRelativePath: requiredText(object.missingRelativePath, "缺失路径", 2048),
				contentHash: requiredText(object.contentHash, "提案哈希", 80),
				candidateRelativePaths: candidates,
				candidateCount: requiredInteger(object.candidateCount, "候选数量", 1),
				unambiguous: requiredBoolean(object.unambiguous, "候选唯一性"),
				status,
				resolvedRelativePath: optionalBoundedText(object.resolvedRelativePath, 2048) ?? null,
				revision: requiredInteger(object.revision, "提案修订号", 1),
				createdAt: requiredText(object.createdAt, "提案创建时间", 80),
				updatedAt: requiredText(object.updatedAt, "提案更新时间", 80),
				resolvedAt: optionalBoundedText(object.resolvedAt, 80) ?? null,
				applicable: requiredBoolean(object.applicable, "提案可应用性")
			};
		}
		function normalizeRebindResolutionResult(value) {
			const object = requiredRecord(value, "重绑处理结果");
			return {
				proposal: object.proposal === void 0 || object.proposal === null ? null : normalizeRebindProposal(object.proposal),
				projectRevision: requiredInteger(object.projectRevision, "项目修订号", 1)
			};
		}
		function requiredRecord(value, field) {
			if (!isRecord$1(value)) throw invalidResponse(field);
			return value;
		}
		function requiredArray(value, field) {
			if (!Array.isArray(value)) throw invalidResponse(field);
			return value;
		}
		function requiredText(value, field, maxLength) {
			const text = optionalBoundedText(value, maxLength);
			if (text === void 0) throw invalidResponse(field);
			return text;
		}
		function optionalBoundedText(value, maxLength) {
			if (typeof value !== "string") return void 0;
			const normalized = value.trim();
			return normalized.length > 0 && normalized.length <= maxLength ? normalized : void 0;
		}
		function requiredInteger(value, field, minimum) {
			if (!Number.isSafeInteger(value) || value < minimum) throw invalidResponse(field);
			return value;
		}
		function requiredBoolean(value, field) {
			if (typeof value !== "boolean") throw invalidResponse(field);
			return value;
		}
		function invalidResponse(field) {
			return apiError(`项目控制台返回的${field}无效。`, "INVALID_RESPONSE");
		}
		function apiError(message, code, status) {
			return Object.assign(new Error(message), {
				code,
				...status === void 0 ? {} : { status }
			});
		}
		function utf8Bytes(value) {
			return new TextEncoder().encode(value).byteLength;
		}
		function isRecord$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		//#endregion
		//#region src/client/projectControlEvents.ts
		const listeners = /* @__PURE__ */ new Set();
		function subscribeProjectControlChanges(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		function notifyProjectControlChanged() {
			for (const listener of [...listeners]) listener();
		}
		//#endregion
		//#region \0dsh-project-control-css:src/client/CandidateDetails.module.css.mjs
		const css$2 = ".nZzFqa_details{overscroll-behavior:contain;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex;overflow-y:auto}.nZzFqa_header{border-bottom:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 5%, transparent);padding:18px 18px 14px}.nZzFqa_headerRow,.nZzFqa_statusLine,.nZzFqa_sectionHeading,.nZzFqa_documentHeading,.nZzFqa_documentMeta,.nZzFqa_issueList div{align-items:center;display:flex}.nZzFqa_headerRow,.nZzFqa_sectionHeading,.nZzFqa_documentHeading,.nZzFqa_issueList div{justify-content:space-between;gap:10px}.nZzFqa_eyebrow{color:var(--dsw-alias-state-business-primary);letter-spacing:.05em;font-size:.857rem;font-weight:700}.nZzFqa_evidenceBadge,.nZzFqa_statusLine span,.nZzFqa_documentMeta span,.nZzFqa_issueList div span{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;padding:3px 7px;font-size:.786rem;line-height:14px}.nZzFqa_evidenceBadge[data-level=high]{color:var(--dsw-alias-state-success-primary,#4e9962)}.nZzFqa_evidenceBadge[data-level=low],.nZzFqa_evidenceBadge[data-level=unknown]{color:var(--dsw-alias-state-warning-primary,#b07a2e)}.nZzFqa_header h2{margin:10px 0 3px;font-size:1.357rem;line-height:24px}.nZzFqa_absolutePath{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);margin:0;font-family:ui-monospace,Cascadia Mono,Consolas,monospace;font-size:.857rem;line-height:16px}.nZzFqa_statusLine{flex-wrap:wrap;gap:5px;margin-top:10px}.nZzFqa_section{border-bottom:1px solid var(--dsw-alias-border-l2);padding:15px 18px}.nZzFqa_section h3,.nZzFqa_sectionHeading h3{margin:0 0 10px;font-size:1rem;font-weight:650}.nZzFqa_sectionHeading h3{margin:0}.nZzFqa_sectionHeading>span{color:var(--dsw-alias-label-tertiary);font-size:.857rem}.nZzFqa_field{gap:5px;display:grid}.nZzFqa_field>span,.nZzFqa_summaryBox>span{color:var(--dsw-alias-label-secondary);font-size:.857rem;font-weight:600}.nZzFqa_field input,.nZzFqa_documentHeading select{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:inherit;border-radius:8px;font-size:.929rem}.nZzFqa_field input{width:100%;min-height:34px;padding:6px 9px}.nZzFqa_field input:focus-visible,.nZzFqa_documentHeading select:focus-visible,.nZzFqa_primaryButton:focus-visible,.nZzFqa_secondaryButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.nZzFqa_sourceLine{color:var(--dsw-alias-label-tertiary);grid-template-columns:auto minmax(0,1fr);gap:8px;margin:7px 0 0;font-size:.786rem;display:grid}.nZzFqa_sourceLine code{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Cascadia Mono,Consolas,monospace;overflow:hidden}.nZzFqa_summaryBox{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 68%, transparent);border-radius:9px;margin-top:13px;padding:10px}.nZzFqa_summaryBox p{color:var(--dsw-alias-label-secondary);margin:5px 0 0;font-size:.929rem;line-height:17px}.nZzFqa_evidenceList,.nZzFqa_issueList,.nZzFqa_documentList{gap:7px;margin:10px 0 0;padding:0;list-style:none;display:grid}.nZzFqa_evidenceList li{color:var(--dsw-alias-label-secondary);padding-left:12px;font-size:.857rem;line-height:16px}.nZzFqa_evidenceList li:before{width:12px;color:var(--dsw-alias-state-business-primary);content:\"•\";margin-left:-12px;display:inline-block}.nZzFqa_issueList li{border:1px solid var(--dsw-alias-border-l2);border-left-width:3px;border-radius:8px;padding:9px}.nZzFqa_issueList li[data-severity=blocking],.nZzFqa_issueList li[data-severity=error]{border-left-color:var(--dsw-alias-state-error-primary,#bf5252)}.nZzFqa_issueList li[data-severity=warning]{border-left-color:var(--dsw-alias-state-warning-primary,#b07a2e)}.nZzFqa_issueList strong{font-size:.857rem}.nZzFqa_issueList p{color:var(--dsw-alias-label-secondary);margin:5px 0 0;font-size:.857rem;line-height:16px}.nZzFqa_issueList code{overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);margin-top:5px;font-size:.786rem;display:block}.nZzFqa_documentCard{border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 58%, transparent);border-radius:10px;min-width:0;padding:10px}.nZzFqa_documentHeading>div{min-width:0}.nZzFqa_documentHeading strong,.nZzFqa_documentHeading code{text-overflow:ellipsis;white-space:nowrap;display:block;overflow:hidden}.nZzFqa_documentHeading strong{font-size:.929rem}.nZzFqa_documentHeading code{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:.786rem}.nZzFqa_documentHeading select{max-width:118px;min-height:30px;padding:4px 7px}.nZzFqa_lockedBinding{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 24%, transparent);max-width:138px;color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, transparent);text-align:center;border-radius:999px;padding:5px 8px;font-size:.786rem;line-height:14px}.nZzFqa_documentMeta{flex-wrap:wrap;gap:4px;margin-top:8px}.nZzFqa_preview{max-height:130px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);white-space:pre-wrap;overflow-wrap:anywhere;border-radius:7px;margin:8px 0 0;padding:8px;font-family:ui-monospace,Cascadia Mono,Consolas,monospace;font-size:.786rem;line-height:15px;overflow:auto}.nZzFqa_emptyCopy{color:var(--dsw-alias-label-tertiary);margin:10px 0 0;font-size:.857rem}.nZzFqa_actions{z-index:1;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);gap:9px;margin-top:auto;padding:16px 18px 20px;display:grid;position:sticky;bottom:0}.nZzFqa_impactNote{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 24%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, transparent);border-radius:9px;gap:3px;padding:10px;display:grid}.nZzFqa_impactNote strong{font-size:.857rem}.nZzFqa_impactNote span{color:var(--dsw-alias-label-secondary);font-size:.786rem;line-height:15px}.nZzFqa_primaryButton,.nZzFqa_secondaryButton{min-height:34px;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:7px 12px;font-size:.929rem;font-weight:600}.nZzFqa_primaryButton{color:var(--dsw-alias-label-on-color,#fff);background:var(--dsw-alias-state-business-primary)}.nZzFqa_primaryButton:disabled{opacity:.48;cursor:default}.nZzFqa_secondaryButton{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);margin-top:10px}.nZzFqa_validation,.nZzFqa_submitError,.nZzFqa_submitStatus{margin:0;font-size:.857rem;line-height:16px}.nZzFqa_validation,.nZzFqa_submitError{color:var(--dsw-alias-state-error-primary,#bf5252)}.nZzFqa_submitStatus{color:var(--dsw-alias-state-success-primary,#4e9962)}.nZzFqa_message{text-align:center;place-content:center;min-height:260px;padding:24px;display:grid}.nZzFqa_message h2{margin:0;font-size:1.143rem}.nZzFqa_message p{max-width:280px;color:var(--dsw-alias-label-secondary);margin:7px 0 0;font-size:.929rem;line-height:18px}.nZzFqa_visuallyHidden{clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}.nZzFqa_sectionHeadingTools{align-items:center;gap:8px;display:flex}.nZzFqa_autoResolveButton{border:1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary,#b07a2e) 45%, transparent);color:var(--dsw-alias-state-warning-primary,#b07a2e);font:inherit;cursor:pointer;background:0 0;border-radius:999px;padding:4px 9px;font-size:.857rem;font-weight:600}.nZzFqa_autoResolveButton:hover{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#b07a2e) 10%, transparent)}.nZzFqa_documentCard.nZzFqa_roleConflict{border-left:3px solid var(--dsw-alias-state-warning-primary,#b07a2e)}.nZzFqa_conflictBadge{color:var(--dsw-alias-state-warning-primary,#b07a2e);background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#b07a2e) 12%, transparent);border-radius:999px;flex:none;padding:3px 7px;font-size:.786rem;line-height:14px}.nZzFqa_conflictBadge[data-kind=primary]{color:var(--dsw-alias-state-success-primary,#4e9962);background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#4e9962) 12%, transparent)}@media (width<=420px){.nZzFqa_header,.nZzFqa_section,.nZzFqa_actions{padding-left:12px;padding-right:12px}.nZzFqa_documentHeading{flex-direction:column;align-items:stretch}.nZzFqa_documentHeading select{width:100%;max-width:none}.nZzFqa_lockedBinding{max-width:none}}";
		const tagId$2 = "@cyrus/dsh-project-control/CandidateDetails.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-project-control";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var CandidateDetails_module_css_default = {
			"absolutePath": "nZzFqa_absolutePath",
			"actions": "nZzFqa_actions",
			"autoResolveButton": "nZzFqa_autoResolveButton",
			"conflictBadge": "nZzFqa_conflictBadge",
			"details": "nZzFqa_details",
			"documentCard": "nZzFqa_documentCard",
			"documentHeading": "nZzFqa_documentHeading",
			"documentList": "nZzFqa_documentList",
			"documentMeta": "nZzFqa_documentMeta",
			"emptyCopy": "nZzFqa_emptyCopy",
			"evidenceBadge": "nZzFqa_evidenceBadge",
			"evidenceList": "nZzFqa_evidenceList",
			"eyebrow": "nZzFqa_eyebrow",
			"field": "nZzFqa_field",
			"header": "nZzFqa_header",
			"headerRow": "nZzFqa_headerRow",
			"impactNote": "nZzFqa_impactNote",
			"issueList": "nZzFqa_issueList",
			"lockedBinding": "nZzFqa_lockedBinding",
			"message": "nZzFqa_message",
			"preview": "nZzFqa_preview",
			"primaryButton": "nZzFqa_primaryButton",
			"roleConflict": "nZzFqa_roleConflict",
			"secondaryButton": "nZzFqa_secondaryButton",
			"section": "nZzFqa_section",
			"sectionHeading": "nZzFqa_sectionHeading",
			"sectionHeadingTools": "nZzFqa_sectionHeadingTools",
			"sourceLine": "nZzFqa_sourceLine",
			"statusLine": "nZzFqa_statusLine",
			"submitError": "nZzFqa_submitError",
			"submitStatus": "nZzFqa_submitStatus",
			"summaryBox": "nZzFqa_summaryBox",
			"validation": "nZzFqa_validation",
			"visuallyHidden": "nZzFqa_visuallyHidden"
		};
		//#endregion
		//#region src/client/CandidateDetails.tsx
		const api$3 = createProjectControlApi();
		function CandidateDetails({ candidateId }) {
			const [reloadKey, setReloadKey] = (0, react.useState)(0);
			const [state, setState] = (0, react.useState)({ kind: "loading" });
			const [displayName, setDisplayName] = (0, react.useState)("");
			const [documentChoices, setDocumentChoices] = (0, react.useState)({});
			const [submitState, setSubmitState] = (0, react.useState)({ kind: "idle" });
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setState({ kind: "loading" });
				setSubmitState({ kind: "idle" });
				api$3.getCandidate(candidateId, controller.signal).then((candidate) => {
					setState({
						kind: "ready",
						candidate
					});
					setDisplayName(candidate.suggestedName);
					setDocumentChoices(Object.fromEntries(candidate.documents.map((document) => [document.documentId, defaultDocumentChoice(document.suggestedRole)])));
				}, (error) => {
					if (controller.signal.aborted) return;
					setState({
						kind: "error",
						message: error instanceof Error ? error.message : "候选项目详情暂时无法读取。"
					});
				});
				return () => {
					controller.abort();
				};
			}, [candidateId, reloadKey]);
			const effectiveChoices = (0, react.useMemo)(() => {
				if (state.kind !== "ready") return {};
				return Object.fromEntries(state.candidate.documents.map((document) => [document.documentId, documentChoices[document.documentId] ?? defaultDocumentChoice(document.suggestedRole)]));
			}, [documentChoices, state]);
			const roleConflictGroups = (0, react.useMemo)(() => {
				const groups = /* @__PURE__ */ new Map();
				if (state.kind !== "ready" || state.candidate.detectedMode === "managed") return groups;
				for (const document of state.candidate.documents) {
					const role = effectiveChoices[document.documentId];
					if (role === void 0 || role === "ignore") continue;
					const list = groups.get(role);
					if (list === void 0) groups.set(role, [document.documentId]);
					else list.push(document.documentId);
				}
				for (const [role, ids] of [...groups]) if (ids.length < 2) groups.delete(role);
				return groups;
			}, [effectiveChoices, state]);
			const roleConflictPrimaries = (0, react.useMemo)(() => {
				const primaries = /* @__PURE__ */ new Map();
				if (state.kind !== "ready") return primaries;
				for (const [role, ids] of roleConflictGroups) {
					const ranked = [...ids].sort((leftId, rightId) => {
						const left = state.candidate.documents.find((document) => document.documentId === leftId);
						return (state.candidate.documents.find((document) => document.documentId === rightId)?.evidence.length ?? 0) - (left?.evidence.length ?? 0);
					});
					primaries.set(role, ranked[0]);
				}
				return primaries;
			}, [roleConflictGroups, state]);
			const registrationError = (0, react.useMemo)(() => {
				if (state.kind !== "ready") return void 0;
				if (state.candidate.status === "ignored") return "请先在项目控制台恢复这个候选，再进行登记。";
				if (state.candidate.status === "imported") return "这个候选已经加入项目控制台。";
				const name = displayName.trim();
				if (name.length === 0 || name.length > 120) return "显示名称应为 1–120 个字符。";
				if (state.candidate.detectedMode !== "managed") {
					const missingHash = state.candidate.documents.find((document) => documentChoices[document.documentId] !== "ignore" && document.contentHash === void 0);
					if (missingHash !== void 0) return missingHash.relativePath + " 缺少内容哈希，请设为“不参与索引”后重试。";
					for (const document of state.candidate.documents) {
						const role = effectiveChoices[document.documentId];
						if (role === void 0 || role === "ignore" || !roleConflictGroups.has(role)) continue;
						const ids = roleConflictGroups.get(role);
						const shown = ids.slice(0, 3).map((id) => {
							return state.candidate.documents.find((candidateDocument) => candidateDocument.documentId === id)?.relativePath ?? id;
						});
						const extra = ids.length > 3 ? " 等 " + String(ids.length) + " 份" : "";
						return "“" + documentRoleLabel(role) + "”只能选择一份主文档（冲突：" + shown.join("、") + extra + "），其余请设为其他角色或不参与索引，或使用「自动处理重复角色」。";
					}
				}
				if (state.candidate.issues.some((issue) => issue.severity === "blocking" && issue.status !== "resolved")) return "这个候选仍有阻断问题，需要先处理或重新扫描。";
			}, [
				displayName,
				documentChoices,
				effectiveChoices,
				roleConflictGroups,
				state
			]);
			const roleConflictKind = (documentId) => {
				for (const [role, ids] of roleConflictGroups) {
					if (!ids.includes(documentId)) continue;
					return roleConflictPrimaries.get(role) === documentId ? "primary" : "duplicate";
				}
			};
			const roleConflictExtras = [...roleConflictGroups.values()].reduce((count, ids) => count + ids.length - 1, 0);
			const autoResolveRoleConflicts = () => {
				if (state.kind !== "ready") return;
				const updates = {};
				for (const [role, ids] of roleConflictGroups) {
					const primary = roleConflictPrimaries.get(role);
					for (const id of ids) if (id !== primary) updates[id] = "ignore";
				}
				setDocumentChoices((current) => ({
					...current,
					...updates
				}));
				setSubmitState({ kind: "idle" });
			};
			const submit = async () => {
				if (state.kind !== "ready" || registrationError !== void 0) return;
				const candidate = state.candidate;
				const documentBindings = candidate.detectedMode === "managed" ? [] : candidate.documents.flatMap((document) => {
					const role = documentChoices[document.documentId] ?? defaultDocumentChoice(document.suggestedRole);
					if (role === "ignore" || document.contentHash === void 0) return [];
					return [{
						role,
						relativePath: document.relativePath,
						contentHash: document.contentHash
					}];
				});
				setSubmitState({
					kind: "working",
					message: "正在生成只关联指令…"
				});
				try {
					const command = await api$3.prepareCandidate(candidate.candidateId, {
						registrationMode: candidate.detectedMode === "managed" ? "managed" : "linked_legacy",
						name: displayName.trim(),
						documentBindings,
						expectedRevision: candidate.revision
					});
					setSubmitState({
						kind: "working",
						message: "正在登记项目…"
					});
					const result = await api$3.submitLifecycle(command);
					if (result.status === "rejected") {
						setSubmitState({
							kind: "error",
							message: result.error?.message ?? "只关联指令没有被 Host 接受。"
						});
						return;
					}
					setSubmitState({
						kind: "success",
						message: result.status === "replayed" ? "这项变更此前已完成，状态已同步。" : candidate.status === "relocation_candidate" ? "项目位置已重新绑定。" : candidate.detectedMode === "managed" ? "现有受管理项目已登记。" : "项目已只读关联到控制台。"
					});
					notifyProjectControlChanged();
				} catch (error) {
					setSubmitState({
						kind: "error",
						message: error instanceof Error ? error.message : "项目登记没有完成。"
					});
				}
			};
			if (state.kind === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailMessage, {
				title: "正在读取候选项目",
				copy: "路径、文档与冲突仍在由 Host 确认。"
			});
			if (state.kind === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailMessage, {
				title: "无法读取候选项目",
				copy: state.message,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: CandidateDetails_module_css_default.secondaryButton,
					type: "button",
					onClick: () => {
						setReloadKey((value) => value + 1);
					},
					children: "重试"
				})
			});
			const { candidate } = state;
			const relocation = candidate.status === "relocation_candidate";
			const managedExisting = candidate.detectedMode === "managed";
			const actionLabel = relocation ? "重新绑定位置" : managedExisting ? "登记现有受管理项目" : "只关联，不修改项目文件";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: CandidateDetails_module_css_default.details,
				"data-project-control-candidate-details": candidate.candidateId,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: CandidateDetails_module_css_default.header,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CandidateDetails_module_css_default.headerRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: CandidateDetails_module_css_default.eyebrow,
									children: "Gate 2C · 候选审阅"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: CandidateDetails_module_css_default.evidenceBadge,
									"data-level": candidate.evidenceLevel,
									children: [evidenceLevelLabel(candidate.evidenceLevel), "证据"]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: candidate.suggestedName }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: CandidateDetails_module_css_default.absolutePath,
								title: candidate.rootPath,
								children: candidate.rootPath
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CandidateDetails_module_css_default.statusLine,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: candidateStatusLabel$1(candidate.status) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: candidate.detectedMode === "managed" ? "检测到受管理 manifest" : "现有项目" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["修订 ", candidate.revision] })
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: CandidateDetails_module_css_default.section,
						"aria-labelledby": `candidate-${candidate.candidateId}-identity`,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								id: `candidate-${candidate.candidateId}-identity`,
								children: "名称与摘要"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: CandidateDetails_module_css_default.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "控制台显示名称" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: displayName,
									maxLength: 120,
									readOnly: managedExisting,
									"aria-readonly": managedExisting,
									onChange: (event) => {
										setDisplayName(event.target.value);
										setSubmitState({ kind: "idle" });
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceLine, {
								label: "名称依据",
								source: candidate.nameSource,
								fallback: "项目文件夹名"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CandidateDetails_module_css_default.summaryBox,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "一句话简介" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: candidate.summary ?? "未识别；当前不会根据普通文档段落猜测目标。" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceLine, {
										label: "摘要依据",
										source: candidate.summarySource,
										fallback: "无明确结构化来源"
									})
								]
							}),
							candidate.evidence.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: CandidateDetails_module_css_default.evidenceList,
								"aria-label": "候选识别证据",
								children: candidate.evidence.map((evidence, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: evidence }, `${evidence}-${String(index)}`))
							})
						]
					}),
					candidate.issues.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: CandidateDetails_module_css_default.section,
						"aria-labelledby": `candidate-${candidate.candidateId}-issues`,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							id: `candidate-${candidate.candidateId}-issues`,
							children: "问题与冲突"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: CandidateDetails_module_css_default.issueList,
							children: candidate.issues.map((issue) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								"data-severity": issue.severity,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: issue.code }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: severityLabel(issue.severity) })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: issue.message }),
									issue.relativePath !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: issue.relativePath })
								]
							}, issue.issueId))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: CandidateDetails_module_css_default.section,
						"aria-labelledby": `candidate-${candidate.candidateId}-documents`,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: CandidateDetails_module_css_default.sectionHeading,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								id: `candidate-${candidate.candidateId}-documents`,
								children: "文档映射"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CandidateDetails_module_css_default.sectionHeadingTools,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [candidate.documents.length, " 项"] }), roleConflictExtras > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									className: CandidateDetails_module_css_default.autoResolveButton,
									type: "button",
									"data-project-control-auto-resolve-roles": true,
									onClick: autoResolveRoleConflicts,
									children: [
										"自动处理重复角色（",
										roleConflictExtras,
										" 份）"
									]
								})]
							})]
						}), candidate.documents.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: CandidateDetails_module_css_default.emptyCopy,
							children: "没有发现可安全索引的文档。"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: CandidateDetails_module_css_default.documentList,
							children: candidate.documents.map((document) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: CandidateDetails_module_css_default.documentCard + (roleConflictKind(document.documentId) === void 0 ? "" : " " + CandidateDetails_module_css_default.roleConflict),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: CandidateDetails_module_css_default.documentHeading,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: document.title ?? fileName(document.relativePath) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
												title: document.relativePath,
												children: document.relativePath
											})] }),
											roleConflictKind(document.documentId) !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CandidateDetails_module_css_default.conflictBadge,
												"data-kind": roleConflictKind(document.documentId),
												"data-project-control-role-conflict": roleConflictKind(document.documentId),
												children: roleConflictKind(document.documentId) === "primary" ? "将保留此份" : "重复角色"
											}),
											managedExisting ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CandidateDetails_module_css_default.lockedBinding,
												children: manifestLockedRole(document) === void 0 ? "未由 manifest 绑定" : `manifest 已锁定：${documentRoleLabel(manifestLockedRole(document))}`
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: CandidateDetails_module_css_default.visuallyHidden,
												children: [
													"设置 ",
													document.relativePath,
													" 的文档角色"
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												value: documentChoices[document.documentId] ?? defaultDocumentChoice(document.suggestedRole),
												onChange: (event) => {
													setDocumentChoices((current) => ({
														...current,
														[document.documentId]: event.target.value
													}));
													setSubmitState({ kind: "idle" });
												},
												children: [PROJECT_DOCUMENT_ROLES.map((role) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: role,
													children: documentRoleLabel(role)
												}, role)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "ignore",
													children: "不参与索引"
												})]
											})] })
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: CandidateDetails_module_css_default.documentMeta,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											title: document.contentHash,
											children: shortHash(document.contentHash)
										}), document.evidence.map((evidence, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: evidence }, `${evidence}-${String(index)}`))]
									}),
									document.preview !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
										className: CandidateDetails_module_css_default.preview,
										children: document.preview
									})
								]
							}, document.documentId))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
						className: CandidateDetails_module_css_default.actions,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CandidateDetails_module_css_default.impactNote,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: ["本次影响：", actionLabel] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: relocation ? "Host 只更新全局位置绑定；不会移动、改名或重写项目资料。" : managedExisting ? "Host 将验证现有 manifest 并登记其镜像；不会创建或改写受管理文件。" : "名称覆盖和文档映射只保存在 Project Control；不会移动、改名或重写现有资料。" })]
							}),
							registrationError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: CandidateDetails_module_css_default.validation,
								role: "alert",
								children: registrationError
							}),
							submitState.kind !== "idle" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: submitState.kind === "error" ? CandidateDetails_module_css_default.submitError : CandidateDetails_module_css_default.submitStatus,
								role: submitState.kind === "error" ? "alert" : "status",
								"aria-live": "polite",
								children: submitState.message
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: CandidateDetails_module_css_default.primaryButton,
								type: "button",
								disabled: registrationError !== void 0 || submitState.kind === "working" || submitState.kind === "success",
								onClick: () => {
									submit();
								},
								children: submitState.kind === "working" ? "正在处理…" : submitState.kind === "success" ? "已完成" : actionLabel
							})
						]
					})
				]
			});
		}
		function defaultDocumentChoice(role) {
			return role ?? "ignore";
		}
		function manifestLockedRole(document) {
			return document.suggestedRole !== null && document.evidence.some((evidence) => evidence.toLocaleLowerCase("en-US").startsWith("manifest:")) ? document.suggestedRole : void 0;
		}
		function DetailMessage({ title, copy, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: CandidateDetails_module_css_default.message,
				role: "status",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: title }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: copy }),
					children
				]
			});
		}
		function SourceLine({ label, source, fallback }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
				className: CandidateDetails_module_css_default.sourceLine,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: source?.relativePath ?? source?.label ?? fallback })]
			});
		}
		function evidenceLevelLabel(level) {
			switch (level) {
				case "high": return "高";
				case "medium": return "中";
				case "low": return "低";
				case "unknown": return "未知";
			}
		}
		function candidateStatusLabel$1(status) {
			switch (status) {
				case "discovered": return "待确认";
				case "ignored": return "已忽略";
				case "registered": return "已登记";
				case "imported": return "已登记";
				case "relocation_candidate": return "位置待重绑";
				case "conflict": return "需要处理";
				default: return status;
			}
		}
		function severityLabel(severity) {
			switch (severity) {
				case "blocking": return "阻断";
				case "error": return "错误";
				case "warning": return "提醒";
				case "info": return "信息";
			}
		}
		function fileName(relativePath) {
			return relativePath.split("/").at(-1) ?? relativePath;
		}
		function shortHash(hash) {
			return hash === void 0 ? "未生成内容哈希" : `${hash.slice(0, 15)}…${hash.slice(-8)}`;
		}
		//#endregion
		//#region src/client/directoryBridge.ts
		function hasProjectControlDirectoryBridge() {
			return typeof window.deepseekHarnessPersonal?.projectControl?.selectDirectory === "function";
		}
		async function selectProjectDirectory(kind) {
			const selectDirectory = window.deepseekHarnessPersonal?.projectControl?.selectDirectory;
			if (typeof selectDirectory !== "function") return {
				kind: "error",
				message: "目录选择服务只在 DeepSeek Harness Personal 桌面客户端中可用。"
			};
			try {
				return parseDirectorySelectionResult(await selectDirectory(kind), kind);
			} catch (error) {
				return {
					kind: "error",
					message: error instanceof Error && error.message.trim().length > 0 ? error.message : "目录选择没有完成，请重试。"
				};
			}
		}
		function parseDirectorySelectionResult(value, expectedKind) {
			if (!isRecord(value)) return invalidBridgeResponse();
			if (value.ok === true && value.canceled === true) return { kind: "cancelled" };
			if (value.ok === false) return {
				kind: "error",
				message: boundedText(value.reason, 240) ?? "目录选择没有完成，请重试。"
			};
			if (value.ok !== true || value.canceled !== false) return invalidBridgeResponse();
			const path = boundedText(value.path, 32767);
			if (path === void 0 || !isRecord(value.authorization)) return invalidBridgeResponse();
			const authorization = value.authorization;
			const kind = authorization.kind;
			const expiresAt = boundedText(authorization.expiresAt, 64);
			const nonce = boundedText(authorization.nonce, 512);
			const signature = boundedText(authorization.signature, 2048);
			if (authorization.version !== 1 || kind !== expectedKind || expiresAt === void 0 || Number.isNaN(Date.parse(expiresAt)) || nonce === void 0 || signature === void 0) return invalidBridgeResponse();
			if (Date.parse(expiresAt) <= Date.now()) return {
				kind: "error",
				message: "目录授权已经过期，请重新选择目录。"
			};
			return {
				kind: "selected",
				selection: {
					path,
					authorization: {
						version: 1,
						kind: expectedKind,
						expiresAt,
						nonce,
						signature
					}
				}
			};
		}
		function invalidBridgeResponse() {
			return {
				kind: "error",
				message: "目录选择服务返回了无法识别的响应。"
			};
		}
		function boundedText(value, maxLength) {
			if (typeof value !== "string") return void 0;
			const normalized = value.trim();
			return normalized.length > 0 && normalized.length <= maxLength ? normalized : void 0;
		}
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		//#endregion
		//#region \0dsh-project-control-css:src/client/ProjectConsole.module.css.mjs
		const css$1 = ".Za-ZGq_console{width:100%;min-height:0;color:var(--dsw-alias-label-primary);flex-direction:column;gap:10px;display:flex}.Za-ZGq_header{border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:10px;display:flex}.Za-ZGq_headerMain{flex-direction:column;gap:4px;min-width:0;display:flex}.Za-ZGq_headerMain h2{margin:0;font-size:17px;line-height:24px}.Za-ZGq_projectId{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;margin:0;font-size:12px;overflow:hidden}.Za-ZGq_headerActions{flex:none;gap:8px;display:flex}.Za-ZGq_backButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:8px;align-self:flex-start;padding:2px 8px;font-size:12px}.Za-ZGq_backButton:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}.Za-ZGq_smallButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 5%, transparent);font:inherit;cursor:pointer;border-radius:8px;padding:4px 10px;font-size:12px}.Za-ZGq_smallButton:hover:not(:disabled){border-color:var(--dsw-alias-border-l3)}.Za-ZGq_smallButton:disabled{opacity:.45;cursor:not-allowed}.Za-ZGq_smallButton[data-pinned=true]{border-color:var(--dsw-alias-state-business-primary)}.Za-ZGq_confirmButton{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent);color:#fff;background:var(--dsw-alias-state-business-primary);font:inherit;cursor:pointer;border-radius:8px;padding:4px 12px;font-size:12px;font-weight:650}.Za-ZGq_confirmButton:hover:not(:disabled){filter:brightness(1.08)}.Za-ZGq_confirmButton:disabled{opacity:.45;cursor:not-allowed}.Za-ZGq_iconButton{border:1px solid var(--dsw-alias-border-l2);width:30px;height:30px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:8px;place-items:center;font-size:15px;display:grid}.Za-ZGq_iconButton:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}.Za-ZGq_tabs{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;gap:4px;display:flex;overflow-x:auto}.Za-ZGq_tab{color:var(--dsw-alias-label-secondary);font:inherit;white-space:nowrap;cursor:pointer;background:0 0;border:0;border-bottom:2px solid #0000;align-items:center;gap:6px;padding:8px 14px;font-size:13px;display:flex;position:relative}.Za-ZGq_tab:hover{color:var(--dsw-alias-label-primary)}.Za-ZGq_tab[aria-selected=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary);font-weight:650}.Za-ZGq_countBadge{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);border-radius:999px;padding:0 6px;font-size:11px}.Za-ZGq_tabPanel{min-height:0;overflow:auto}.Za-ZGq_errorBanner{border:1px solid color-mix(in srgb, var(--dsw-alias-state-danger-primary,#e5484d) 45%, transparent);color:var(--dsw-alias-state-danger-primary,#e5484d);border-radius:8px;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;font-size:12px;display:flex}.Za-ZGq_tabNotice{color:var(--dsw-alias-label-tertiary);text-align:center;padding:28px 16px;font-size:13px}.Za-ZGq_emptyCopy{color:var(--dsw-alias-label-tertiary);margin:4px 0;font-size:12px}.Za-ZGq_overview{flex-direction:column;gap:14px;display:flex}.Za-ZGq_statGrid{grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;display:grid}.Za-ZGq_statCard{border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 4%, transparent);border-radius:10px;flex-direction:column;gap:2px;padding:12px;display:flex}.Za-ZGq_statCard strong{font-size:22px;line-height:28px}.Za-ZGq_statCard span{color:var(--dsw-alias-label-secondary);font-size:12px}.Za-ZGq_statCard small{color:var(--dsw-alias-label-tertiary);font-size:11px}.Za-ZGq_overviewFacts{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;flex-direction:column;gap:8px;padding:12px;display:flex}.Za-ZGq_overviewFacts h3{margin:0;font-size:13px}.Za-ZGq_overviewFacts dl{flex-direction:column;gap:4px;margin:0;font-size:12px;display:flex}.Za-ZGq_overviewFacts dl>div{gap:10px;display:flex}.Za-ZGq_overviewFacts dt{color:var(--dsw-alias-label-tertiary);min-width:72px}.Za-ZGq_overviewFacts dd{margin:0}.Za-ZGq_sectionBar{justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;display:flex}.Za-ZGq_sectionBar h3{margin:0;font-size:14px}.Za-ZGq_itemList{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}.Za-ZGq_itemCard{border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 3%, transparent);border-radius:10px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}.Za-ZGq_itemMain{min-width:0;color:inherit;font:inherit;text-align:left;cursor:default;background:0 0;border:0;flex-direction:column;gap:4px;padding:0;display:flex}button.Za-ZGq_itemMain{cursor:pointer}button.Za-ZGq_itemMain:hover strong{text-decoration:underline}.Za-ZGq_itemTopline{justify-content:space-between;align-items:center;gap:10px;min-width:0;display:flex}.Za-ZGq_itemTopline strong{text-overflow:ellipsis;white-space:nowrap;font-size:13px;overflow:hidden}.Za-ZGq_priorityBadge{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);border-radius:999px;flex:none;padding:1px 7px;font-size:11px}.Za-ZGq_itemInstruction{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}.Za-ZGq_acceptanceList{color:var(--dsw-alias-label-secondary);margin:2px 0 0;padding-left:16px;font-size:12px}.Za-ZGq_itemMeta{color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;align-items:center;gap:10px;font-size:11px;display:flex}.Za-ZGq_itemActions{flex-wrap:wrap;gap:8px;display:flex}.Za-ZGq_statusBadge{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 8px;font-size:11px}.Za-ZGq_statusBadge[data-value=running],.Za-ZGq_statusBadge[data-value=pending],.Za-ZGq_statusBadge[data-value=requested],.Za-ZGq_statusBadge[data-value=in_review]{color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent)}.Za-ZGq_statusBadge[data-value=blocked],.Za-ZGq_statusBadge[data-value=failed],.Za-ZGq_statusBadge[data-value=rejected]{color:var(--dsw-alias-state-danger-primary,#e5484d);border-color:color-mix(in srgb, var(--dsw-alias-state-danger-primary,#e5484d) 40%, transparent)}.Za-ZGq_statusBadge[data-value=completed],.Za-ZGq_statusBadge[data-value=approved]{color:var(--dsw-alias-state-success-primary,#46a758);border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary,#46a758) 40%, transparent)}.Za-ZGq_createItemForm{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;flex-direction:column;gap:8px;margin-bottom:12px;padding:12px;display:flex}.Za-ZGq_createItemForm label{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;font-size:12px;display:flex}.Za-ZGq_createItemForm input,.Za-ZGq_createItemForm textarea,.Za-ZGq_reviewDecide textarea{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-background-panel,transparent);font:inherit;border-radius:8px;padding:6px 8px;font-size:12px}.Za-ZGq_formActions{flex-wrap:wrap;gap:8px;display:flex}.Za-ZGq_reviewDetail{border-top:1px dashed var(--dsw-alias-border-l2);flex-direction:column;gap:10px;padding-top:8px;display:flex}.Za-ZGq_actionList{flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;display:flex}.Za-ZGq_actionList li{align-items:baseline;gap:8px;font-size:12px;display:flex}.Za-ZGq_actionList li strong{flex:none;min-width:56px}.Za-ZGq_actionList li small{color:var(--dsw-alias-label-tertiary);margin-left:auto}.Za-ZGq_reviewDecide{flex-direction:column;gap:8px;display:flex}.Za-ZGq_reviewDecide textarea{resize:vertical;width:100%}.Za-ZGq_updateList{flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;display:flex}.Za-ZGq_updateList>li{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}.Za-ZGq_updateMain{box-sizing:border-box;width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;flex-direction:column;gap:4px;padding:8px 10px;display:flex}.Za-ZGq_updateMain:hover{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 5%, transparent)}.Za-ZGq_updateKindBadge{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);border-radius:999px;padding:1px 7px;font-size:11px}.Za-ZGq_updateKindBadge[data-kind=blocker]{color:var(--dsw-alias-state-danger-primary,#e5484d)}.Za-ZGq_updateKindBadge[data-kind=completion_declared]{color:var(--dsw-alias-state-success-primary,#46a758)}.Za-ZGq_eventList{flex-direction:column;gap:4px;margin:8px 0 0;padding:0;list-style:none;display:flex}.Za-ZGq_eventList>li{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:flex-start;gap:10px;padding:6px 0;display:flex}.Za-ZGq_eventDot{background:var(--dsw-alias-state-business-primary);border-radius:999px;flex:none;width:7px;height:7px;margin-top:5px}.Za-ZGq_eventMain{flex-direction:column;gap:2px;min-width:0;display:flex}.Za-ZGq_eventMain strong{font-size:12px}.Za-ZGq_eventAggregate{color:var(--dsw-alias-label-tertiary);font-size:11px}.Za-ZGq_eventData{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;display:block;overflow:hidden}.Za-ZGq_eventTime{color:var(--dsw-alias-label-tertiary);flex:none;margin-left:auto;font-size:11px}.Za-ZGq_documentPath{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;overflow:hidden}.Za-ZGq_followBanner{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent);color:var(--dsw-alias-state-business-primary);border-radius:8px;padding:8px 12px;font-size:12px}.Za-ZGq_currentBadge{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);border-radius:999px;padding:1px 7px;font-size:11px}.Za-ZGq_itemCard[data-current-session=true]{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent)}";
		const tagId$1 = "@cyrus/dsh-project-control/ProjectConsole.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-project-control";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var ProjectConsole_module_css_default = {
			"acceptanceList": "Za-ZGq_acceptanceList",
			"actionList": "Za-ZGq_actionList",
			"backButton": "Za-ZGq_backButton",
			"confirmButton": "Za-ZGq_confirmButton",
			"console": "Za-ZGq_console",
			"countBadge": "Za-ZGq_countBadge",
			"createItemForm": "Za-ZGq_createItemForm",
			"currentBadge": "Za-ZGq_currentBadge",
			"documentPath": "Za-ZGq_documentPath",
			"emptyCopy": "Za-ZGq_emptyCopy",
			"errorBanner": "Za-ZGq_errorBanner",
			"eventAggregate": "Za-ZGq_eventAggregate",
			"eventData": "Za-ZGq_eventData",
			"eventDot": "Za-ZGq_eventDot",
			"eventList": "Za-ZGq_eventList",
			"eventMain": "Za-ZGq_eventMain",
			"eventTime": "Za-ZGq_eventTime",
			"followBanner": "Za-ZGq_followBanner",
			"formActions": "Za-ZGq_formActions",
			"header": "Za-ZGq_header",
			"headerActions": "Za-ZGq_headerActions",
			"headerMain": "Za-ZGq_headerMain",
			"iconButton": "Za-ZGq_iconButton",
			"itemActions": "Za-ZGq_itemActions",
			"itemCard": "Za-ZGq_itemCard",
			"itemInstruction": "Za-ZGq_itemInstruction",
			"itemList": "Za-ZGq_itemList",
			"itemMain": "Za-ZGq_itemMain",
			"itemMeta": "Za-ZGq_itemMeta",
			"itemTopline": "Za-ZGq_itemTopline",
			"overview": "Za-ZGq_overview",
			"overviewFacts": "Za-ZGq_overviewFacts",
			"priorityBadge": "Za-ZGq_priorityBadge",
			"projectId": "Za-ZGq_projectId",
			"reviewDecide": "Za-ZGq_reviewDecide",
			"reviewDetail": "Za-ZGq_reviewDetail",
			"sectionBar": "Za-ZGq_sectionBar",
			"smallButton": "Za-ZGq_smallButton",
			"statCard": "Za-ZGq_statCard",
			"statGrid": "Za-ZGq_statGrid",
			"statusBadge": "Za-ZGq_statusBadge",
			"tab": "Za-ZGq_tab",
			"tabNotice": "Za-ZGq_tabNotice",
			"tabPanel": "Za-ZGq_tabPanel",
			"tabs": "Za-ZGq_tabs",
			"updateKindBadge": "Za-ZGq_updateKindBadge",
			"updateList": "Za-ZGq_updateList",
			"updateMain": "Za-ZGq_updateMain"
		};
		//#endregion
		//#region src/client/ProjectConsole.tsx
		const api$2 = createProjectControlApi();
		const PREFS_KEY = "@cyrus/dsh-project-control:console-preferences:v1";
		function loadConsolePreferences() {
			try {
				const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(PREFS_KEY);
				if (raw === null) return {
					pinnedProjectIds: [],
					followSession: true,
					consoleProjectId: void 0
				};
				const parsed = JSON.parse(raw);
				return {
					pinnedProjectIds: Array.isArray(parsed.pinnedProjectIds) ? parsed.pinnedProjectIds.filter((item) => typeof item === "string").slice(0, 50) : [],
					followSession: parsed.followSession !== false,
					consoleProjectId: typeof parsed.consoleProjectId === "string" && parsed.consoleProjectId.length > 0 && parsed.consoleProjectId.length <= 200 ? parsed.consoleProjectId : void 0
				};
			} catch {
				return {
					pinnedProjectIds: [],
					followSession: true,
					consoleProjectId: void 0
				};
			}
		}
		function saveConsolePreferences(preferences) {
			try {
				if (typeof localStorage === "undefined") return;
				localStorage.setItem(PREFS_KEY, JSON.stringify({
					pinnedProjectIds: [...preferences.pinnedProjectIds],
					followSession: preferences.followSession,
					consoleProjectId: preferences.consoleProjectId
				}));
			} catch {}
		}
		const TABS = [
			{
				id: "overview",
				label: "总览"
			},
			{
				id: "checklist",
				label: "清单"
			},
			{
				id: "reviews",
				label: "审阅"
			},
			{
				id: "runs",
				label: "运行"
			},
			{
				id: "activity",
				label: "动态"
			},
			{
				id: "documents",
				label: "文档"
			},
			{
				id: "sessions",
				label: "会话"
			}
		];
		function ProjectConsole({ project, workbench, currentSessionId, pinned, onTogglePin, onBack }) {
			const [tab, setTab] = (0, react.useState)("overview");
			const [data, setData] = (0, react.useState)({});
			const [error, setError] = (0, react.useState)();
			const [mutation, setMutation] = (0, react.useState)();
			const [reloadKey, setReloadKey] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setError(void 0);
				const loader = {
					overview: async () => {
						const [workItems, runs, updates, reviews, decisions] = await Promise.all([
							api$2.listWorkItems(project.projectId, controller.signal),
							api$2.listRuns(project.projectId, void 0, controller.signal),
							api$2.listProgressUpdates(project.projectId, controller.signal),
							api$2.listReviews(project.projectId, controller.signal),
							api$2.listDecisions(project.projectId, controller.signal)
						]);
						if (controller.signal.aborted) return;
						setData((current) => ({
							...current,
							workItems,
							runs,
							updates,
							reviews,
							decisions
						}));
					},
					checklist: async () => {
						const workItems = await api$2.listWorkItems(project.projectId, controller.signal);
						if (controller.signal.aborted) return;
						setData((current) => ({
							...current,
							workItems
						}));
					},
					reviews: async () => {
						const reviews = await api$2.listReviews(project.projectId, controller.signal);
						if (controller.signal.aborted) return;
						setData((current) => ({
							...current,
							reviews
						}));
					},
					runs: async () => {
						const [runs, updates, workItems] = await Promise.all([
							api$2.listRuns(project.projectId, void 0, controller.signal),
							api$2.listProgressUpdates(project.projectId, controller.signal),
							api$2.listWorkItems(project.projectId, controller.signal)
						]);
						if (controller.signal.aborted) return;
						setData((current) => ({
							...current,
							runs,
							updates,
							workItems
						}));
					},
					activity: async () => {
						const events = await api$2.listEvents(project.projectId, void 0, controller.signal);
						if (controller.signal.aborted) return;
						setData((current) => ({
							...current,
							events
						}));
					},
					sessions: async () => {
						const bindings = await api$2.listSessions(project.projectId, controller.signal);
						if (controller.signal.aborted) return;
						setData((current) => ({
							...current,
							bindings
						}));
					}
				}[tab];
				if (loader !== void 0) loader().catch((loadError) => {
					if (controller.signal.aborted) return;
					setError(errorMessage$1(loadError, "项目数据暂时无法读取。"));
				});
				return () => {
					controller.abort();
				};
			}, [
				project.projectId,
				tab,
				reloadKey
			]);
			const reload = (0, react.useCallback)(() => {
				setReloadKey((value) => value + 1);
			}, []);
			const mutate = async (label, operation) => {
				if (mutation !== void 0) return false;
				setMutation(label);
				try {
					await operation();
					setReloadKey((value) => value + 1);
					return true;
				} catch (operationError) {
					setError(errorMessage$1(operationError, label + "没有完成。"));
					return false;
				} finally {
					setMutation(void 0);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ProjectConsole_module_css_default.console,
				"aria-label": "项目控制台：" + project.name,
				"data-personal-project-console": true,
				"data-console-tab": tab,
				"data-project-console-project": project.projectId,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: ProjectConsole_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectConsole_module_css_default.headerMain,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: ProjectConsole_module_css_default.backButton,
								type: "button",
								onClick: onBack,
								children: "← 项目总览"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: project.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: ProjectConsole_module_css_default.projectId,
								title: project.projectId,
								children: [
									project.projectId,
									" · ",
									registrationLabel$1(project.registrationMode),
									" · ",
									project.lifecycle
								]
							})] })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectConsole_module_css_default.headerActions,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ProjectConsole_module_css_default.smallButton,
									type: "button",
									"data-browse-in-workbench": true,
									title: "在右侧工作台浏览该项目文件（切换为「跟随控制台」）",
									onClick: () => {
										workbench.setProjectWorkspace(project.projectId, "");
										workbench.reveal();
									},
									children: "在工作台浏览"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ProjectConsole_module_css_default.smallButton,
									type: "button",
									"data-pinned": pinned || void 0,
									"aria-pressed": pinned,
									onClick: onTogglePin,
									children: pinned ? "📌 已置顶" : "置顶项目"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ProjectConsole_module_css_default.iconButton,
									type: "button",
									"aria-label": "刷新项目控制台",
									title: "刷新",
									onClick: reload,
									children: "↻"
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("nav", {
						className: ProjectConsole_module_css_default.tabs,
						role: "tablist",
						"aria-label": "项目页面",
						children: TABS.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							className: ProjectConsole_module_css_default.tab,
							type: "button",
							role: "tab",
							"aria-selected": tab === item.id,
							"data-tab-id": item.id,
							onClick: () => {
								setTab(item.id);
							},
							children: [
								item.label,
								item.id === "checklist" && data.workItems !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CountBadge, { value: data.workItems.total }),
								item.id === "reviews" && data.reviews !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CountBadge, { value: data.reviews.total }),
								item.id === "runs" && data.runs !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CountBadge, { value: data.runs.total })
							]
						}, item.id))
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectConsole_module_css_default.errorBanner,
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: error }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ProjectConsole_module_css_default.smallButton,
							type: "button",
							onClick: () => {
								setError(void 0);
								reload();
							},
							children: "重试"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectConsole_module_css_default.tabPanel,
						role: "tabpanel",
						children: [
							tab === "overview" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewTab, {
								data,
								project,
								onReload: reload
							}),
							tab === "checklist" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChecklistTab, {
								data,
								project,
								mutation,
								onMutate: mutate
							}),
							tab === "reviews" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReviewsTab, {
								data,
								project,
								mutation,
								onMutate: mutate
							}),
							tab === "runs" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunsTab, {
								data,
								project,
								workbench,
								mutation,
								onMutate: mutate
							}),
							tab === "activity" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActivityTab, {
								data,
								project
							}),
							tab === "documents" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DocumentsTab, { project }),
							tab === "sessions" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionsTab, {
								data,
								currentSessionId,
								followSession: loadConsolePreferences().followSession
							})
						]
					})
				]
			});
		}
		function CountBadge({ value }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ProjectConsole_module_css_default.countBadge,
				children: value > 99 ? "99+" : String(value)
			});
		}
		function OverviewTab({ data, project, onReload }) {
			const workItems = data.workItems;
			if (workItems === void 0 || data.runs === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "loading",
				copy: "正在汇总项目概览…"
			});
			const running = workItems.items.filter((item) => item.executionStatus === "running").length;
			const blocked = workItems.items.filter((item) => item.executionStatus === "blocked").length;
			const pendingReviews = workItems.items.filter((item) => item.reviewStatus === "pending").length;
			const openRuns = data.runs.items.filter((run) => run.status === "running").length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectConsole_module_css_default.overview,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ProjectConsole_module_css_default.statGrid,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
							label: "任务",
							value: workItems.total,
							detail: String(running) + " 执行中 · " + String(blocked) + " 阻塞"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
							label: "运行",
							value: data.runs.total,
							detail: String(openRuns) + " 运行中"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
							label: "待审",
							value: pendingReviews,
							detail: pendingReviews === 0 ? "没有待处理审阅" : "需要你决定"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
							label: "更新",
							value: data.updates?.total ?? 0,
							detail: "来自 Agent 的标准日志"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
							label: "决定",
							value: data.decisions?.total ?? 0,
							detail: "项目决策记录"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ProjectConsole_module_css_default.overviewFacts,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "登记信息" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "关联模式" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: registrationLabel$1(project.registrationMode) })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "生命周期" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: project.lifecycle })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "最后更新" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: project.updatedAt })] })
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ProjectConsole_module_css_default.smallButton,
							type: "button",
							onClick: onReload,
							children: "刷新概览"
						})
					]
				})]
			});
		}
		function StatCard({ label, value, detail }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectConsole_module_css_default.statCard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: String(value) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: detail })
				]
			});
		}
		function ChecklistTab({ data, project, mutation, onMutate }) {
			const workItems = data.workItems;
			const [formOpen, setFormOpen] = (0, react.useState)(false);
			const [title, setTitle] = (0, react.useState)("");
			const [instruction, setInstruction] = (0, react.useState)("");
			const [priority, setPriority] = (0, react.useState)("50");
			const [acceptance, setAcceptance] = (0, react.useState)("");
			if (workItems === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "loading",
				copy: "正在读取任务清单…"
			});
			const submitCreate = async () => {
				const trimmed = title.trim();
				if (trimmed.length === 0) return;
				const acceptanceLines = acceptance.split(/\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
				if (await onMutate("新建任务", () => api$2.createWorkItem(project.projectId, {
					title: trimmed,
					...instruction.trim() === "" ? {} : { instruction: instruction.trim() },
					...acceptanceLines.length === 0 ? {} : { acceptance: acceptanceLines },
					priority: Number(priority) || 50
				}))) {
					setFormOpen(false);
					setTitle("");
					setInstruction("");
					setAcceptance("");
					setPriority("50");
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectConsole_module_css_default.checklist,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectConsole_module_css_default.sectionBar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "任务清单" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ProjectConsole_module_css_default.smallButton,
							type: "button",
							onClick: () => {
								setFormOpen((value) => !value);
							},
							children: formOpen ? "收起表单" : "＋ 新建任务"
						})]
					}),
					formOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectConsole_module_css_default.createItemForm,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "标题" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								maxLength: 500,
								value: title,
								onChange: (event) => {
									setTitle(event.target.value);
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "说明" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								maxLength: 2e4,
								rows: 2,
								value: instruction,
								onChange: (event) => {
									setInstruction(event.target.value);
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "验收标准（每行一条）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								rows: 2,
								value: acceptance,
								onChange: (event) => {
									setAcceptance(event.target.value);
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "优先级（0–100）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: 0,
								max: 100,
								value: priority,
								onChange: (event) => {
									setPriority(event.target.value);
								}
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ProjectConsole_module_css_default.formActions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ProjectConsole_module_css_default.confirmButton,
									type: "button",
									disabled: mutation !== void 0 || title.trim() === "",
									onClick: () => {
										submitCreate();
									},
									children: mutation === "新建任务" ? "正在创建…" : "创建"
								})
							})
						]
					}),
					workItems.items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
						kind: "empty",
						copy: "还没有任务。新建任务或等待 Agent 提交外部运行更新。"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: ProjectConsole_module_css_default.itemList,
						children: workItems.items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: ProjectConsole_module_css_default.itemCard,
							"data-execution": item.executionStatus,
							"data-review": item.reviewStatus,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ProjectConsole_module_css_default.itemMain,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ProjectConsole_module_css_default.itemTopline,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ProjectConsole_module_css_default.priorityBadge,
											children: "P" + String(item.priority)
										})]
									}),
									item.instruction !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: ProjectConsole_module_css_default.itemInstruction,
										children: item.instruction
									}),
									item.acceptance.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
										className: ProjectConsole_module_css_default.acceptanceList,
										children: item.acceptance.map((line, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: ["✓ ", line] }, String(index)))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ProjectConsole_module_css_default.itemMeta,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusBadge, {
												kind: "execution",
												value: item.executionStatus
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusBadge, {
												kind: "review",
												value: item.reviewStatus
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "修订 " + String(item.revision) })
										]
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ProjectConsole_module_css_default.itemActions,
								children: [workItemCommands(item).map((command) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ProjectConsole_module_css_default.smallButton,
									type: "button",
									disabled: mutation !== void 0,
									onClick: () => {
										onMutate(command.label, () => api$2.setWorkItemStatus(project.projectId, item.workItemId, command.status, item.revision));
									},
									children: command.label
								}, command.status)), (item.reviewStatus === "not_requested" || item.reviewStatus === "changes_requested" || item.reviewStatus === "rejected") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ProjectConsole_module_css_default.confirmButton,
									type: "button",
									disabled: mutation !== void 0,
									onClick: () => {
										onMutate("请求审阅", () => api$2.requestReview(project.projectId, item.workItemId, item.revision));
									},
									children: "请求审阅"
								})]
							})]
						}, item.workItemId))
					})
				]
			});
		}
		function workItemCommands(item) {
			switch (item.executionStatus) {
				case "draft": return [{
					status: "ready",
					label: "备好"
				}, {
					status: "cancelled",
					label: "取消"
				}];
				case "ready": return [{
					status: "running",
					label: "开始执行"
				}, {
					status: "cancelled",
					label: "取消"
				}];
				case "running": return [{
					status: "paused",
					label: "暂停"
				}, {
					status: "cancelled",
					label: "取消"
				}];
				case "paused": return [
					{
						status: "ready",
						label: "恢复待命"
					},
					{
						status: "running",
						label: "继续执行"
					},
					{
						status: "cancelled",
						label: "取消"
					}
				];
				case "blocked": return [{
					status: "ready",
					label: "解除阻塞"
				}];
				default: return [];
			}
		}
		function ReviewsTab({ data, project, mutation, onMutate }) {
			const reviews = data.reviews;
			const [openReviewId, setOpenReviewId] = (0, react.useState)();
			const [comment, setComment] = (0, react.useState)("");
			const [rationale, setRationale] = (0, react.useState)("");
			const [actions, setActions] = (0, react.useState)({});
			(0, react.useEffect)(() => {
				if (openReviewId === void 0 || reviews === void 0) return;
				const controller = new AbortController();
				api$2.listReviewActions(project.projectId, openReviewId, controller.signal).then((result) => {
					if (!controller.signal.aborted) setActions((current) => ({
						...current,
						[openReviewId]: result
					}));
				}).catch(() => {});
				return () => {
					controller.abort();
				};
			}, [
				project.projectId,
				openReviewId,
				reviews
			]);
			if (reviews === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "loading",
				copy: "正在读取审阅记录…"
			});
			if (reviews.items.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "empty",
				copy: "还没有审阅。在清单页对任务发起“请求审阅”，通过、驳回和评论都会出现在这里。"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: ProjectConsole_module_css_default.itemList,
				children: reviews.items.map((review) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					className: ProjectConsole_module_css_default.itemCard,
					"data-review-status": review.status,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						className: ProjectConsole_module_css_default.itemMain,
						type: "button",
						onClick: () => {
							setOpenReviewId((current) => current === review.reviewId ? void 0 : review.reviewId);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ProjectConsole_module_css_default.itemTopline,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: workItemTitle(data, review.workItemId) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusBadge, {
								kind: "review-status",
								value: review.status
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ProjectConsole_module_css_default.itemMeta,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "风险：" + review.risk }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "被审修订：" + (review.reviewedWorkItemRevision ?? "—") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "审阅修订 " + String(review.revision) })
							]
						})]
					}), openReviewId === review.reviewId && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectConsole_module_css_default.reviewDetail,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
							className: ProjectConsole_module_css_default.actionList,
							children: [(actions[review.reviewId]?.items ?? []).map((action) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								"data-action": action.action,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: reviewActionLabel(action.action) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: action.comment ?? "" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: action.createdAt })
								]
							}, action.reviewActionId)), (actions[review.reviewId]?.items.length ?? 0) === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
								className: ProjectConsole_module_css_default.emptyCopy,
								children: "暂无审阅记录。"
							})]
						}), review.status === "requested" || review.status === "in_review" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectConsole_module_css_default.reviewDecide,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								rows: 2,
								placeholder: "决定理由（可选）",
								value: rationale,
								onChange: (event) => {
									setRationale(event.target.value);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ProjectConsole_module_css_default.formActions,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: ProjectConsole_module_css_default.confirmButton,
										type: "button",
										disabled: mutation !== void 0,
										onClick: () => {
											onMutate("通过审阅", () => api$2.decideReview(project.projectId, review.reviewId, {
												expectedRevision: review.revision,
												decision: "approve",
												...rationale.trim() === "" ? {} : { rationale: rationale.trim() }
											})).then((ok) => {
												if (ok) setRationale("");
											});
										},
										children: "通过"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: ProjectConsole_module_css_default.smallButton,
										type: "button",
										disabled: mutation !== void 0,
										onClick: () => {
											onMutate("要求修改", () => api$2.decideReview(project.projectId, review.reviewId, {
												expectedRevision: review.revision,
												decision: "request_changes",
												...rationale.trim() === "" ? {} : { rationale: rationale.trim() }
											})).then((ok) => {
												if (ok) setRationale("");
											});
										},
										children: "要求修改"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: ProjectConsole_module_css_default.smallButton,
										type: "button",
										disabled: mutation !== void 0,
										onClick: () => {
											onMutate("驳回审阅", () => api$2.decideReview(project.projectId, review.reviewId, {
												expectedRevision: review.revision,
												decision: "reject",
												...rationale.trim() === "" ? {} : { rationale: rationale.trim() }
											})).then((ok) => {
												if (ok) setRationale("");
											});
										},
										children: "驳回"
									})
								]
							})]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectConsole_module_css_default.reviewDecide,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								rows: 2,
								placeholder: "追加评论",
								value: comment,
								onChange: (event) => {
									setComment(event.target.value);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ProjectConsole_module_css_default.formActions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ProjectConsole_module_css_default.smallButton,
									type: "button",
									disabled: mutation !== void 0 || comment.trim() === "",
									onClick: () => {
										onMutate("评论审阅", () => api$2.commentReview(project.projectId, review.reviewId, comment.trim())).then((ok) => {
											if (ok) setComment("");
										});
									},
									children: "评论"
								})
							})]
						})]
					})]
				}, review.reviewId))
			});
		}
		function workItemTitle(data, workItemId) {
			if (workItemId === null) return "（无关联任务）";
			return data.workItems?.items.find((item) => item.workItemId === workItemId)?.title ?? workItemId;
		}
		function reviewActionLabel(action) {
			switch (action) {
				case "comment": return "评论";
				case "request_changes": return "要求修改";
				case "approve": return "通过";
				case "reject": return "驳回";
				case "supersede": return "已替代";
				default: return action;
			}
		}
		function RunsTab({ data, project, workbench, mutation, onMutate }) {
			const runs = data.runs;
			if (runs === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "loading",
				copy: "正在读取运行记录…"
			});
			if (runs.items.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "empty",
				copy: "还没有运行。外部 Agent 管线绑定线程后会在这里出现运行与进展更新。"
			});
			const updates = data.updates?.items ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ProjectConsole_module_css_default.runs,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: ProjectConsole_module_css_default.itemList,
					children: runs.items.map((run) => {
						const runUpdates = updates.filter((update) => update.runId === run.runId);
						const workItem = data.workItems?.items.find((item) => item.workItemId === run.workItemId);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: ProjectConsole_module_css_default.itemCard,
							"data-run-status": run.status,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ProjectConsole_module_css_default.itemMain,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ProjectConsole_module_css_default.itemTopline,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: (workItem?.title ?? run.workItemId) + " · 第 " + String(run.attemptNo) + " 次" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusBadge, {
											kind: "run",
											value: run.status
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ProjectConsole_module_css_default.itemMeta,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												title: run.runId,
												children: run.runId
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "修订 " + String(run.revision) }),
											run.startedAt !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "开始于 " + run.startedAt }),
											run.completedAt !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "完成于 " + run.completedAt })
										]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ProjectConsole_module_css_default.itemActions,
									children: run.status === "queued" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: ProjectConsole_module_css_default.confirmButton,
										type: "button",
										disabled: mutation !== void 0,
										onClick: () => {
											onMutate("启动运行", () => api$2.startRun(project.projectId, run.runId, run.revision));
										},
										children: "启动"
									})
								}),
								runUpdates.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									className: ProjectConsole_module_css_default.updateList,
									children: runUpdates.map((update) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
										"data-kind": update.kind,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											className: ProjectConsole_module_css_default.updateMain,
											type: "button",
											onClick: () => {
												openUpdate(workbench, project.projectId, update);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: ProjectConsole_module_css_default.itemTopline,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: update.summary }), update.completionPercent !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: String(update.completionPercent) + "%" })]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: ProjectConsole_module_css_default.itemMeta,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UpdateKindBadge, { kind: update.kind }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: update.createdAt })]
											})]
										})
									}, update.progressUpdateId))
								})
							]
						}, run.runId);
					})
				})
			});
		}
		function openUpdate(workbench, projectId, update) {
			workbench.open({
				family: "artifact",
				viewerId: "project-control.progress-update",
				resourceKey: projectId + ":upd:" + update.progressUpdateId,
				title: update.summary.slice(0, 40)
			});
		}
		function UpdateKindBadge({ kind }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ProjectConsole_module_css_default.updateKindBadge,
				"data-kind": kind,
				children: progressKindLabel(kind)
			});
		}
		function progressKindLabel(kind) {
			switch (kind) {
				case "progress": return "进展";
				case "blocker": return "阻塞";
				case "completion_declared": return "完成声明";
			}
		}
		function ActivityTab({ data, project }) {
			const events = data.events;
			const [tail, setTail] = (0, react.useState)([]);
			if (events === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "loading",
				copy: "正在读取项目动态…"
			});
			const items = [...events.items, ...tail];
			const lastSequence = items.length === 0 ? void 0 : items[items.length - 1]?.sequence;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectConsole_module_css_default.activity,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ProjectConsole_module_css_default.emptyCopy,
						children: "项目领域事件流（注册、任务、运行、审阅与外部更新），共 " + String(events.total) + " 条。"
					}),
					items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
						kind: "empty",
						copy: "还没有事件。"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: ProjectConsole_module_css_default.eventList,
						children: items.map((event) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							"data-aggregate": event.aggregateType,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProjectConsole_module_css_default.eventDot,
									"aria-hidden": "true"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ProjectConsole_module_css_default.eventMain,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: event.eventType }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ProjectConsole_module_css_default.eventAggregate,
											children: event.aggregateType + " " + event.aggregateId.slice(0, 18) + "… · rev " + String(event.beforeRevision) + "→" + String(event.afterRevision)
										}),
										Object.keys(event.data).length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
											className: ProjectConsole_module_css_default.eventData,
											children: JSON.stringify(event.data).slice(0, 240)
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProjectConsole_module_css_default.eventTime,
									children: event.recordedAt
								})
							]
						}, event.eventId))
					}),
					lastSequence !== void 0 && items.length < events.total && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: ProjectConsole_module_css_default.smallButton,
						type: "button",
						onClick: () => {
							api$2.listEvents(project.projectId, lastSequence).then((page) => {
								setTail((current) => [...current, ...page.items]);
							}).catch(() => {});
						},
						children: "加载更多"
					})
				]
			});
		}
		function DocumentsTab({ project }) {
			const [state, setState] = (0, react.useState)("loading");
			const [index, setIndex] = (0, react.useState)();
			const [message, setMessage] = (0, react.useState)();
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setState("loading");
				setMessage(void 0);
				api$2.getProjectDocuments(project.projectId, controller.signal).then((result) => {
					if (!controller.signal.aborted) {
						setIndex(result);
						setState("ready");
					}
				}).catch((loadError) => {
					if (controller.signal.aborted) return;
					setState("error");
					setMessage(errorMessage$1(loadError, "文档索引暂时无法读取。"));
				});
				return () => {
					controller.abort();
				};
			}, [project.projectId]);
			if (state === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "loading",
				copy: "正在核对项目文档…"
			});
			if (state === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "error",
				copy: message ?? "文档索引暂时无法读取。"
			});
			if (index === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "empty",
				copy: "没有文档索引。"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectConsole_module_css_default.documents,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: ProjectConsole_module_css_default.emptyCopy,
					children: ["来源：" + (index.mode === "managed" ? "manifest 绑定（受管理）" : "已确认绑定（只关联）"), index.locationDisplayPath !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						title: index.locationDisplayPath,
						children: " · " + index.locationDisplayPath
					})]
				}), index.documents.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
					kind: "empty",
					copy: "该项目没有文档绑定。"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: ProjectConsole_module_css_default.itemList,
					children: index.documents.map((document) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
						className: ProjectConsole_module_css_default.itemCard,
						"data-document-state": document.state,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectConsole_module_css_default.itemMain,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ProjectConsole_module_css_default.itemTopline,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: documentRoleLabel(document.role) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProjectConsole_module_css_default.documentPath,
									title: document.relativePath,
									children: document.relativePath
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ProjectConsole_module_css_default.itemMeta,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: documentStateLabel$1(document.state) }), document.contentHash !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									title: document.contentHash,
									children: document.contentHash.slice(0, 18)
								})]
							})]
						})
					}, document.role + "\0" + document.relativePath))
				})]
			});
		}
		function SessionsTab({ data, currentSessionId, followSession }) {
			const bindings = data.bindings;
			if (bindings === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "loading",
				copy: "正在读取会话绑定…"
			});
			if (bindings.items.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabNotice, {
				kind: "empty",
				copy: "还没有会话绑定。Agent 管线绑定 run→thread 后会出现这里。"
			});
			const current = bindings.items.filter((binding) => binding.sessionId === currentSessionId);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectConsole_module_css_default.sessions,
				children: [followSession && currentSessionId !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: ProjectConsole_module_css_default.followBanner,
					role: "status",
					children: current.length === 0 ? "跟随当前会话：该项目还没有绑定当前会话。" : "跟随当前会话：" + String(current.length) + " 个绑定与当前会话一致。"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: ProjectConsole_module_css_default.itemList,
					children: bindings.items.map((binding) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
						className: ProjectConsole_module_css_default.itemCard,
						"data-current-session": binding.sessionId === currentSessionId || void 0,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectConsole_module_css_default.itemMain,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ProjectConsole_module_css_default.itemTopline,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "线程 " + binding.threadId }), binding.sessionId === currentSessionId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ProjectConsole_module_css_default.currentBadge,
									children: "当前会话"
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ProjectConsole_module_css_default.itemMeta,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										title: binding.runId,
										children: "run " + binding.runId.slice(0, 18) + "…"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "session " + binding.sessionId }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: binding.harnessInstanceRef })
								]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProjectConsole_module_css_default.eventTime,
							children: binding.createdAt
						})]
					}, binding.bindingId))
				})]
			});
		}
		function StatusBadge({ kind, value }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ProjectConsole_module_css_default.statusBadge,
				"data-kind": kind,
				"data-value": value,
				children: statusLabel$1(value)
			});
		}
		function statusLabel$1(value) {
			switch (value) {
				case "draft": return "草稿";
				case "ready": return "待命";
				case "running": return "执行中";
				case "paused": return "已暂停";
				case "blocked": return "阻塞";
				case "completed": return "已完成";
				case "cancelled": return "已取消";
				case "not_requested": return "未请求审阅";
				case "pending": return "待审";
				case "changes_requested": return "要求修改";
				case "approved": return "已通过";
				case "rejected": return "已驳回";
				case "requested": return "审阅中";
				case "in_review": return "复核中";
				case "superseded": return "已替代";
				case "queued": return "排队";
				case "failed": return "失败";
				case "orphaned": return "失联";
				default: return value;
			}
		}
		function documentStateLabel$1(state) {
			switch (state) {
				case "ok": return "一致";
				case "changed": return "内容已变化";
				case "missing": return "缺失";
				case "unreadable": return "无法读取";
				default: return state;
			}
		}
		function TabNotice({ kind, copy }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ProjectConsole_module_css_default.tabNotice,
				role: kind === "error" ? "alert" : "status",
				"data-kind": kind,
				children: copy
			});
		}
		function registrationLabel$1(mode) {
			if (mode === "managed") return "受管理";
			if (mode === "linked_legacy") return "只关联";
			return "状态未知";
		}
		function errorMessage$1(error, fallback) {
			return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
		}
		//#endregion
		//#region \0dsh-project-control-css:src/client/ProjectControlPlaceholder.module.css.mjs
		const css = ".-Md2Ra_console{box-sizing:border-box;width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:radial-gradient(circle at 100% 0, color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, transparent), transparent 36%);flex-direction:column;display:flex;overflow:hidden}.-Md2Ra_consoleHeader{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;justify-content:space-between;align-items:center;gap:10px;padding:14px 14px 12px;display:flex}.-Md2Ra_consoleHeader>div{min-width:0}.-Md2Ra_consoleHeader h1{margin:6px 0 0;font-size:17px;line-height:24px}.-Md2Ra_consoleHeader p{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;margin:2px 0 0;font-size:12px;overflow:hidden}.-Md2Ra_gateBadge{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 24%, transparent);color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent);letter-spacing:.04em;border-radius:999px;padding:2px 7px;font-size:12px;font-weight:650;display:inline-block}.-Md2Ra_iconButton{border:1px solid var(--dsw-alias-border-l2);width:30px;height:30px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);font:inherit;cursor:pointer;border-radius:8px;flex:none;place-items:center;padding:0;display:grid}.-Md2Ra_content{flex:1;min-width:0;min-height:0;padding:12px 14px 16px;overflow:auto}.-Md2Ra_readyState{gap:13px;min-width:0;display:grid}.-Md2Ra_statusCard{border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 72%, transparent);border-radius:11px;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:9px;padding:10px;display:grid}.-Md2Ra_statusIcon{width:32px;height:32px;color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);border-radius:9px;place-items:center;display:grid}.-Md2Ra_statusIcon svg,.-Md2Ra_emptyIcon svg{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.5px;width:19px;height:19px}.-Md2Ra_statusCard h2{margin:0;font-size:14px;line-height:24px}.-Md2Ra_statusCard p{color:var(--dsw-alias-label-tertiary);margin:2px 0 0;font-size:12px;line-height:17px}.-Md2Ra_countBadge{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap;border-radius:999px;padding:3px 7px;font-size:12px}.-Md2Ra_intakeSection,.-Md2Ra_candidateCenter,.-Md2Ra_candidateSection,.-Md2Ra_projectSection{min-width:0}.-Md2Ra_candidateTabs{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;display:grid}.-Md2Ra_candidateTab{border:1px solid var(--dsw-alias-border-l2);min-width:0;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 62%, transparent);font:inherit;cursor:pointer;border-radius:8px;justify-content:space-between;align-items:center;gap:6px;padding:7px 9px;display:flex}.-Md2Ra_candidateTab[aria-selected=true]{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 55%, var(--dsw-alias-border-l2));color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, var(--dsw-alias-bg-layer-2))}.-Md2Ra_candidateTab span{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.-Md2Ra_candidateTab strong{background:var(--dsw-alias-interactive-bg-hover);text-align:center;border-radius:999px;flex:none;min-width:24px;padding:1px 6px;font-size:12px}.-Md2Ra_candidateSearch{gap:6px;margin-top:7px;display:flex}.-Md2Ra_candidateSearch input{border:1px solid var(--dsw-alias-border-l2);min-width:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font:inherit;border-radius:7px;flex:1;padding:6px 8px}.-Md2Ra_candidateBatchBar,.-Md2Ra_candidatePagination{color:var(--dsw-alias-label-tertiary);align-items:center;gap:8px;margin-bottom:7px;font-size:12px;display:flex}.-Md2Ra_candidateBatchBar label{align-items:center;gap:5px;display:flex}.-Md2Ra_candidateBatchBar button{margin-left:auto}.-Md2Ra_candidatePagination{justify-content:flex-end;margin-top:7px;margin-bottom:0}.-Md2Ra_sectionHeading{justify-content:space-between;align-items:flex-end;gap:8px;margin-bottom:7px;display:flex}.-Md2Ra_sectionHeading h2{color:var(--dsw-alias-label-secondary);margin:0;font-size:14px;font-weight:650}.-Md2Ra_sectionHeading p{color:var(--dsw-alias-label-tertiary);margin:2px 0 0;font-size:12px;line-height:17px}.-Md2Ra_sectionHeading>span{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px}.-Md2Ra_actionGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;display:grid}.-Md2Ra_primaryAction{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, var(--dsw-alias-border-l2));min-width:0;min-height:52px;color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 5%, var(--dsw-alias-bg-layer-2));font:inherit;text-align:left;cursor:pointer;border-radius:10px;grid-template-columns:25px minmax(0,1fr);align-items:center;gap:7px;padding:8px;display:grid}.-Md2Ra_primaryAction>span:first-child{width:24px;height:24px;color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);border-radius:7px;place-items:center;font-size:17px;display:grid}.-Md2Ra_primaryAction strong,.-Md2Ra_primaryAction small{text-overflow:ellipsis;display:block;overflow:hidden}.-Md2Ra_primaryAction strong{white-space:nowrap;font-size:13px}.-Md2Ra_primaryAction small{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:14px;line-height:15px}.-Md2Ra_primaryAction:hover:not(:disabled),.-Md2Ra_candidateCard:hover{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent)}.-Md2Ra_primaryAction:disabled,.-Md2Ra_ignoreButton:disabled{opacity:.45;cursor:default}.-Md2Ra_bridgeNotice,.-Md2Ra_scanNotice,.-Md2Ra_scanError,.-Md2Ra_emptyCopy{color:var(--dsw-alias-label-tertiary);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 62%, transparent);border-radius:8px;margin:7px 0 0;padding:8px 9px;font-size:12px;line-height:17px}.-Md2Ra_bridgeNotice,.-Md2Ra_scanError{border:1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary,#b07a2e) 28%, transparent)}.-Md2Ra_scanNotice,.-Md2Ra_scanError{gap:2px;display:grid}.-Md2Ra_scanNotice strong,.-Md2Ra_scanError strong{color:var(--dsw-alias-label-secondary);font-size:12px}.-Md2Ra_scanNotice span,.-Md2Ra_scanError span{text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Cascadia Mono,Consolas,monospace;overflow:hidden}.-Md2Ra_candidateList,.-Md2Ra_projectList{gap:6px;margin:0;padding:0;list-style:none;display:grid}.-Md2Ra_candidateCard{border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 62%, transparent);border-radius:10px;grid-template-columns:minmax(0,1fr) auto;min-width:0;transition:border-color .12s;display:grid}.-Md2Ra_candidateCard[data-selectable=true]{grid-template-columns:auto minmax(0,1fr) auto}.-Md2Ra_candidateSelect{place-items:center;padding-left:9px;display:grid}.-Md2Ra_candidateCard[data-ignored=true]{opacity:.68}.-Md2Ra_candidateMain{min-width:0;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;gap:4px;padding:9px;display:grid}.-Md2Ra_candidateTopline,.-Md2Ra_candidateMeta{align-items:center;gap:5px;min-width:0;display:flex}.-Md2Ra_candidateTopline{justify-content:space-between}.-Md2Ra_candidateTopline strong{text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;overflow:hidden}.-Md2Ra_candidateTopline>span,.-Md2Ra_candidateMeta>span{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;flex:none;padding:2px 6px;font-size:14px}.-Md2Ra_candidateTopline>span[data-level=high]{color:var(--dsw-alias-state-success-primary,#4e9962)}.-Md2Ra_candidateTopline>span[data-level=low],.-Md2Ra_candidateTopline>span[data-level=unknown]{color:var(--dsw-alias-state-warning-primary,#b07a2e)}.-Md2Ra_candidatePath{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Cascadia Mono,Consolas,monospace;font-size:14px;overflow:hidden}.-Md2Ra_candidateMeta{flex-wrap:wrap}.-Md2Ra_ignoreButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);font:inherit;cursor:pointer;border-radius:7px;align-self:center;margin-right:8px;padding:4px 7px;font-size:14px}.-Md2Ra_projectItem{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 62%, transparent);border-radius:9px;justify-content:space-between;align-items:center;gap:8px;min-width:0;padding:8px 9px;display:flex}.-Md2Ra_projectItem div{min-width:0}.-Md2Ra_projectItem strong,.-Md2Ra_projectItem small{text-overflow:ellipsis;white-space:nowrap;display:block;overflow:hidden}.-Md2Ra_projectItem strong{font-size:13px;font-weight:550}.-Md2Ra_projectItem small,.-Md2Ra_projectItem>span{color:var(--dsw-alias-label-tertiary);font-size:14px}.-Md2Ra_projectItem>span{flex:none}.-Md2Ra_createSection{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 48%, transparent);border-radius:11px;min-width:0;padding:9px}.-Md2Ra_createForm{gap:7px;min-width:0;display:grid}.-Md2Ra_createField{gap:3px;min-width:0;display:grid}.-Md2Ra_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}.-Md2Ra_parentRow{grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px;min-width:0;display:grid}.-Md2Ra_pathText{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);text-overflow:ellipsis;white-space:nowrap;border-radius:8px;padding:6px 8px;font-family:ui-monospace,Cascadia Mono,Consolas,monospace;font-size:14px;overflow:hidden}.-Md2Ra_textInput,.-Md2Ra_selectInput{border:1px solid var(--dsw-alias-border-l2);min-width:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);font:inherit;border-radius:8px;padding:6px 8px;font-size:13px}.-Md2Ra_textInput:disabled,.-Md2Ra_selectInput:disabled{opacity:.55}.-Md2Ra_templateDescription{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:24px}.-Md2Ra_createActions{flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-top:3px;display:flex}.-Md2Ra_confirmButton{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, transparent);color:#fff;background:var(--dsw-alias-state-business-primary);font:inherit;cursor:pointer;border-radius:8px;padding:6px 12px;font-size:13px}.-Md2Ra_confirmButton:disabled{opacity:.5;cursor:default}.-Md2Ra_smallButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);font:inherit;cursor:pointer;border-radius:7px;flex:none;padding:5px 8px;font-size:14px}.-Md2Ra_previewCard{border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 58%, transparent);border-radius:9px;gap:6px;min-width:0;padding:8px;display:grid}.-Md2Ra_previewTopline{justify-content:space-between;align-items:center;gap:6px;min-width:0;display:flex}.-Md2Ra_previewTopline strong{font-size:13px}.-Md2Ra_previewTopline span{color:var(--dsw-alias-label-tertiary);flex:none;font-size:14px}.-Md2Ra_previewFacts{gap:3px;margin:0;display:grid}.-Md2Ra_previewFacts div{grid-template-columns:64px minmax(0,1fr);gap:6px;min-width:0;display:grid}.-Md2Ra_previewFacts dt{color:var(--dsw-alias-label-tertiary);font-size:14px}.-Md2Ra_previewFacts dd{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;margin:0;font-family:ui-monospace,Cascadia Mono,Consolas,monospace;font-size:14px;overflow:hidden}.-Md2Ra_previewNote{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:24px}.-Md2Ra_operationList{gap:2px;max-height:148px;margin:0;padding:0;list-style:none;display:grid;overflow:auto}.-Md2Ra_operationItem{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 46%, transparent);border-radius:6px;grid-template-columns:16px minmax(0,1fr) auto;align-items:center;gap:5px;min-width:0;padding:3px 6px;font-size:14px;display:grid}.-Md2Ra_operationPath{text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Cascadia Mono,Consolas,monospace;overflow:hidden}.-Md2Ra_hashText{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Cascadia Mono,Consolas,monospace}.-Md2Ra_createSuccess,.-Md2Ra_createError{border-radius:8px;gap:6px;margin-top:2px;padding:8px;font-size:12px;line-height:17px;display:grid}.-Md2Ra_createSuccess{border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary,#4e9962) 30%, transparent);color:var(--dsw-alias-state-success-primary,#4e9962);background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#4e9962) 8%, transparent)}.-Md2Ra_createError{border:1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary,#b07a2e) 28%, transparent);color:var(--dsw-alias-label-secondary);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 62%, transparent)}.-Md2Ra_statusFacts{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:0;display:grid}.-Md2Ra_statusFacts div{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 58%, transparent);border-radius:8px;min-width:0;padding:7px}.-Md2Ra_statusFacts dt{color:var(--dsw-alias-label-tertiary);font-size:14px}.-Md2Ra_statusFacts dd{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;margin:2px 0 0;font-size:12px;overflow:hidden}.-Md2Ra_statePanel{text-align:center;flex-direction:column;justify-content:center;align-items:center;min-height:260px;display:flex}.-Md2Ra_emptyIcon{border:1px solid var(--dsw-alias-border-l2);width:44px;height:44px;color:var(--dsw-alias-label-tertiary);border-radius:14px;place-items:center;margin-bottom:10px;display:grid}.-Md2Ra_statePanel h2{margin:0;font-size:13px}.-Md2Ra_statePanel p{max-width:260px;color:var(--dsw-alias-label-secondary);margin:6px 0 0;font-size:13px;line-height:24px}.-Md2Ra_secondaryButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);font:inherit;cursor:pointer;border-radius:8px;margin-top:11px;padding:6px 12px;font-size:13px}.-Md2Ra_projectItemActions{flex:none;align-items:center;gap:6px;display:flex}.-Md2Ra_documentPanel{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 48%, transparent);border-radius:11px;min-width:0;padding:9px}.-Md2Ra_documentPanelHeader{justify-content:space-between;align-items:flex-start;gap:8px;min-width:0;display:flex}.-Md2Ra_documentPanelHeader>div:first-child{min-width:0}.-Md2Ra_documentPanelHeader strong{font-size:13px}.-Md2Ra_documentPanelHeader p{color:var(--dsw-alias-label-tertiary);margin:2px 0 0;font-size:14px}.-Md2Ra_documentPanelActions{flex:none;gap:5px;display:flex}.-Md2Ra_documentPanelEmpty{color:var(--dsw-alias-label-tertiary);margin:7px 0 0;font-size:12px;line-height:17px}.-Md2Ra_documentLocation{font-family:ui-monospace,Cascadia Mono,Consolas,monospace;font-size:14px}.-Md2Ra_documentList{gap:3px;max-height:190px;margin:7px 0 0;padding:0;list-style:none;display:grid;overflow:auto}.-Md2Ra_documentRow{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 46%, transparent);border-radius:7px;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:2px 8px;min-width:0;padding:5px 7px;display:grid}.-Md2Ra_documentRowMain{grid-template-columns:auto minmax(0,1fr);align-items:center;gap:2px 7px;min-width:0;display:grid}.-Md2Ra_documentRole{color:var(--dsw-alias-label-secondary);flex:none;font-size:12px;font-weight:600}.-Md2Ra_documentPath,.-Md2Ra_proposalPath{text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Cascadia Mono,Consolas,monospace;font-size:14px;overflow:hidden}.-Md2Ra_documentRowSide{align-items:center;gap:5px;min-width:0;display:flex}.-Md2Ra_documentStateBadge{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap;border-radius:999px;padding:2px 6px;font-size:14px}.-Md2Ra_documentStateBadge[data-state=ok]{color:var(--dsw-alias-state-success-primary,#4e9962)}.-Md2Ra_documentStateBadge[data-state=changed],.-Md2Ra_documentStateBadge[data-state=missing]{color:var(--dsw-alias-state-warning-primary,#b07a2e)}.-Md2Ra_documentStateBadge[data-state=unreadable]{color:var(--dsw-alias-state-danger-primary,#c25555)}.-Md2Ra_documentHash{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Cascadia Mono,Consolas,monospace;font-size:14px}.-Md2Ra_documentIssues{grid-column:1/-1;gap:2px;display:grid}.-Md2Ra_documentIssue{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:17px}.-Md2Ra_proposalGroup{gap:5px;margin-top:8px;display:grid}.-Md2Ra_proposalGroupTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:650}.-Md2Ra_proposalCard{border:1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary,#b07a2e) 22%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 52%, transparent);border-radius:9px;gap:5px;min-width:0;padding:7px;display:grid}.-Md2Ra_proposalLine,.-Md2Ra_proposalActions{min-width:0;color:var(--dsw-alias-label-secondary);flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;display:flex}.-Md2Ra_proposalActions select{border:1px solid var(--dsw-alias-border-l2);min-width:0;max-width:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);font:inherit;border-radius:7px;padding:4px 6px;font-size:14px}.-Md2Ra_proposalHint{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:17px}.-Md2Ra_iconButton:focus-visible,.-Md2Ra_primaryAction:focus-visible,.-Md2Ra_candidateMain:focus-visible,.-Md2Ra_ignoreButton:focus-visible,.-Md2Ra_secondaryButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}@media (width<=1180px){.-Md2Ra_actionGrid,.-Md2Ra_statusFacts{grid-template-columns:1fr}.-Md2Ra_candidateTabs{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (prefers-reduced-motion:reduce){.-Md2Ra_candidateCard{transition:none}}";
		const tagId = "@cyrus/dsh-project-control/ProjectControlPlaceholder.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@cyrus/dsh-project-control";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ProjectControlPlaceholder_module_css_default = {
			"actionGrid": "-Md2Ra_actionGrid",
			"bridgeNotice": "-Md2Ra_bridgeNotice",
			"candidateBatchBar": "-Md2Ra_candidateBatchBar",
			"candidateCard": "-Md2Ra_candidateCard",
			"candidateCenter": "-Md2Ra_candidateCenter",
			"candidateList": "-Md2Ra_candidateList",
			"candidateMain": "-Md2Ra_candidateMain",
			"candidateMeta": "-Md2Ra_candidateMeta",
			"candidatePagination": "-Md2Ra_candidatePagination",
			"candidatePath": "-Md2Ra_candidatePath",
			"candidateSearch": "-Md2Ra_candidateSearch",
			"candidateSection": "-Md2Ra_candidateSection",
			"candidateSelect": "-Md2Ra_candidateSelect",
			"candidateTab": "-Md2Ra_candidateTab",
			"candidateTabs": "-Md2Ra_candidateTabs",
			"candidateTopline": "-Md2Ra_candidateTopline",
			"confirmButton": "-Md2Ra_confirmButton",
			"console": "-Md2Ra_console",
			"consoleHeader": "-Md2Ra_consoleHeader",
			"content": "-Md2Ra_content",
			"countBadge": "-Md2Ra_countBadge",
			"createActions": "-Md2Ra_createActions",
			"createError": "-Md2Ra_createError",
			"createField": "-Md2Ra_createField",
			"createForm": "-Md2Ra_createForm",
			"createSection": "-Md2Ra_createSection",
			"createSuccess": "-Md2Ra_createSuccess",
			"documentHash": "-Md2Ra_documentHash",
			"documentIssue": "-Md2Ra_documentIssue",
			"documentIssues": "-Md2Ra_documentIssues",
			"documentList": "-Md2Ra_documentList",
			"documentLocation": "-Md2Ra_documentLocation",
			"documentPanel": "-Md2Ra_documentPanel",
			"documentPanelActions": "-Md2Ra_documentPanelActions",
			"documentPanelEmpty": "-Md2Ra_documentPanelEmpty",
			"documentPanelHeader": "-Md2Ra_documentPanelHeader",
			"documentPath": "-Md2Ra_documentPath",
			"documentRole": "-Md2Ra_documentRole",
			"documentRow": "-Md2Ra_documentRow",
			"documentRowMain": "-Md2Ra_documentRowMain",
			"documentRowSide": "-Md2Ra_documentRowSide",
			"documentStateBadge": "-Md2Ra_documentStateBadge",
			"emptyCopy": "-Md2Ra_emptyCopy",
			"emptyIcon": "-Md2Ra_emptyIcon",
			"fieldLabel": "-Md2Ra_fieldLabel",
			"gateBadge": "-Md2Ra_gateBadge",
			"hashText": "-Md2Ra_hashText",
			"iconButton": "-Md2Ra_iconButton",
			"ignoreButton": "-Md2Ra_ignoreButton",
			"intakeSection": "-Md2Ra_intakeSection",
			"operationItem": "-Md2Ra_operationItem",
			"operationList": "-Md2Ra_operationList",
			"operationPath": "-Md2Ra_operationPath",
			"parentRow": "-Md2Ra_parentRow",
			"pathText": "-Md2Ra_pathText",
			"previewCard": "-Md2Ra_previewCard",
			"previewFacts": "-Md2Ra_previewFacts",
			"previewNote": "-Md2Ra_previewNote",
			"previewTopline": "-Md2Ra_previewTopline",
			"primaryAction": "-Md2Ra_primaryAction",
			"projectItem": "-Md2Ra_projectItem",
			"projectItemActions": "-Md2Ra_projectItemActions",
			"projectList": "-Md2Ra_projectList",
			"projectSection": "-Md2Ra_projectSection",
			"proposalActions": "-Md2Ra_proposalActions",
			"proposalCard": "-Md2Ra_proposalCard",
			"proposalGroup": "-Md2Ra_proposalGroup",
			"proposalGroupTitle": "-Md2Ra_proposalGroupTitle",
			"proposalHint": "-Md2Ra_proposalHint",
			"proposalLine": "-Md2Ra_proposalLine",
			"proposalPath": "-Md2Ra_proposalPath",
			"readyState": "-Md2Ra_readyState",
			"scanError": "-Md2Ra_scanError",
			"scanNotice": "-Md2Ra_scanNotice",
			"secondaryButton": "-Md2Ra_secondaryButton",
			"sectionHeading": "-Md2Ra_sectionHeading",
			"selectInput": "-Md2Ra_selectInput",
			"smallButton": "-Md2Ra_smallButton",
			"statePanel": "-Md2Ra_statePanel",
			"statusCard": "-Md2Ra_statusCard",
			"statusFacts": "-Md2Ra_statusFacts",
			"statusIcon": "-Md2Ra_statusIcon",
			"templateDescription": "-Md2Ra_templateDescription",
			"textInput": "-Md2Ra_textInput"
		};
		//#endregion
		//#region src/client/ProjectControlPlaceholder.tsx
		const api$1 = createProjectControlApi();
		const MEMORY_CONTEXT_ENDPOINT = "/__personal/memory/context";
		/**
		* 通知记忆插件「当前会话 ↔ 项目」绑定（P3-2 自动提取的项目归属桥）。
		* 失败静默：记忆插件可能未加载或未开启提取，绝不影响控制台主流程。
		*/
		function notifyMemoryProjectBinding(projectId, sessionId) {
			if (sessionId === void 0) return;
			fetch(MEMORY_CONTEXT_ENDPOINT, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-dsh-console": "1"
				},
				body: JSON.stringify({
					sessionId,
					projectId: projectId ?? null
				})
			}).catch(() => {});
		}
		function ProjectControlPlaceholder(props) {
			const { workbench } = props;
			const currentSessionId = props.useSessions((state) => {
				const current = state.current;
				return current !== void 0 && state.byId[current]?.blank === false ? String(current) : void 0;
			});
			const [reloadKey, setReloadKey] = (0, react.useState)(0);
			const [loadState, setLoadState] = (0, react.useState)({ kind: "loading" });
			const [scanState, setScanState] = (0, react.useState)({ kind: "idle" });
			const [createState, setCreateState] = (0, react.useState)({ kind: "idle" });
			const [candidateMutation, setCandidateMutation] = (0, react.useState)();
			const [candidateView, setCandidateView] = (0, react.useState)("projects");
			const [candidateSearchInput, setCandidateSearchInput] = (0, react.useState)("");
			const [candidateSearch, setCandidateSearch] = (0, react.useState)("");
			const [candidateCursor, setCandidateCursor] = (0, react.useState)();
			const [candidateCursorHistory, setCandidateCursorHistory] = (0, react.useState)([]);
			const [selectedCandidates, setSelectedCandidates] = (0, react.useState)({});
			const [documentPanel, setDocumentPanel] = (0, react.useState)({ kind: "idle" });
			const [documentMutation, setDocumentMutation] = (0, react.useState)();
			const [rebindChoices, setRebindChoices] = (0, react.useState)({});
			const [consoleProjectId, setConsoleProjectId] = (0, react.useState)(() => loadConsolePreferences().consoleProjectId);
			const [preferences, setPreferences] = (0, react.useState)(() => loadConsolePreferences());
			(0, react.useEffect)(() => {
				if (consoleProjectId === void 0) return;
				notifyMemoryProjectBinding(consoleProjectId, currentSessionId);
			}, [consoleProjectId, currentSessionId]);
			(0, react.useEffect)(() => subscribeProjectControlChanges(() => {
				setReloadKey((value) => value + 1);
			}), []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setLoadState({ kind: "loading" });
				api$1.getStatus(controller.signal).then(async (status) => {
					const [listResult, candidateResult] = await Promise.allSettled([api$1.listProjects(controller.signal), api$1.listCandidates({
						view: candidateView === "projects" ? "review" : candidateView,
						limit: 25,
						...candidateView === "projects" || candidateSearch === "" ? {} : { search: candidateSearch },
						...candidateCursor === void 0 ? {} : { afterCandidateId: candidateCursor }
					}, controller.signal)]);
					if (controller.signal.aborted) return;
					setLoadState({
						kind: "ready",
						status,
						...listResult.status === "fulfilled" ? { list: listResult.value } : { listError: errorMessage(listResult.reason, "项目列表暂时无法读取。") },
						candidatePage: candidateResult.status === "fulfilled" ? candidateResult.value : {
							candidates: [],
							total: 0,
							counts: {
								review: 0,
								ignored: 0,
								history: 0
							},
							nextCursor: null
						},
						...candidateResult.status === "fulfilled" ? {} : { candidateError: errorMessage(candidateResult.reason, "扫描候选暂时无法读取。") }
					});
				}, (error) => {
					if (controller.signal.aborted) return;
					setLoadState({
						kind: "error",
						message: errorMessage(error, "项目控制台状态读取失败。")
					});
				});
				return () => {
					controller.abort();
				};
			}, [
				candidateCursor,
				candidateSearch,
				candidateView,
				reloadKey
			]);
			const reload = (0, react.useCallback)(() => {
				setReloadKey((value) => value + 1);
			}, []);
			const beginScan = async (mode) => {
				if (scanState.kind === "selecting" || scanState.kind === "scanning") return;
				setScanState({
					kind: "selecting",
					mode
				});
				const outcome = await selectProjectDirectory(mode);
				if (outcome.kind === "cancelled") {
					setScanState({ kind: "idle" });
					return;
				}
				if (outcome.kind === "error") {
					setScanState({
						kind: "error",
						message: outcome.message
					});
					return;
				}
				setScanState({
					kind: "scanning",
					mode,
					path: outcome.selection.path
				});
				try {
					const result = await api$1.scan(mode, outcome.selection);
					setCandidateView("review");
					setCandidateCursor(void 0);
					setCandidateCursorHistory([]);
					setSelectedCandidates({});
					reload();
					setScanState({
						kind: "success",
						path: result.sourceRoot.path,
						message: (result.candidates.length === 0 ? "扫描完成，没有发现新的项目候选。" : `扫描完成，发现 ${String(result.candidates.length)} 个项目候选。`) + scanIssueMessage(result.issues)
					});
				} catch (error) {
					setScanState({
						kind: "error",
						message: errorMessage(error, "目录扫描没有完成。")
					});
				}
			};
			const toggleIgnored = async (candidate) => {
				if (candidateMutation !== void 0) return;
				setCandidateMutation(candidate.candidateId);
				try {
					if ((await api$1.setCandidateIgnored(candidate.candidateId, !candidate.ignored, candidate.revision)).candidateId === candidate.candidateId) reload();
				} catch (error) {
					setScanState({
						kind: "error",
						message: errorMessage(error, "候选状态没有更新。")
					});
				} finally {
					setCandidateMutation(void 0);
				}
			};
			const chooseCandidateView = (view) => {
				setCandidateView(view);
				setCandidateCursor(void 0);
				setCandidateCursorHistory([]);
				setSelectedCandidates({});
			};
			const applyCandidateSearch = () => {
				setCandidateSearch(candidateSearchInput.trim());
				setCandidateCursor(void 0);
				setCandidateCursorHistory([]);
				setSelectedCandidates({});
			};
			const selectCandidate = (candidate, selected) => {
				setSelectedCandidates((current) => {
					const next = { ...current };
					if (selected) next[candidate.candidateId] = candidate.revision;
					else delete next[candidate.candidateId];
					return next;
				});
			};
			const selectCandidatePage = (candidates, selected) => {
				setSelectedCandidates((current) => {
					const next = { ...current };
					for (const candidate of candidates) if (selected) next[candidate.candidateId] = candidate.revision;
					else delete next[candidate.candidateId];
					return next;
				});
			};
			const mutateSelectedCandidates = async () => {
				if (loadState.kind !== "ready" || !["review", "ignored"].includes(candidateView)) return;
				const selectedCandidatesOnPage = loadState.candidatePage.candidates.filter((candidate) => selectedCandidates[candidate.candidateId] === candidate.revision);
				const selected = selectedCandidatesOnPage.map((candidate) => ({
					candidateId: candidate.candidateId,
					expectedRevision: candidate.revision
				}));
				if (selected.length === 0 || candidateMutation !== void 0) return;
				const ignored = candidateView === "review";
				const action = ignored ? "忽略" : "恢复";
				const preview = selectedCandidatesOnPage.slice(0, 10).map((candidate) => `- ${statusLabel(candidate.status)}：${candidatePathPreview(candidate.rootPath)}`).join("\n");
				const remaining = selectedCandidatesOnPage.length > 10 ? `\n- 另有 ${String(selectedCandidatesOnPage.length - 10)} 项未展开` : "";
				if (!globalThis.confirm(`即将${action}当前页选中的 ${String(selected.length)} 个候选。\n\n${preview}${remaining}\n\n该操作保留历史且可恢复，是否继续？`)) return;
				setCandidateMutation("batch");
				try {
					await api$1.setCandidatesIgnored(selected, ignored);
					setSelectedCandidates({});
					reload();
				} catch (error) {
					setScanState({
						kind: "error",
						message: errorMessage(error, `批量${action}没有完成；本批次未部分生效。`)
					});
				} finally {
					setCandidateMutation(void 0);
				}
			};
			const nextCandidatePage = () => {
				if (loadState.kind !== "ready" || loadState.candidatePage.nextCursor === null) return;
				setCandidateCursorHistory((current) => [...current, candidateCursor]);
				setCandidateCursor(loadState.candidatePage.nextCursor);
				setSelectedCandidates({});
			};
			const previousCandidatePage = () => {
				if (candidateCursorHistory.length === 0) return;
				const previous = candidateCursorHistory[candidateCursorHistory.length - 1];
				setCandidateCursorHistory((current) => current.slice(0, -1));
				setCandidateCursor(previous);
				setSelectedCandidates({});
			};
			const openCandidate = (candidate) => {
				workbench.open({
					family: "details",
					viewerId: "project-control.candidate-details",
					resourceKey: candidate.candidateId,
					title: candidate.suggestedName
				});
			};
			const beginCreate = async () => {
				if (createState.kind === "picking") return;
				setCreateState({ kind: "picking" });
				const outcome = await selectProjectDirectory("create-parent");
				if (outcome.kind !== "selected") {
					setCreateState(outcome.kind === "error" ? {
						kind: "error",
						message: outcome.message
					} : { kind: "idle" });
					return;
				}
				let templates = [];
				let templatesError;
				try {
					templates = (await api$1.listTemplates()).templates;
				} catch (error) {
					templatesError = errorMessage(error, "模板列表暂时无法读取，请点击右上角刷新后重试。");
				}
				if (templates.length === 0 && templatesError === void 0) {
					setCreateState({
						kind: "error",
						message: "当前没有可用的项目模板。"
					});
					return;
				}
				setCreateState({
					kind: "form",
					form: {
						parent: outcome.selection,
						directoryName: "",
						name: "",
						templates,
						...templatesError === void 0 ? {} : { templatesError },
						templateId: templates[0]?.templateId ?? ""
					}
				});
			};
			const updateCreateForm = (patch) => {
				setCreateState((current) => current.kind === "form" ? {
					kind: "form",
					form: {
						...current.form,
						...patch
					}
				} : current);
			};
			const prepareCreate = async (form) => {
				const template = form.templates.find((item) => item.templateId === form.templateId);
				if (template === void 0) {
					setCreateState({
						kind: "error",
						message: "请先选择项目模板。",
						form
					});
					return;
				}
				setCreateState({
					kind: "preparing",
					form
				});
				try {
					setCreateState({
						kind: "preview",
						form,
						preview: await api$1.prepareCreate({
							selection: form.parent,
							directoryName: form.directoryName,
							name: form.name,
							templateId: template.templateId,
							templateVersion: template.templateVersion
						})
					});
				} catch (error) {
					setCreateState({
						kind: "error",
						message: errorMessage(error, "新建项目预检没有完成。"),
						form
					});
				}
			};
			const submitCreate = async (form, preview) => {
				setCreateState({
					kind: "submitting",
					form,
					preview
				});
				try {
					const result = await api$1.submitLifecycle(preview.command);
					if (result.status === "accepted" || result.status === "replayed") {
						setCreateState({
							kind: "success",
							message: "项目已创建并登记为受管理项目。",
							projectId: preview.projectId
						});
						setReloadKey((value) => value + 1);
					} else setCreateState({
						kind: "error",
						message: result.error?.message ?? "新建项目没有完成。",
						form,
						preview
					});
				} catch (error) {
					setCreateState({
						kind: "error",
						message: errorMessage(error, "新建项目没有完成。"),
						form,
						preview
					});
				}
			};
			const openDocuments = async (project) => {
				if (documentPanel.kind === "loading") return;
				if (documentPanel.kind === "ready" && documentPanel.index.projectId === project.projectId) {
					setDocumentPanel({ kind: "idle" });
					return;
				}
				setDocumentPanel({
					kind: "loading",
					projectId: project.projectId
				});
				try {
					setDocumentPanel({
						kind: "ready",
						index: await api$1.getProjectDocuments(project.projectId)
					});
				} catch (error) {
					setDocumentPanel({
						kind: "error",
						message: errorMessage(error, "文档索引暂时无法读取。")
					});
				}
			};
			const refreshDocuments = async () => {
				if (documentPanel.kind !== "ready" || documentMutation !== void 0) return;
				const projectId = documentPanel.index.projectId;
				setDocumentPanel({
					kind: "loading",
					projectId
				});
				try {
					setDocumentPanel({
						kind: "ready",
						index: await api$1.refreshProjectDocuments(projectId)
					});
				} catch (error) {
					setDocumentPanel({
						kind: "error",
						message: errorMessage(error, "文档索引刷新没有完成。")
					});
				}
			};
			const resolveRebind = async (proposal, decision) => {
				if (documentPanel.kind !== "ready" || documentMutation !== void 0) return;
				const index = documentPanel.index;
				const candidateRelativePath = proposal.unambiguous ? void 0 : rebindChoices[proposal.proposalId] ?? proposal.candidateRelativePaths[0];
				setDocumentMutation(proposal.proposalId);
				try {
					await api$1.resolveDocumentRebind(index.projectId, proposal.proposalId, {
						expectedRevision: proposal.revision,
						decision,
						...candidateRelativePath === void 0 ? {} : { candidateRelativePath }
					});
					setDocumentPanel({
						kind: "ready",
						index: await api$1.refreshProjectDocuments(index.projectId)
					});
					setReloadKey((value) => value + 1);
				} catch (error) {
					setDocumentPanel({
						kind: "ready",
						index,
						error: errorMessage(error, "重绑提案没有处理成功。")
					});
				} finally {
					setDocumentMutation(void 0);
				}
			};
			const storageState = loadState.kind === "ready" ? loadState.status.storage.state : void 0;
			const projectCount = loadState.kind === "ready" ? loadState.status.counts.projects ?? void 0 : void 0;
			const consoleProject = loadState.kind === "ready" && consoleProjectId !== void 0 ? loadState.list?.projects.find((project) => project.projectId === consoleProjectId) : void 0;
			const togglePin = (projectId) => {
				setPreferences((current) => {
					const next = current.pinnedProjectIds.includes(projectId) ? {
						...current,
						pinnedProjectIds: current.pinnedProjectIds.filter((id) => id !== projectId)
					} : {
						...current,
						pinnedProjectIds: [projectId, ...current.pinnedProjectIds]
					};
					saveConsolePreferences(next);
					return next;
				});
			};
			/** 记住当前打开的项目控制台，供重启恢复。 */
			const rememberConsoleProject = (projectId) => {
				setPreferences((current) => {
					const next = {
						...current,
						consoleProjectId: projectId
					};
					saveConsolePreferences(next);
					return next;
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ProjectControlPlaceholder_module_css_default.console,
				"aria-label": "项目控制台",
				"data-personal-project-placeholder": true,
				"data-personal-project-control": "gate-2c",
				"data-project-control-gate": "2c",
				"data-project-storage-state": storageState,
				"data-project-count": projectCount,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: ProjectControlPlaceholder_module_css_default.consoleHeader,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProjectControlPlaceholder_module_css_default.gateBadge,
							children: "Gate 2D"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: "项目控制台" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "发现、只读关联现有项目并快速新建标准项目" })
					] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: ProjectControlPlaceholder_module_css_default.iconButton,
						type: "button",
						"aria-label": "刷新项目控制台",
						title: "刷新",
						onClick: reload,
						children: "↻"
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
					className: ProjectControlPlaceholder_module_css_default.content,
					children: [
						loadState.kind === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingState, {}),
						loadState.kind === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorState, {
							message: loadState.message,
							onRetry: reload
						}),
						loadState.kind === "ready" && consoleProject === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReadyState, {
							state: loadState,
							scanState,
							createState,
							bridgeAvailable: hasProjectControlDirectoryBridge(),
							candidateMutation,
							candidateView,
							candidateSearchInput,
							selectedCandidates,
							hasPreviousCandidatePage: candidateCursorHistory.length > 0,
							onChooseCandidateView: chooseCandidateView,
							onCandidateSearchInput: setCandidateSearchInput,
							onApplyCandidateSearch: applyCandidateSearch,
							onSelectCandidate: selectCandidate,
							onSelectCandidatePage: selectCandidatePage,
							onMutateSelectedCandidates: () => {
								mutateSelectedCandidates();
							},
							onNextCandidatePage: nextCandidatePage,
							onPreviousCandidatePage: previousCandidatePage,
							onScan: (mode) => {
								beginScan(mode);
							},
							onOpenCandidate: openCandidate,
							onToggleIgnored: (candidate) => {
								toggleIgnored(candidate);
							},
							onBeginCreate: () => {
								beginCreate();
							},
							onUpdateCreateForm: updateCreateForm,
							onPrepareCreate: (form) => {
								prepareCreate(form);
							},
							onSubmitCreate: (form, preview) => {
								submitCreate(form, preview);
							},
							onEditCreate: (form) => {
								setCreateState({
									kind: "form",
									form
								});
							},
							onCancelCreate: () => {
								setCreateState({ kind: "idle" });
							},
							documentPanel,
							documentMutation,
							rebindChoices,
							onOpenDocuments: (project) => {
								openDocuments(project);
							},
							onRefreshDocuments: () => {
								refreshDocuments();
							},
							onResolveRebind: (proposal, decision) => {
								resolveRebind(proposal, decision);
							},
							onChooseRebindCandidate: (proposalId, path) => {
								setRebindChoices((current) => ({
									...current,
									[proposalId]: path
								}));
							},
							onCloseDocuments: () => {
								setDocumentPanel({ kind: "idle" });
							},
							pinnedProjectIds: preferences.pinnedProjectIds,
							onOpenConsole: (project) => {
								setConsoleProjectId(project.projectId);
								rememberConsoleProject(project.projectId);
								api$1.workspaceStatus(project.projectId).then((status) => {
									workbench.setProjectWorkspace(project.projectId, status.root);
								}).catch(() => {
									workbench.clearProjectWorkspace();
								});
							},
							onTogglePin: togglePin
						}),
						consoleProject !== void 0 && loadState.kind === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectConsole, {
							project: consoleProject,
							workbench,
							currentSessionId,
							pinned: preferences.pinnedProjectIds.includes(consoleProject.projectId),
							onTogglePin: () => {
								togglePin(consoleProject.projectId);
							},
							onBack: () => {
								setConsoleProjectId(void 0);
								rememberConsoleProject(void 0);
								notifyMemoryProjectBinding(void 0, currentSessionId);
								workbench.clearProjectWorkspace();
							}
						})
					]
				})]
			});
		}
		function LoadingState() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectControlPlaceholder_module_css_default.statePanel,
				role: "status",
				"aria-live": "polite",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ProjectControlPlaceholder_module_css_default.emptyIcon,
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DatabaseIcon, {})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "正在读取项目控制面" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "项目和扫描候选均来自本机 Host，不会用示例数据代替。" })
				]
			});
		}
		function ErrorState({ message, onRetry }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectControlPlaceholder_module_css_default.statePanel,
				role: "alert",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ProjectControlPlaceholder_module_css_default.emptyIcon,
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DatabaseIcon, {})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "无法读取项目控制台" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: message }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: ProjectControlPlaceholder_module_css_default.secondaryButton,
						type: "button",
						onClick: onRetry,
						children: "重试"
					})
				]
			});
		}
		function ReadyState({ state, scanState, createState, bridgeAvailable, candidateMutation, candidateView, candidateSearchInput, selectedCandidates, hasPreviousCandidatePage, onChooseCandidateView, onCandidateSearchInput, onApplyCandidateSearch, onSelectCandidate, onSelectCandidatePage, onMutateSelectedCandidates, onNextCandidatePage, onPreviousCandidatePage, onScan, onOpenCandidate, onToggleIgnored, onBeginCreate, onUpdateCreateForm, onPrepareCreate, onSubmitCreate, onEditCreate, onCancelCreate, documentPanel, documentMutation, rebindChoices, onOpenDocuments, onRefreshDocuments, onResolveRebind, onChooseRebindCandidate, onCloseDocuments, pinnedProjectIds, onOpenConsole, onTogglePin }) {
			const descriptor = storageDescriptor(state.status.storage.state);
			const scanning = scanState.kind === "selecting" || scanState.kind === "scanning";
			const activeDocumentsProjectId = documentPanel.kind === "loading" || documentPanel.kind === "ready" ? documentPanel.kind === "loading" ? documentPanel.projectId : documentPanel.index.projectId : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectControlPlaceholder_module_css_default.readyState,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: ProjectControlPlaceholder_module_css_default.statusCard,
						"aria-label": "项目数据库状态",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ProjectControlPlaceholder_module_css_default.statusIcon,
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DatabaseIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: descriptor.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: descriptor.detail })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProjectControlPlaceholder_module_css_default.countBadge,
								children: state.status.counts.projects === null ? "项目数未知" : `${String(state.status.counts.projects)} 个项目`
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: ProjectControlPlaceholder_module_css_default.intakeSection,
						"aria-labelledby": "project-intake-heading",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ProjectControlPlaceholder_module_css_default.sectionHeading,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									id: "project-intake-heading",
									children: "添加现有项目"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "扫描只读取授权目录；确认前不会登记，也不会写入项目文件。" })] })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ProjectControlPlaceholder_module_css_default.actionGrid,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										className: ProjectControlPlaceholder_module_css_default.primaryAction,
										type: "button",
										disabled: !bridgeAvailable || scanning || state.status.storage.state !== "ready",
										onClick: () => {
											onScan("source-root");
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											"aria-hidden": "true",
											children: "⌕"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "扫描来源目录" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "发现直接子目录中的多个项目" })] })]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										className: ProjectControlPlaceholder_module_css_default.primaryAction,
										type: "button",
										disabled: !bridgeAvailable || scanning || state.status.storage.state !== "ready",
										onClick: () => {
											onScan("project-root");
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											"aria-hidden": "true",
											children: "＋"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "导入单个项目" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "选择一个确定的项目根目录" })] })]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										className: ProjectControlPlaceholder_module_css_default.primaryAction,
										type: "button",
										disabled: !bridgeAvailable || scanning || state.status.storage.state !== "ready" || createState.kind !== "idle",
										onClick: onBeginCreate,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											"aria-hidden": "true",
											children: "⚡"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "快速新建标准项目" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "从版本化模板创建受管理项目" })] })]
									})
								]
							}),
							!bridgeAvailable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: ProjectControlPlaceholder_module_css_default.bridgeNotice,
								role: "note",
								children: "目录选择桥不可用。请从 DeepSeek Harness Personal 桌面客户端打开此页面。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScanNotice, { state: scanState })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreateFlow, {
						state: createState,
						bridgeAvailable,
						onPickParent: () => {
							onBeginCreate();
						},
						onUpdateForm: onUpdateCreateForm,
						onPrepare: onPrepareCreate,
						onSubmit: onSubmitCreate,
						onEdit: onEditCreate,
						onCancel: onCancelCreate
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CandidateCenterNavigation, {
						activeView: candidateView,
						projectCount: state.list?.total ?? 0,
						counts: state.candidatePage.counts,
						...state.candidateError === void 0 ? {} : { candidateError: state.candidateError },
						searchInput: candidateSearchInput,
						onChooseView: onChooseCandidateView,
						onSearchInput: onCandidateSearchInput,
						onApplySearch: onApplyCandidateSearch
					}),
					candidateView === "projects" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectSection, {
						...state.list === void 0 ? {} : { list: state.list },
						...state.listError === void 0 ? {} : { error: state.listError },
						...activeDocumentsProjectId === void 0 ? {} : { documentsProjectId: activeDocumentsProjectId },
						onOpenDocuments,
						pinnedProjectIds,
						onOpenConsole,
						onTogglePin
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CandidateSection, {
						view: candidateView,
						candidates: state.candidatePage.candidates,
						total: state.candidatePage.total,
						nextCursor: state.candidatePage.nextCursor,
						hasPreviousPage: hasPreviousCandidatePage,
						selectedCandidates,
						...state.candidateError === void 0 ? {} : { error: state.candidateError },
						candidateMutation,
						onOpen: onOpenCandidate,
						onToggleIgnored,
						onSelect: onSelectCandidate,
						onSelectPage: onSelectCandidatePage,
						onMutateSelected: onMutateSelectedCandidates,
						onNextPage: onNextCandidatePage,
						onPreviousPage: onPreviousCandidatePage
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DocumentIndexPanel, {
						panel: documentPanel,
						mutation: documentMutation,
						choices: rebindChoices,
						onRefresh: onRefreshDocuments,
						onResolve: onResolveRebind,
						onChoose: onChooseRebindCandidate,
						onClose: onCloseDocuments
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
						className: ProjectControlPlaceholder_module_css_default.statusFacts,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "数据库 Schema" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: state.status.storage.schemaVersion ?? "未建立" })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "数据库访问" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: storageAccessLabel(state.status.storage) })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "协议" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: state.status.protocolVersion })] })
						]
					})
				]
			});
		}
		function CreateFlow({ state, bridgeAvailable, onPickParent, onUpdateForm, onPrepare, onSubmit, onEdit, onCancel }) {
			if (state.kind === "idle") return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ProjectControlPlaceholder_module_css_default.createSection,
				"aria-labelledby": "project-create-heading",
				"data-personal-project-create": true,
				"data-create-flow-state": state.kind,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ProjectControlPlaceholder_module_css_default.sectionHeading,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "project-create-heading",
							children: "快速新建标准项目"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "从版本化模板创建；登记为受管理项目，不会切换当前会话。" })] })
					}),
					state.kind === "picking" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ProjectControlPlaceholder_module_css_default.scanNotice,
						role: "status",
						children: "正在等待你选择父目录…"
					}),
					(state.kind === "form" || state.kind === "preparing") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreateFormFields, {
						form: state.form,
						busy: state.kind === "preparing",
						bridgeAvailable,
						onPickParent,
						onUpdateForm,
						onPrepare: () => {
							onPrepare(state.form);
						},
						onCancel
					}),
					(state.kind === "preview" || state.kind === "submitting") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreatePreview, {
						preview: state.preview,
						submitting: state.kind === "submitting",
						onSubmit: () => {
							onSubmit(state.form, state.preview);
						},
						onEdit: () => {
							onEdit(state.form);
						},
						onCancel
					}),
					state.kind === "success" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectControlPlaceholder_module_css_default.createSuccess,
						role: "status",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: ["✓ ", state.message] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProjectControlPlaceholder_module_css_default.operationPath,
								children: state.projectId
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: ProjectControlPlaceholder_module_css_default.confirmButton,
								type: "button",
								onClick: onCancel,
								children: "完成"
							})
						]
					}),
					state.kind === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectControlPlaceholder_module_css_default.createError,
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: state.message }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectControlPlaceholder_module_css_default.createActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: ProjectControlPlaceholder_module_css_default.secondaryButton,
								type: "button",
								onClick: () => {
									if (state.form !== void 0) onEdit(state.form);
									else onCancel();
								},
								children: state.form !== void 0 ? "返回修改" : "关闭"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: ProjectControlPlaceholder_module_css_default.secondaryButton,
								type: "button",
								onClick: onCancel,
								children: "取消"
							})]
						})]
					})
				]
			});
		}
		function CreateFormFields({ form, busy, bridgeAvailable, onPickParent, onUpdateForm, onPrepare, onCancel }) {
			const template = form.templates.find((item) => item.templateId === form.templateId);
			const canPrepare = form.directoryName.trim().length > 0 && form.name.trim().length > 0 && template !== void 0 && !busy;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectControlPlaceholder_module_css_default.createForm,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectControlPlaceholder_module_css_default.createField,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProjectControlPlaceholder_module_css_default.fieldLabel,
							children: "父目录"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectControlPlaceholder_module_css_default.parentRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProjectControlPlaceholder_module_css_default.pathText,
								title: form.parent.path,
								children: form.parent.path
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: ProjectControlPlaceholder_module_css_default.smallButton,
								type: "button",
								disabled: busy || !bridgeAvailable,
								onClick: onPickParent,
								children: "重新选择"
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: ProjectControlPlaceholder_module_css_default.createField,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProjectControlPlaceholder_module_css_default.fieldLabel,
							children: "目录名（文件夹名）"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: ProjectControlPlaceholder_module_css_default.textInput,
							type: "text",
							value: form.directoryName,
							maxLength: 120,
							placeholder: "例如 meal-tracker",
							disabled: busy,
							onChange: (event) => {
								onUpdateForm({ directoryName: event.target.value });
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: ProjectControlPlaceholder_module_css_default.createField,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProjectControlPlaceholder_module_css_default.fieldLabel,
							children: "项目名称"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: ProjectControlPlaceholder_module_css_default.textInput,
							type: "text",
							value: form.name,
							maxLength: 120,
							placeholder: "显示在项目列表中的名称",
							disabled: busy,
							onChange: (event) => {
								onUpdateForm({ name: event.target.value });
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: ProjectControlPlaceholder_module_css_default.createField,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProjectControlPlaceholder_module_css_default.fieldLabel,
							children: "模板"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							className: ProjectControlPlaceholder_module_css_default.selectInput,
							value: form.templateId,
							disabled: busy || form.templates.length === 0,
							onChange: (event) => {
								onUpdateForm({ templateId: event.target.value });
							},
							children: form.templates.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
								value: item.templateId,
								children: [
									item.displayName,
									" · ",
									item.templateVersion
								]
							}, `${item.templateId}@${item.templateVersion}`))
						})]
					}),
					template?.description != null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ProjectControlPlaceholder_module_css_default.templateDescription,
						children: template.description
					}),
					form.templatesError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ProjectControlPlaceholder_module_css_default.createError,
						role: "alert",
						children: form.templatesError
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectControlPlaceholder_module_css_default.createActions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ProjectControlPlaceholder_module_css_default.secondaryButton,
							type: "button",
							disabled: busy,
							onClick: onCancel,
							children: "取消"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ProjectControlPlaceholder_module_css_default.confirmButton,
							type: "button",
							disabled: !canPrepare,
							onClick: onPrepare,
							children: busy ? "正在准备…" : "预览新建内容"
						})]
					})
				]
			});
		}
		function CreatePreview({ preview, submitting, onSubmit, onEdit, onCancel }) {
			const operations = Array.isArray(preview.writePlan.operations) ? preview.writePlan.operations : [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectControlPlaceholder_module_css_default.createForm,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ProjectControlPlaceholder_module_css_default.previewCard,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectControlPlaceholder_module_css_default.previewTopline,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: preview.template.displayName }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								preview.template.templateId,
								"@",
								preview.template.templateVersion
							] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
							className: ProjectControlPlaceholder_module_css_default.previewFacts,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "projectId" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
									title: preview.projectId,
									children: preview.projectId
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "目标目录" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
									title: preview.targetDisplayPath,
									children: preview.targetDisplayPath
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "模板哈希" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [preview.template.templateHash.slice(0, 18), "…"] })] })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: ProjectControlPlaceholder_module_css_default.previewNote,
							children: [
								"将创建 ",
								String(operations.length),
								" 个项目内路径；已存在的路径会阻止创建，不会覆盖任何文件。"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: ProjectControlPlaceholder_module_css_default.operationList,
							children: operations.map((operation, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: ProjectControlPlaceholder_module_css_default.operationItem,
								"data-kind": operation.kind,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										children: operation.kind === "create_directory" ? "📁" : "📄"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ProjectControlPlaceholder_module_css_default.operationPath,
										children: String(operation.relativePath)
									}),
									operation.kind === "create_file" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ProjectControlPlaceholder_module_css_default.hashText,
										children: [String(operation.contentHash).slice(0, 18), "…"]
									})
								]
							}, String(index)))
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ProjectControlPlaceholder_module_css_default.createActions,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ProjectControlPlaceholder_module_css_default.secondaryButton,
							type: "button",
							disabled: submitting,
							onClick: onCancel,
							children: "取消"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ProjectControlPlaceholder_module_css_default.secondaryButton,
							type: "button",
							disabled: submitting,
							onClick: onEdit,
							children: "返回修改"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ProjectControlPlaceholder_module_css_default.confirmButton,
							type: "button",
							disabled: submitting,
							onClick: onSubmit,
							children: submitting ? "正在创建…" : "确认创建"
						})
					]
				})]
			});
		}
		function ScanNotice({ state }) {
			if (state.kind === "idle") return null;
			if (state.kind === "selecting") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: ProjectControlPlaceholder_module_css_default.scanNotice,
				role: "status",
				children: "正在等待你选择目录…"
			});
			if (state.kind === "scanning") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ProjectControlPlaceholder_module_css_default.scanNotice,
				role: "status",
				"aria-live": "polite",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "正在只读扫描" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					title: state.path,
					children: state.path
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: state.kind === "error" ? ProjectControlPlaceholder_module_css_default.scanError : ProjectControlPlaceholder_module_css_default.scanNotice,
				role: state.kind === "error" ? "alert" : "status",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: state.kind === "error" ? "扫描未完成" : state.message }),
					state.kind === "success" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						title: state.path,
						children: state.path
					}),
					state.kind === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: state.message })
				]
			});
		}
		function CandidateCenterNavigation({ activeView, projectCount, counts, candidateError, searchInput, onChooseView, onSearchInput, onApplySearch }) {
			const views = [
				{
					id: "projects",
					label: "项目",
					count: projectCount
				},
				{
					id: "review",
					label: "待审阅",
					count: counts.review
				},
				{
					id: "ignored",
					label: "已忽略",
					count: counts.ignored
				},
				{
					id: "history",
					label: "历史记录",
					count: counts.history
				}
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ProjectControlPlaceholder_module_css_default.candidateCenter,
				"aria-labelledby": "candidate-center-heading",
				"data-candidate-center-view": activeView,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ProjectControlPlaceholder_module_css_default.sectionHeading,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "candidate-center-heading",
							children: "候选中心"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "正式项目、待处理项、已忽略项和历史证据彼此分开。" })] })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ProjectControlPlaceholder_module_css_default.candidateTabs,
						role: "tablist",
						"aria-label": "候选中心视图",
						children: views.map((view) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							className: ProjectControlPlaceholder_module_css_default.candidateTab,
							type: "button",
							role: "tab",
							"aria-selected": activeView === view.id,
							onClick: () => {
								onChooseView(view.id);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: view.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: String(view.count) })]
						}, view.id))
					}),
					activeView === "projects" && candidateError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: ProjectControlPlaceholder_module_css_default.scanError,
						role: "alert",
						children: ["候选计数暂时无法读取：", candidateError]
					}),
					activeView !== "projects" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: ProjectControlPlaceholder_module_css_default.candidateSearch,
						role: "search",
						onSubmit: (event) => {
							event.preventDefault();
							onApplySearch();
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "search",
							value: searchInput,
							maxLength: 200,
							placeholder: "搜索名称、路径、候选 ID 或项目 ID",
							"aria-label": "搜索候选",
							onChange: (event) => {
								onSearchInput(event.currentTarget.value);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ProjectControlPlaceholder_module_css_default.smallButton,
							type: "submit",
							children: "搜索"
						})]
					})
				]
			});
		}
		function CandidateSection({ view, candidates, total, nextCursor, hasPreviousPage, selectedCandidates, error, candidateMutation, onOpen, onToggleIgnored, onSelect, onSelectPage, onMutateSelected, onNextPage, onPreviousPage }) {
			const title = view === "review" ? "待审阅候选" : view === "ignored" ? "已忽略" : "历史记录";
			const selectable = view !== "history";
			const selectedCount = candidates.filter((candidate) => selectedCandidates[candidate.candidateId] === candidate.revision).length;
			const allSelected = selectable && candidates.length > 0 && selectedCount === candidates.length;
			const emptyMessage = view === "review" ? "当前没有需要处理的候选。已登记、已忽略和旧扫描不会占用这里的位置。" : view === "ignored" ? "当前没有已忽略候选。" : "当前没有候选历史记录。";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ProjectControlPlaceholder_module_css_default.candidateSection,
				"aria-labelledby": `candidate-section-${view}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectControlPlaceholder_module_css_default.sectionHeading,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: `candidate-section-${view}`,
							children: title
						}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							"本页 ",
							String(candidates.length),
							" / 共 ",
							String(total),
							" 项"
						] })]
					}),
					selectable && candidates.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectControlPlaceholder_module_css_default.candidateBatchBar,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: allSelected,
								onChange: (event) => {
									onSelectPage(candidates, event.currentTarget.checked);
								}
							}), "选择本页"] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								"已选 ",
								String(selectedCount),
								" 项"
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: ProjectControlPlaceholder_module_css_default.smallButton,
								type: "button",
								disabled: selectedCount === 0 || candidateMutation !== void 0,
								onClick: onMutateSelected,
								children: candidateMutation === "batch" ? "处理中…" : view === "review" ? "批量忽略" : "批量恢复"
							})
						]
					}),
					error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ProjectControlPlaceholder_module_css_default.emptyCopy,
						role: "alert",
						children: error
					}) : candidates.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ProjectControlPlaceholder_module_css_default.emptyCopy,
						children: emptyMessage
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: ProjectControlPlaceholder_module_css_default.candidateList,
						children: candidates.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: ProjectControlPlaceholder_module_css_default.candidateCard,
							"data-ignored": candidate.ignored || void 0,
							"data-selectable": selectable || void 0,
							children: [
								selectable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									className: ProjectControlPlaceholder_module_css_default.candidateSelect,
									"aria-label": `选择 ${candidate.suggestedName}`,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: selectedCandidates[candidate.candidateId] === candidate.revision,
										onChange: (event) => {
											onSelect(candidate, event.currentTarget.checked);
										}
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									className: ProjectControlPlaceholder_module_css_default.candidateMain,
									type: "button",
									onClick: () => {
										onOpen(candidate);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: ProjectControlPlaceholder_module_css_default.candidateTopline,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: candidate.suggestedName }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												"data-level": candidate.evidenceLevel,
												children: evidenceLabel(candidate.evidenceLevel)
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ProjectControlPlaceholder_module_css_default.candidatePath,
											title: candidate.rootPath,
											children: candidate.rootPath
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: ProjectControlPlaceholder_module_css_default.candidateMeta,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: candidateStatusLabel(view, candidate) }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [candidate.documentCount, " 份文档"] }),
												candidate.issueCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [candidate.issueCount, " 个问题"] })
											]
										})
									]
								}),
								selectable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: ProjectControlPlaceholder_module_css_default.ignoreButton,
									type: "button",
									disabled: candidateMutation !== void 0,
									"aria-label": candidate.ignored ? `恢复 ${candidate.suggestedName}` : `忽略 ${candidate.suggestedName}`,
									onClick: () => {
										onToggleIgnored(candidate);
									},
									children: candidateMutation === candidate.candidateId ? "处理中…" : candidate.ignored ? "恢复" : "忽略"
								})
							]
						}, candidate.candidateId))
					}),
					(hasPreviousPage || nextCursor !== null) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectControlPlaceholder_module_css_default.candidatePagination,
						"aria-label": "候选分页",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ProjectControlPlaceholder_module_css_default.smallButton,
							type: "button",
							disabled: !hasPreviousPage,
							onClick: onPreviousPage,
							children: "上一页"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: ProjectControlPlaceholder_module_css_default.smallButton,
							type: "button",
							disabled: nextCursor === null,
							onClick: onNextPage,
							children: "下一页"
						})]
					})
				]
			});
		}
		function ProjectSection({ list, error, documentsProjectId, onOpenDocuments, pinnedProjectIds, onOpenConsole, onTogglePin }) {
			const ordered = list === void 0 ? void 0 : [...list.projects].sort((left, right) => {
				const leftPinned = pinnedProjectIds.includes(left.projectId) ? 1 : 0;
				const rightPinned = pinnedProjectIds.includes(right.projectId) ? 1 : 0;
				if (leftPinned !== rightPinned) return rightPinned - leftPinned;
				return left.name.localeCompare(right.name, "zh-Hans-CN");
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ProjectControlPlaceholder_module_css_default.projectSection,
				"aria-labelledby": "project-control-list-heading",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ProjectControlPlaceholder_module_css_default.sectionHeading,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: "project-control-list-heading",
						children: "已登记项目"
					}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: list === void 0 ? "不可用" : String(list.total) + " 项" })]
				}), ordered === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: ProjectControlPlaceholder_module_css_default.emptyCopy,
					children: error ?? "项目列表暂时无法读取。"
				}) : ordered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: ProjectControlPlaceholder_module_css_default.emptyCopy,
					children: "数据库当前没有登记项目。"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: ProjectControlPlaceholder_module_css_default.projectList,
					children: ordered.map((project) => {
						const pinned = pinnedProjectIds.includes(project.projectId);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: ProjectControlPlaceholder_module_css_default.projectItem,
							"data-project-pinned": pinned || void 0,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: project.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: project.projectId })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ProjectControlPlaceholder_module_css_default.projectItemActions,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: registrationLabel(project.registrationMode) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: ProjectControlPlaceholder_module_css_default.smallButton,
										type: "button",
										"data-documents-open": documentsProjectId === project.projectId || void 0,
										onClick: () => {
											onOpenDocuments(project);
										},
										children: documentsProjectId === project.projectId ? "收起文档" : "文档索引"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: ProjectControlPlaceholder_module_css_default.smallButton,
										type: "button",
										"aria-pressed": pinned,
										"aria-label": pinned ? "取消置顶 " + project.name : "置顶 " + project.name,
										onClick: () => {
											onTogglePin(project.projectId);
										},
										children: pinned ? "📌" : "置顶"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: ProjectControlPlaceholder_module_css_default.confirmButton,
										type: "button",
										"data-open-console": true,
										onClick: () => {
											onOpenConsole(project);
										},
										children: "打开控制台"
									})
								]
							})]
						}, project.projectId);
					})
				})]
			});
		}
		function DocumentIndexPanel({ panel, mutation, choices, onRefresh, onResolve, onChoose, onClose }) {
			if (panel.kind === "idle") return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ProjectControlPlaceholder_module_css_default.documentPanel,
				"aria-labelledby": "project-documents-heading",
				"data-personal-project-documents": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ProjectControlPlaceholder_module_css_default.documentPanelHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
							id: "project-documents-heading",
							children: "文档索引"
						}), panel.kind === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
							panel.index.name,
							" · 修订 ",
							String(panel.index.revision)
						] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectControlPlaceholder_module_css_default.documentPanelActions,
							children: [panel.kind === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: ProjectControlPlaceholder_module_css_default.smallButton,
								type: "button",
								disabled: mutation !== void 0,
								onClick: onRefresh,
								children: mutation !== void 0 ? "处理中…" : "刷新核对"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: ProjectControlPlaceholder_module_css_default.smallButton,
								type: "button",
								onClick: onClose,
								children: "关闭"
							})]
						})]
					}),
					panel.kind === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ProjectControlPlaceholder_module_css_default.documentPanelEmpty,
						role: "status",
						children: "正在核对项目文档…"
					}),
					panel.kind === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: ProjectControlPlaceholder_module_css_default.documentPanelEmpty,
						role: "alert",
						children: panel.message
					}),
					panel.kind === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						panel.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: ProjectControlPlaceholder_module_css_default.createError,
							role: "alert",
							children: panel.error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: ProjectControlPlaceholder_module_css_default.documentPanelEmpty,
							children: [
								"来源：",
								panel.index.mode === "managed" ? "manifest 绑定（受管理）" : "已确认绑定（只关联）",
								panel.index.locationDisplayPath !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: ProjectControlPlaceholder_module_css_default.documentLocation,
									title: panel.index.locationDisplayPath,
									children: [" · ", panel.index.locationDisplayPath]
								})
							]
						}),
						panel.index.documents.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: ProjectControlPlaceholder_module_css_default.documentPanelEmpty,
							children: "该项目没有文档绑定。点击“刷新核对”后这里会显示每份文档的哈希与解析诊断。"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: ProjectControlPlaceholder_module_css_default.documentList,
							children: panel.index.documents.map((document) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: ProjectControlPlaceholder_module_css_default.documentRow,
								"data-document-state": document.state,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: ProjectControlPlaceholder_module_css_default.documentRowMain,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ProjectControlPlaceholder_module_css_default.documentRole,
											children: documentRoleLabel(document.role)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ProjectControlPlaceholder_module_css_default.documentPath,
											title: document.relativePath,
											children: document.relativePath
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: ProjectControlPlaceholder_module_css_default.documentRowSide,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ProjectControlPlaceholder_module_css_default.documentStateBadge,
											"data-state": document.state,
											children: documentStateLabel(document)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ProjectControlPlaceholder_module_css_default.documentHash,
											title: document.contentHash ?? void 0,
											children: document.contentHash === null ? "—" : document.contentHash.slice(0, 18)
										})]
									}),
									document.parseIssues.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ProjectControlPlaceholder_module_css_default.documentIssues,
										children: document.parseIssues.map((issue, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: ProjectControlPlaceholder_module_css_default.documentIssue,
											children: ["⚠ ", issue.message]
										}, issue.code + "-" + String(index)))
									})
								]
							}, document.role + "\0" + document.relativePath))
						}),
						panel.index.proposals.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectControlPlaceholder_module_css_default.proposalGroup,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								className: ProjectControlPlaceholder_module_css_default.proposalGroupTitle,
								children: "重命名重绑提案（需人工确认）"
							}), panel.index.proposals.map((proposal) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ProjectControlPlaceholder_module_css_default.proposalCard,
								"data-rebind-proposal": proposal.proposalId,
								"data-rebind-status": proposal.status,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ProjectControlPlaceholder_module_css_default.proposalLine,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ProjectControlPlaceholder_module_css_default.documentRole,
											children: documentRoleLabel(proposal.role)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ProjectControlPlaceholder_module_css_default.proposalPath,
											children: proposal.missingRelativePath
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											"aria-hidden": "true",
											children: "→"
										})
									]
								}), proposal.status === "proposed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ProjectControlPlaceholder_module_css_default.proposalActions,
									children: proposal.unambiguous ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ProjectControlPlaceholder_module_css_default.proposalPath,
										title: proposal.candidateRelativePaths[0],
										children: proposal.candidateRelativePaths[0]
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: ProjectControlPlaceholder_module_css_default.documentPanelEmpty,
										children: [
											"候选（",
											String(proposal.candidateCount),
											" 处，内容哈希一致）："
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
										value: choices[proposal.proposalId] ?? proposal.candidateRelativePaths[0],
										onChange: (event) => {
											onChoose(proposal.proposalId, event.target.value);
										},
										children: proposal.candidateRelativePaths.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: path,
											children: path
										}, path))
									})] })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ProjectControlPlaceholder_module_css_default.proposalActions,
									children: proposal.applicable ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: ProjectControlPlaceholder_module_css_default.confirmButton,
										type: "button",
										disabled: mutation !== void 0,
										onClick: () => {
											onResolve(proposal, "accept");
										},
										children: "应用重绑"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: ProjectControlPlaceholder_module_css_default.smallButton,
										type: "button",
										disabled: mutation !== void 0,
										onClick: () => {
											onResolve(proposal, "reject");
										},
										children: "忽略"
									})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ProjectControlPlaceholder_module_css_default.proposalHint,
										children: "受管理项目以 manifest 为准：请先在项目 manifest 中更新路径，再重新核对。"
									})
								})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: ProjectControlPlaceholder_module_css_default.proposalHint,
									children: [
										proposal.status === "accepted" && "已重绑到 " + (proposal.resolvedRelativePath ?? ""),
										proposal.status === "rejected" && "已忽略",
										proposal.status === "superseded" && "已被新状态替代"
									]
								})]
							}, proposal.proposalId))]
						})
					] })
				]
			});
		}
		function documentStateLabel(document) {
			switch (document.state) {
				case "ok": return "一致";
				case "changed": return "内容已变化";
				case "missing": return "缺失";
				case "unreadable": return "无法读取";
			}
		}
		function storageDescriptor(state) {
			switch (state) {
				case "ready": return {
					title: "项目数据库已就绪",
					detail: "当前显示真实登记状态与扫描候选。"
				};
				case "read_only_newer_schema": return {
					title: "项目数据库受版本保护",
					detail: "检测到更高版本；当前 Host 未打开数据库。"
				};
				case "migration_failed": return {
					title: "项目数据库迁移需要处理",
					detail: "当前不会继续写入，请先处理迁移问题。"
				};
				case "unavailable": return {
					title: "项目数据库暂不可用",
					detail: "当前 Host 未打开数据库，也不会生成替代数据。"
				};
			}
		}
		function storageAccessLabel(storage) {
			if (storage.state === "ready") return storage.writable ? "可读写" : "只读";
			if (storage.state === "read_only_newer_schema") return "未打开（版本保护）";
			return "未打开";
		}
		function registrationLabel(mode) {
			if (mode === "managed") return "受管理";
			if (mode === "linked_legacy") return "只关联";
			return "状态未知";
		}
		function evidenceLabel(level) {
			if (level === "high") return "高证据";
			if (level === "medium") return "中证据";
			if (level === "low") return "低证据";
			return "证据未知";
		}
		function statusLabel(status) {
			if (status === "discovered") return "待确认";
			if (status === "ignored") return "已忽略";
			if (status === "conflict") return "需要处理";
			if (status === "registered") return "已登记";
			if (status === "imported") return "已登记";
			if (status === "relocation_candidate") return "位置待重绑";
			return status;
		}
		function candidateStatusLabel(view, candidate) {
			if (view === "history" && candidate.historyReason === "superseded") return "已被新扫描取代";
			return statusLabel(candidate.status);
		}
		function candidatePathPreview(path) {
			return path.length <= 160 ? path : `${path.slice(0, 157)}…`;
		}
		function errorMessage(error, fallback) {
			return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
		}
		function scanIssueMessage(issues) {
			const open = issues.filter((issue) => issue.status === "open");
			if (open.length === 0) return "";
			const serious = open.filter((issue) => issue.severity === "error" || issue.severity === "blocking").length;
			const first = open.slice(0, 2).map((issue) => issue.message).join("；");
			return ` 来源扫描${serious > 0 ? "不完整" : "有提醒"}（${String(open.length)} 项）：${first}`;
		}
		function DatabaseIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 24 24",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
						cx: "12",
						cy: "6",
						rx: "7",
						ry: "3"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" })
				]
			});
		}
		//#endregion
		//#region src/client/ProgressUpdateViewer.tsx
		const api = createProjectControlApi();
		const PROGRESS_UPDATE_RESOURCE_PATTERN = /^prj_[0-9a-f-]+:upd:upd_[0-9a-f-]+$/u;
		function isProgressUpdateResourceKey(value) {
			return typeof value === "string" && PROGRESS_UPDATE_RESOURCE_PATTERN.test(value);
		}
		/**
		* Plugin-owned artifact viewer for accepted external runtime updates.
		* It reads only from the bounded Host projections — it never re-imports
		* rendered Markdown or re-implements other Workbench viewers.
		*/
		function ProgressUpdateViewer({ descriptor }) {
			const resourceKey = descriptor.resourceKey ?? "";
			const separator = resourceKey.indexOf(":upd:");
			const projectId = separator > 0 ? resourceKey.slice(0, separator) : "";
			const updateId = separator > 0 ? resourceKey.slice(separator + 5) : "";
			const [update, setUpdate] = (0, react.useState)();
			const [error, setError] = (0, react.useState)();
			(0, react.useEffect)(() => {
				if (projectId === "" || updateId === "") {
					setError("更新标识无效。");
					return;
				}
				const controller = new AbortController();
				api.listProgressUpdates(projectId, controller.signal).then((page) => {
					if (controller.signal.aborted) return;
					const found = page.items.find((item) => item.progressUpdateId === updateId);
					if (found === void 0) setError("这条更新已不在项目投影中。");
					else setUpdate(found);
				}).catch(() => {
					if (!controller.signal.aborted) setError("更新读取失败。");
				});
				return () => {
					controller.abort();
				};
			}, [projectId, updateId]);
			if (error !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ProjectConsole_module_css_default.tabNotice,
				role: "alert",
				"data-kind": "error",
				children: error
			});
			if (update === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ProjectConsole_module_css_default.tabNotice,
				role: "status",
				"data-kind": "loading",
				children: "正在读取进展更新…"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ProjectConsole_module_css_default.activity,
				"data-progress-update-viewer": true,
				"data-kind": update.kind,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ProjectConsole_module_css_default.itemCard,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ProjectConsole_module_css_default.itemTopline,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: update.summary }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ProjectConsole_module_css_default.updateKindBadge,
								"data-kind": update.kind,
								children: updateKindLabel(update.kind)
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ProjectConsole_module_css_default.itemMeta,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "聚合修订 " + String(update.aggregateRevision) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: update.aggregateType + " " + update.aggregateId }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: update.createdAt })
							]
						}),
						update.details !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: ProjectConsole_module_css_default.itemInstruction,
							children: update.details
						}),
						update.needs.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: ProjectConsole_module_css_default.acceptanceList,
							children: update.needs.map((need, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: "需要：" + need }, String(index)))
						}),
						update.acceptanceClaims.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: ProjectConsole_module_css_default.acceptanceList,
							children: update.acceptanceClaims.map((claim, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: "验收声明：" + claim }, String(index)))
						}),
						update.threadId !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ProjectConsole_module_css_default.itemMeta,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "线程 " + update.threadId })
						})
					]
				})
			});
		}
		function updateKindLabel(kind) {
			switch (kind) {
				case "progress": return "进展";
				case "blocker": return "阻塞";
				case "completion_declared": return "完成声明";
			}
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "workbench"];
		/** Occupy Project Control and contribute one bounded candidate viewer to Workbench. */
		function apply(ctx) {
			ctx.effect(() => ctx.workbench.viewers.register({
				id: "project-control.candidate-details",
				family: "details",
				title: "项目候选",
				canRestore: (descriptor) => descriptor.family === "details" && descriptor.viewerId === "project-control.candidate-details" && isCandidateResourceKey(descriptor.resourceKey),
				render: (descriptor) => isCandidateResourceKey(descriptor.resourceKey) ? (0, react.createElement)(CandidateDetails, { candidateId: descriptor.resourceKey }) : (0, react.createElement)("p", null, "候选项目标识无效。")
			}), "project-control: candidate details viewer");
			ctx.effect(() => ctx.workbench.viewers.register({
				id: "project-control.progress-update",
				family: "artifact",
				title: "进展更新",
				canRestore: (descriptor) => descriptor.family === "artifact" && descriptor.viewerId === "project-control.progress-update" && isProgressUpdateResourceKey(descriptor.resourceKey),
				render: (descriptor) => isProgressUpdateResourceKey(descriptor.resourceKey) ? (0, react.createElement)(ProgressUpdateViewer, { descriptor }) : (0, react.createElement)("p", null, "进展更新标识无效。")
			}), "project-control: progress update viewer");
			ctx.slots.inject("project.control", () => ctx.slots.register({
				name: "project.control",
				inject: () => ({ workbench: ctx.workbench })
			}, ProjectControlPlaceholder));
		}
		//#endregion
		exports.CandidateDetails = CandidateDetails;
		exports.ProgressUpdateViewer = ProgressUpdateViewer;
		exports.ProjectConsole = ProjectConsole;
		exports.ProjectControlPlaceholder = ProjectControlPlaceholder;
		exports.apply = apply;
		exports.createProjectControlApi = createProjectControlApi;
		exports.inject = inject;
		exports.isProgressUpdateResourceKey = isProgressUpdateResourceKey;
		exports.loadConsolePreferences = loadConsolePreferences;
		exports.saveConsolePreferences = saveConsolePreferences;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map