import { parentPort } from "node:worker_threads";
import { env, pipeline } from "@huggingface/transformers";
//#region src/core/embedding-worker.ts
env.allowRemoteModels = false;
process.env.HF_HUB_OFFLINE = "1";
let extractor = null;
function noPort() {
	throw new Error("embedding worker 必须由 worker_threads 启动");
}
const port = parentPort === null ? noPort() : parentPort;
function postError(id, error) {
	const message = error instanceof Error && error.message !== "" ? error.message : String(error);
	port.postMessage({
		type: "error",
		id,
		error: message.slice(0, 1e3)
	});
}
port.on("message", (message) => {
	handle(message).catch((error) => {
		postError(message.id, error);
	});
});
async function handle(message) {
	if (message.type === "init") {
		if (extractor === null) {
			const started = Date.now();
			const dtype = message.dtype === "q8" || message.dtype === "fp32" || message.dtype === "fp16" || message.dtype === "int8" || message.dtype === "uint8" ? message.dtype : "q8";
			extractor = await pipeline("feature-extraction", String(message.modelDir ?? ""), {
				dtype,
				device: "cpu"
			});
			port.postMessage({
				type: "ready",
				loadedMs: Date.now() - started
			});
		} else port.postMessage({
			type: "ready",
			loadedMs: 0
		});
		return;
	}
	if (message.type === "embed") {
		if (extractor === null) throw new Error("worker 未初始化");
		const prefix = message.purpose === "query" && typeof message.queryInstruction === "string" && message.queryInstruction !== "" ? message.queryInstruction : "";
		const inputs = (message.texts ?? []).map((text) => prefix + text);
		const output = await extractor(inputs, {
			pooling: message.pooling,
			normalize: true
		});
		if (Array.isArray(output)) {
			const count = output.length;
			const dimensions = Number(output[0]?.dims?.[1] ?? 0);
			const collected = new Float32Array(count * dimensions);
			for (let i = 0; i < count; i += 1) {
				const data = output[i]?.data;
				if (data !== void 0) collected.set(data, i * dimensions);
			}
			const collectedBuffer = collected.buffer;
			port.postMessage({
				type: "embedded",
				id: message.id,
				vectors: collectedBuffer,
				count,
				dimensions
			}, [collectedBuffer]);
			return;
		}
		const count = Number(output.dims?.[0] ?? 1);
		const dimensions = Number(output.dims?.[1] ?? 0);
		const dataBuffer = (output.data ?? new Float32Array(0)).buffer;
		port.postMessage({
			type: "embedded",
			id: message.id,
			vectors: dataBuffer,
			count,
			dimensions
		}, [dataBuffer]);
		return;
	}
	if (message.type === "health") {
		port.postMessage({
			type: "health",
			loaded: extractor !== null,
			modelDir: String(message.modelDir ?? "")
		});
		return;
	}
	throw new Error("未知 worker 消息：" + String(message.type));
}
//#endregion
export {};
