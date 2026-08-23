window.__ModuleLoader__.load({
	id: "@cyrus/dsh-personal-foundation",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/index.ts
		const inject = [];
		function apply(ctx) {
			ctx.provide("personalApi", { async request(path, options = {}) {
				const target = normalizePath(path);
				const response = await fetch(target, {
					method: options.method ?? "GET",
					headers: {
						"accept": "application/json",
						"x-dsh-personal-client": "1",
						...options.body === void 0 ? {} : { "content-type": "application/json" }
					},
					...options.body === void 0 ? {} : { body: JSON.stringify(options.body) },
					...options.signal === void 0 ? {} : { signal: options.signal },
					credentials: "same-origin"
				});
				const payload = await response.json();
				if (!response.ok || payload.ok !== true) {
					const error = payload.ok === false ? payload.error : {
						code: "HTTP_ERROR",
						message: `HTTP ${String(response.status)}`
					};
					throw Object.assign(new Error(error.message), {
						code: error.code,
						status: response.status
					});
				}
				return payload.data;
			} });
		}
		function normalizePath(path) {
			if (path === "/__personal/api" || path.startsWith("/__personal/api/")) return path;
			if (!path.startsWith("/")) throw new TypeError("personalApi path must begin with \"/\"");
			return `/__personal/api${path}`;
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.normalizePath = normalizePath;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map