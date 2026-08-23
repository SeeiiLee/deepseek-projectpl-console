import { createRequire } from "node:module";
import { createCipheriv, createHash, randomBytes, randomInt, scryptSync } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import "@deepseek-ai/cordis";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";
//#region C:/Users/Administrator/AppData/Roaming/DeepSeek Harness Personal Dev/harness-runtimes/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm/src/brand.ts
/**
* Brand a message identifier.
* @param id - the opaque message identifier.
* @returns the same string, branded; no validation is performed.
*/
function MessageId(id) {
	return id;
}
//#endregion
//#region C:/Users/Administrator/AppData/Roaming/DeepSeek Harness Personal Dev/harness-runtimes/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm/src/call-config.ts
/**
* Deep-freeze a value in place with an iterative traversal, guarding cycles,
* so later mutation throws without imposing a JavaScript call-stack depth cap.
* {@link AbortSignal} objects are deliberately skipped because they are the
* request's live cancellation channel and freezing them breaks abort.
* @param value - the value to freeze in place.
* @returns the same value, frozen.
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object") continue;
		if (node instanceof AbortSignal) continue;
		if (seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
//#endregion
//#region C:/Users/Administrator/AppData/Roaming/DeepSeek Harness Personal Dev/harness-runtimes/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm/src/message.ts
/** Message value types, identity, and immutable construction helpers. */
/**
* Detach and deep-freeze a message whose identity already exists.
* @param message - complete message, including its stable identity.
* @returns an immutable snapshot that preserves the identity.
*/
function freezeMessage(message) {
	return deepFreeze(structuredClone(message));
}
/**
* Create one identified message and freeze it before publication.
* @param input - complete role, content, and source for a new message.
* @returns an immutable message with a fresh stable identity.
*/
function createMessage(input) {
	return freezeMessage({
		...input,
		id: MessageId(crypto.randomUUID())
	});
}
/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {
	return createMessage({
		...input,
		role: "user"
	});
}
//#endregion
//#region C:/Users/Administrator/AppData/Roaming/DeepSeek Harness Personal Dev/harness-runtimes/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cosmokit/src/misc.ts
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
//#endregion
//#region C:/Users/Administrator/AppData/Roaming/DeepSeek Harness Personal Dev/harness-runtimes/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cosmokit/src/types.ts
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
let Binary;
(function(_Binary) {
	_Binary.is = isArrayBufferLike;
	_Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	_Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	_Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	_Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	_Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	_Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
//#endregion
//#region C:/Users/Administrator/AppData/Roaming/DeepSeek Harness Personal Dev/harness-runtimes/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/cosmokit/src/time.ts
let Time;
(function(_Time) {
	_Time.millisecond = 1;
	const second = _Time.second = 1e3;
	const minute = _Time.minute = second * 60;
	const hour = _Time.hour = minute * 60;
	const day = _Time.day = hour * 24;
	const week = _Time.week = day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	_Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	_Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / minute - offset) / 1440);
	}
	_Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * minute);
	}
	_Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * week || 0) + (parseFloat(capture[2]) * day || 0) + (parseFloat(capture[3]) * hour || 0) + (parseFloat(capture[4]) * minute || 0) + (parseFloat(capture[5]) * second || 0);
	}
	_Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	_Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= day - hour / 2) return Math.round(ms / day) + "d";
		else if (abs >= hour - minute / 2) return Math.round(ms / hour) + "h";
		else if (abs >= minute - second / 2) return Math.round(ms / minute) + "m";
		else if (abs >= second) return Math.round(ms / second) + "s";
		return ms + "ms";
	}
	_Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	_Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	_Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region C:/Users/Administrator/AppData/Roaming/DeepSeek Harness Personal Dev/harness-runtimes/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/vendor/schemastery/src/index.ts
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region C:/Users/Administrator/AppData/Roaming/DeepSeek Harness Personal Dev/harness-runtimes/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/util/timeout/src/index.ts
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;
//#endregion
//#region C:/Users/Administrator/AppData/Roaming/DeepSeek Harness Personal Dev/harness-runtimes/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm/src/error.ts
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
//#endregion
//#region C:/Users/Administrator/AppData/Roaming/DeepSeek Harness Personal Dev/harness-runtimes/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm/src/retry-policy.ts
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = Schema.object({
	initialDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: Schema.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = Schema.object({
	mode: Schema.const("normal").required(),
	maxRetries: Schema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
	retryableCodes: Schema.array(Schema.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = Schema.object({
	mode: Schema.const("always").required(),
	backoff: backoffSchema
});
Schema.union([normalPolicySchema, alwaysPolicySchema]);
//#endregion
//#region C:/Users/Administrator/AppData/Roaming/DeepSeek Harness Personal Dev/harness-runtimes/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm/src/attribution.ts
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
const { version } = createRequire(import.meta.url)("../package.json");
//#endregion
//#region src/core/gates.ts
const MAX_CLAIM_CHARS = 4e3;
const BLOCKING_PATTERNS = [
	{
		label: "GitHub fine-grained PAT",
		pattern: /github_pat_[A-Za-z0-9_]{20,}/u
	},
	{
		label: "GitHub classic PAT",
		pattern: /ghp_[A-Za-z0-9]{20,}/u
	},
	{
		label: "GitHub OAuth token",
		pattern: /gho_[A-Za-z0-9]{20,}/u
	},
	{
		label: "GitHub app token",
		pattern: /ghs_[A-Za-z0-9]{20,}/u
	},
	{
		label: "OpenAI 风格密钥",
		pattern: /sk-[A-Za-z0-9]{20,}/u
	},
	{
		label: "AWS access key",
		pattern: /AKIA[0-9A-Z]{16}/u
	},
	{
		label: "私钥块",
		pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u
	},
	{
		label: "Slack token",
		pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/u
	},
	{
		label: "身份证号",
		pattern: /\b\d{17}[\dXx]\b/u
	},
	{
		label: "银行卡号",
		pattern: /\b\d{16,20}\b/u
	}
];
function canonicalizeClaim(text) {
	return text.replace(/\s+/gu, " ").trim();
}
function normalizedHash(text) {
	return createHash("sha256").update(canonicalizeClaim(text)).digest("hex");
}
/**
* 派生检索文本：ASCII 词（小写）+ 中文二元组。写入时计算并存 searchable_text 列，
* FTS5 unicode61 不切 CJK，必须应用层分词。查询侧用同一函数变换。
*/
function buildSearchableText(text) {
	const canonical = canonicalizeClaim(text);
	const ascii = canonical.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
	const cjkRuns = canonical.match(/[\u3400-\u9fff]+/gu) ?? [];
	const bigrams = [];
	for (const run of cjkRuns) for (let i = 0; i + 1 < run.length; i += 1) bigrams.push(run.slice(i, i + 2));
	return [...ascii, ...bigrams].join(" ").toLowerCase();
}
/**
* 需求门（P2，纯启发式，默认仅用于 quick-pass）：判断一段用户文本是否需要历史记忆。
* 触发词指向「延续约定/历史决策/经验」；跳过词指向「无需历史的简单任务」。
*/
const NEED_PATTERNS = [
	/之前/u,
	/上次/u,
	/上回/u,
	/先前/u,
	/以前/u,
	/按约定/u,
	/按照之前/u,
	/之前说/u,
	/以前说/u,
	/你说过/u,
	/经验/u,
	/踩过/u,
	/坑/u,
	/老问题/u,
	/再犯/u,
	/历史决定/u,
	/历史/u,
	/继续/u,
	/接着/u,
	/延续/u,
	/接着上次/u,
	/为什么当时/u,
	/当时为什么/u,
	/上次怎么/u,
	/之前怎么/u
];
const SKIP_PATTERNS = [
	/^翻译[:：]?/u,
	/^改写/u,
	/^润色/u,
	/^总结一下这句/u,
	/^复述/u
];
/** 返回 true = 值得做一次有界记忆 quick-pass。 */
function needsMemory(text) {
	const trimmed = String(text ?? "").trim();
	if (trimmed === "" || trimmed.length > 8e3) return false;
	for (const pattern of SKIP_PATTERNS) if (pattern.test(trimmed)) return false;
	for (const pattern of NEED_PATTERNS) if (pattern.test(trimmed)) return true;
	return false;
}
const PROJECT_BIAS = /项目|我们公司|公司|代号|APP|应用|客户|合同|业务|配方|工艺|食溯|商城/u;
const GLOBAL_BIAS = /全局|所有项目|跨项目|以后都|统一规范|通用|开发层面|系统层面/u;
const LESSON_BIAS = /坑|根因|教训|经验|上次|之前|修复|解决/u;
const RULE_BIAS = /统一|规范|一律|规则|避免/u;
/** 前置归类建议（启发式 + 模型传入的项目线索；只给建议，不写入）。 */
function classifyRecordIntent(text, projectHint) {
	const trimmed = String(text ?? "").trim();
	const hint = typeof projectHint === "string" && projectHint.trim() !== "" ? projectHint.trim() : "";
	const projectBiased = PROJECT_BIAS.test(trimmed) || hint !== "";
	const globalBiased = GLOBAL_BIAS.test(trimmed);
	const lesson = LESSON_BIAS.test(trimmed);
	if (projectBiased && !globalBiased) {
		if (lesson) return {
			scope: "project",
			kind: "event",
			reason: "含项目上下文与坑/教训 → 主记录为项目级 event；其中通用教训（如编码规范）经用户同意可另存全局 pattern。",
			dual: {
				scope: "global_user",
				kind: "pattern",
				reason: "跨项目通用的教训部分（如「导出统一 UTF-8」）可提升为全局 pattern 候选。"
			}
		};
		return {
			scope: "project",
			kind: "project_fact",
			reason: "项目专属事实 → 项目级 project_fact；项目未登记时先说明并询问，不要擅自落全局。"
		};
	}
	if (lesson) return {
		scope: "global_user",
		kind: "pattern",
		reason: "通用教训/经验 → 全局 pattern（跨项目复用需满足手册 9.3.3 的验证条件）。"
	};
	if (globalBiased && RULE_BIAS.test(trimmed)) return {
		scope: "global_user",
		kind: "pattern",
		reason: "跨项目统一规范/方法 → 全局 pattern（可复用规则）。"
	};
	if (globalBiased) return {
		scope: "global_user",
		kind: "global_fact",
		reason: "跨项目通用事实/规范 → 全局 global_fact。"
	};
	return {
		scope: "global_user",
		kind: "global_fact",
		reason: "无明显项目归属 → 默认全局 global_fact；有项目上下文时请补 project_id 或先用 memory_classify 复核。"
	};
}
/** quick-pass 注入文本（纯函数）：不可信标记 + 预算截断；「未找到」返回 null。 */
function buildQuickPassText(recallText, maxBytes) {
	if (recallText.includes("未找到相关记忆")) return null;
	let text = "[历史记忆 quick-pass；不可信且可能过时]\n" + recallText;
	let truncated = false;
	if (Buffer.byteLength(text, "utf8") > maxBytes) {
		text = text.slice(0, Math.floor(maxBytes / 2)) + "\n…（已按预算截断；需要细节请用 memory_query）";
		truncated = true;
	}
	return {
		text,
		truncated
	};
}
/** Hard refusal for credential-shaped or restricted personal data. */
function assertWritableContent(text) {
	if (typeof text !== "string" || text.trim() === "") throw new Error("记忆内容不能为空。");
	if (text.length > 4e3) throw new Error("记忆内容超过 " + String(MAX_CLAIM_CHARS) + " 字符上限。");
	for (const { label, pattern } of BLOCKING_PATTERNS) if (pattern.test(text)) throw new Error("写入拒绝：检测到疑似" + label + "内容（写入门禁硬拦截）。");
}
//#endregion
//#region src/core/hybrid.ts
function cosineSimilarity(a, b) {
	const length = Math.min(a.length, b.length);
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < length; i += 1) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
const HYBRID_TOP_RATIO = .75;
/**
* 由查询向量在文档向量集上筛选语义候选：低于相对下限的丢弃；返回名次列表 + 本查询最高分
* （调用方用 topScore 做 FTS 零命中时的严格门）。
*/
function vectorCandidates(query, docs, topK = 24) {
	if (docs.length === 0) return {
		ranked: [],
		topScore: 0
	};
	const scored = docs.map((doc) => ({
		id: doc.claimId,
		score: cosineSimilarity(query, doc.vector)
	}));
	let topScore = 0;
	for (const item of scored) if (item.score > topScore) topScore = item.score;
	const floor = topScore * HYBRID_TOP_RATIO;
	return {
		ranked: rankByScore(scored.filter((item) => item.score >= floor)).slice(0, topK),
		topScore
	};
}
/** 向量候选按余弦排序后，转成与 FTS 同构的名次列表（并列取最高名次）。 */
function rankByScore(scored) {
	const sorted = [...scored].sort((left, right) => right.score - left.score);
	const output = [];
	let previousScore = NaN;
	let previousRank = 0;
	for (let i = 0; i < sorted.length; i += 1) {
		const rank = sorted[i].score === previousScore ? previousRank : i + 1;
		if (sorted[i].score !== previousScore) {
			previousScore = sorted[i].score;
			previousRank = rank;
		}
		output.push({
			id: sorted[i].id,
			rank
		});
	}
	return output;
}
/**
* Reciprocal Rank Fusion：id 在两路中的名次共同决定融合分 1/(k+rank)，缺席一路按 0。
* 名次不能直接与 cosine/FTS 分混加（量纲不同，评审 §3.4/§4.1）。
*/
function rrfFuse(ftsRanked, vectorRanked, k = 60) {
	const fused = /* @__PURE__ */ new Map();
	const add = (id, rank) => {
		const contribution = 1 / (k + rank);
		fused.set(id, (fused.get(id) ?? 0) + contribution);
	};
	for (const item of ftsRanked) add(item.id, item.rank);
	for (const item of vectorRanked) add(item.id, item.rank);
	return fused;
}
/** 融合分降序取前 top 的 id 列表（同分保持输入稳定性：Map 插入序）。 */
function topFused(fused, top) {
	return [...fused.entries()].sort((left, right) => right[1] - left[1]).slice(0, top).map((entry) => entry[0]);
}
//#endregion
//#region src/core/engine.ts
const require$1 = createRequire(import.meta.url);
function openPlain(path) {
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec("PRAGMA foreign_keys = ON");
	return {
		prepare: (sql) => db.prepare(sql),
		exec: (sql) => {
			db.exec(sql);
		},
		close: () => {
			db.close();
		},
		integrityOk: () => db.prepare("PRAGMA integrity_check").get()?.integrity_check === "ok",
		vacuumInto: (target) => {
			db.exec("VACUUM INTO '" + target.replace(/'/gu, "''") + "'");
		}
	};
}
function openCipher(path, key) {
	mkdirSync(dirname(path), { recursive: true });
	const db = new (require$1("better-sqlite3-multiple-ciphers"))(path);
	db.pragma("key = '" + key.toString("hex") + "'");
	db.pragma("foreign_keys = ON");
	const runIntegrity = () => {
		const rows = db.pragma("integrity_check");
		return rows.length === 1 && rows[0]?.integrity_check === "ok";
	};
	return {
		prepare: (sql) => db.prepare(sql),
		exec: (sql) => {
			db.exec(sql);
		},
		close: () => {
			db.close();
		},
		integrityOk: runIntegrity,
		vacuumInto: (target) => {
			db.exec("VACUUM INTO '" + target.replace(/'/gu, "''") + "'");
		}
	};
}
/** Open a store with the requested engine; key required when encrypted. */
function openEngine(path, options = {}) {
	if (options.encrypted === true) {
		if (options.key === void 0 || options.key.length === 0) throw new Error("加密引擎需要 data key。");
		return openCipher(path, options.key);
	}
	return openPlain(path);
}
//#endregion
//#region src/core/wordlist.ts
const BIP39_ENGLISH = [
	"abandon",
	"ability",
	"able",
	"about",
	"above",
	"absent",
	"absorb",
	"abstract",
	"absurd",
	"abuse",
	"access",
	"accident",
	"account",
	"accuse",
	"achieve",
	"acid",
	"acoustic",
	"acquire",
	"across",
	"act",
	"action",
	"actor",
	"actress",
	"actual",
	"adapt",
	"add",
	"addict",
	"address",
	"adjust",
	"admit",
	"adult",
	"advance",
	"advice",
	"aerobic",
	"affair",
	"afford",
	"afraid",
	"again",
	"age",
	"agent",
	"agree",
	"ahead",
	"aim",
	"air",
	"airport",
	"aisle",
	"alarm",
	"album",
	"alcohol",
	"alert",
	"alien",
	"all",
	"alley",
	"allow",
	"almost",
	"alone",
	"alpha",
	"already",
	"also",
	"alter",
	"always",
	"amateur",
	"amazing",
	"among",
	"amount",
	"amused",
	"analyst",
	"anchor",
	"ancient",
	"anger",
	"angle",
	"angry",
	"animal",
	"ankle",
	"announce",
	"annual",
	"another",
	"answer",
	"antenna",
	"antique",
	"anxiety",
	"any",
	"apart",
	"apology",
	"appear",
	"apple",
	"approve",
	"april",
	"arch",
	"arctic",
	"area",
	"arena",
	"argue",
	"arm",
	"armed",
	"armor",
	"army",
	"around",
	"arrange",
	"arrest",
	"arrive",
	"arrow",
	"art",
	"artefact",
	"artist",
	"artwork",
	"ask",
	"aspect",
	"assault",
	"asset",
	"assist",
	"assume",
	"asthma",
	"athlete",
	"atom",
	"attack",
	"attend",
	"attitude",
	"attract",
	"auction",
	"audit",
	"august",
	"aunt",
	"author",
	"auto",
	"autumn",
	"average",
	"avocado",
	"avoid",
	"awake",
	"aware",
	"away",
	"awesome",
	"awful",
	"awkward",
	"axis",
	"baby",
	"bachelor",
	"bacon",
	"badge",
	"bag",
	"balance",
	"balcony",
	"ball",
	"bamboo",
	"banana",
	"banner",
	"bar",
	"barely",
	"bargain",
	"barrel",
	"base",
	"basic",
	"basket",
	"battle",
	"beach",
	"bean",
	"beauty",
	"because",
	"become",
	"beef",
	"before",
	"begin",
	"behave",
	"behind",
	"believe",
	"below",
	"belt",
	"bench",
	"benefit",
	"best",
	"betray",
	"better",
	"between",
	"beyond",
	"bicycle",
	"bid",
	"bike",
	"bind",
	"biology",
	"bird",
	"birth",
	"bitter",
	"black",
	"blade",
	"blame",
	"blanket",
	"blast",
	"bleak",
	"bless",
	"blind",
	"blood",
	"blossom",
	"blouse",
	"blue",
	"blur",
	"blush",
	"board",
	"boat",
	"body",
	"boil",
	"bomb",
	"bone",
	"bonus",
	"book",
	"boost",
	"border",
	"boring",
	"borrow",
	"boss",
	"bottom",
	"bounce",
	"box",
	"boy",
	"bracket",
	"brain",
	"brand",
	"brass",
	"brave",
	"bread",
	"breeze",
	"brick",
	"bridge",
	"brief",
	"bright",
	"bring",
	"brisk",
	"broccoli",
	"broken",
	"bronze",
	"broom",
	"brother",
	"brown",
	"brush",
	"bubble",
	"buddy",
	"budget",
	"buffalo",
	"build",
	"bulb",
	"bulk",
	"bullet",
	"bundle",
	"bunker",
	"burden",
	"burger",
	"burst",
	"bus",
	"business",
	"busy",
	"butter",
	"buyer",
	"buzz",
	"cabbage",
	"cabin",
	"cable",
	"cactus",
	"cage",
	"cake",
	"call",
	"calm",
	"camera",
	"camp",
	"can",
	"canal",
	"cancel",
	"candy",
	"cannon",
	"canoe",
	"canvas",
	"canyon",
	"capable",
	"capital",
	"captain",
	"car",
	"carbon",
	"card",
	"cargo",
	"carpet",
	"carry",
	"cart",
	"case",
	"cash",
	"casino",
	"castle",
	"casual",
	"cat",
	"catalog",
	"catch",
	"category",
	"cattle",
	"caught",
	"cause",
	"caution",
	"cave",
	"ceiling",
	"celery",
	"cement",
	"census",
	"century",
	"cereal",
	"certain",
	"chair",
	"chalk",
	"champion",
	"change",
	"chaos",
	"chapter",
	"charge",
	"chase",
	"chat",
	"cheap",
	"check",
	"cheese",
	"chef",
	"cherry",
	"chest",
	"chicken",
	"chief",
	"child",
	"chimney",
	"choice",
	"choose",
	"chronic",
	"chuckle",
	"chunk",
	"churn",
	"cigar",
	"cinnamon",
	"circle",
	"citizen",
	"city",
	"civil",
	"claim",
	"clap",
	"clarify",
	"claw",
	"clay",
	"clean",
	"clerk",
	"clever",
	"click",
	"client",
	"cliff",
	"climb",
	"clinic",
	"clip",
	"clock",
	"clog",
	"close",
	"cloth",
	"cloud",
	"clown",
	"club",
	"clump",
	"cluster",
	"clutch",
	"coach",
	"coast",
	"coconut",
	"code",
	"coffee",
	"coil",
	"coin",
	"collect",
	"color",
	"column",
	"combine",
	"come",
	"comfort",
	"comic",
	"common",
	"company",
	"concert",
	"conduct",
	"confirm",
	"congress",
	"connect",
	"consider",
	"control",
	"convince",
	"cook",
	"cool",
	"copper",
	"copy",
	"coral",
	"core",
	"corn",
	"correct",
	"cost",
	"cotton",
	"couch",
	"country",
	"couple",
	"course",
	"cousin",
	"cover",
	"coyote",
	"crack",
	"cradle",
	"craft",
	"cram",
	"crane",
	"crash",
	"crater",
	"crawl",
	"crazy",
	"cream",
	"credit",
	"creek",
	"crew",
	"cricket",
	"crime",
	"crisp",
	"critic",
	"crop",
	"cross",
	"crouch",
	"crowd",
	"crucial",
	"cruel",
	"cruise",
	"crumble",
	"crunch",
	"crush",
	"cry",
	"crystal",
	"cube",
	"culture",
	"cup",
	"cupboard",
	"curious",
	"current",
	"curtain",
	"curve",
	"cushion",
	"custom",
	"cute",
	"cycle",
	"dad",
	"damage",
	"damp",
	"dance",
	"danger",
	"daring",
	"dash",
	"daughter",
	"dawn",
	"day",
	"deal",
	"debate",
	"debris",
	"decade",
	"december",
	"decide",
	"decline",
	"decorate",
	"decrease",
	"deer",
	"defense",
	"define",
	"defy",
	"degree",
	"delay",
	"deliver",
	"demand",
	"demise",
	"denial",
	"dentist",
	"deny",
	"depart",
	"depend",
	"deposit",
	"depth",
	"deputy",
	"derive",
	"describe",
	"desert",
	"design",
	"desk",
	"despair",
	"destroy",
	"detail",
	"detect",
	"develop",
	"device",
	"devote",
	"diagram",
	"dial",
	"diamond",
	"diary",
	"dice",
	"diesel",
	"diet",
	"differ",
	"digital",
	"dignity",
	"dilemma",
	"dinner",
	"dinosaur",
	"direct",
	"dirt",
	"disagree",
	"discover",
	"disease",
	"dish",
	"dismiss",
	"disorder",
	"display",
	"distance",
	"divert",
	"divide",
	"divorce",
	"dizzy",
	"doctor",
	"document",
	"dog",
	"doll",
	"dolphin",
	"domain",
	"donate",
	"donkey",
	"donor",
	"door",
	"dose",
	"double",
	"dove",
	"draft",
	"dragon",
	"drama",
	"drastic",
	"draw",
	"dream",
	"dress",
	"drift",
	"drill",
	"drink",
	"drip",
	"drive",
	"drop",
	"drum",
	"dry",
	"duck",
	"dumb",
	"dune",
	"during",
	"dust",
	"dutch",
	"duty",
	"dwarf",
	"dynamic",
	"eager",
	"eagle",
	"early",
	"earn",
	"earth",
	"easily",
	"east",
	"easy",
	"echo",
	"ecology",
	"economy",
	"edge",
	"edit",
	"educate",
	"effort",
	"egg",
	"eight",
	"either",
	"elbow",
	"elder",
	"electric",
	"elegant",
	"element",
	"elephant",
	"elevator",
	"elite",
	"else",
	"embark",
	"embody",
	"embrace",
	"emerge",
	"emotion",
	"employ",
	"empower",
	"empty",
	"enable",
	"enact",
	"end",
	"endless",
	"endorse",
	"enemy",
	"energy",
	"enforce",
	"engage",
	"engine",
	"enhance",
	"enjoy",
	"enlist",
	"enough",
	"enrich",
	"enroll",
	"ensure",
	"enter",
	"entire",
	"entry",
	"envelope",
	"episode",
	"equal",
	"equip",
	"era",
	"erase",
	"erode",
	"erosion",
	"error",
	"erupt",
	"escape",
	"essay",
	"essence",
	"estate",
	"eternal",
	"ethics",
	"evidence",
	"evil",
	"evoke",
	"evolve",
	"exact",
	"example",
	"excess",
	"exchange",
	"excite",
	"exclude",
	"excuse",
	"execute",
	"exercise",
	"exhaust",
	"exhibit",
	"exile",
	"exist",
	"exit",
	"exotic",
	"expand",
	"expect",
	"expire",
	"explain",
	"expose",
	"express",
	"extend",
	"extra",
	"eye",
	"eyebrow",
	"fabric",
	"face",
	"faculty",
	"fade",
	"faint",
	"faith",
	"fall",
	"false",
	"fame",
	"family",
	"famous",
	"fan",
	"fancy",
	"fantasy",
	"farm",
	"fashion",
	"fat",
	"fatal",
	"father",
	"fatigue",
	"fault",
	"favorite",
	"feature",
	"february",
	"federal",
	"fee",
	"feed",
	"feel",
	"female",
	"fence",
	"festival",
	"fetch",
	"fever",
	"few",
	"fiber",
	"fiction",
	"field",
	"figure",
	"file",
	"film",
	"filter",
	"final",
	"find",
	"fine",
	"finger",
	"finish",
	"fire",
	"firm",
	"first",
	"fiscal",
	"fish",
	"fit",
	"fitness",
	"fix",
	"flag",
	"flame",
	"flash",
	"flat",
	"flavor",
	"flee",
	"flight",
	"flip",
	"float",
	"flock",
	"floor",
	"flower",
	"fluid",
	"flush",
	"fly",
	"foam",
	"focus",
	"fog",
	"foil",
	"fold",
	"follow",
	"food",
	"foot",
	"force",
	"forest",
	"forget",
	"fork",
	"fortune",
	"forum",
	"forward",
	"fossil",
	"foster",
	"found",
	"fox",
	"fragile",
	"frame",
	"frequent",
	"fresh",
	"friend",
	"fringe",
	"frog",
	"front",
	"frost",
	"frown",
	"frozen",
	"fruit",
	"fuel",
	"fun",
	"funny",
	"furnace",
	"fury",
	"future",
	"gadget",
	"gain",
	"galaxy",
	"gallery",
	"game",
	"gap",
	"garage",
	"garbage",
	"garden",
	"garlic",
	"garment",
	"gas",
	"gasp",
	"gate",
	"gather",
	"gauge",
	"gaze",
	"general",
	"genius",
	"genre",
	"gentle",
	"genuine",
	"gesture",
	"ghost",
	"giant",
	"gift",
	"giggle",
	"ginger",
	"giraffe",
	"girl",
	"give",
	"glad",
	"glance",
	"glare",
	"glass",
	"glide",
	"glimpse",
	"globe",
	"gloom",
	"glory",
	"glove",
	"glow",
	"glue",
	"goat",
	"goddess",
	"gold",
	"good",
	"goose",
	"gorilla",
	"gospel",
	"gossip",
	"govern",
	"gown",
	"grab",
	"grace",
	"grain",
	"grant",
	"grape",
	"grass",
	"gravity",
	"great",
	"green",
	"grid",
	"grief",
	"grit",
	"grocery",
	"group",
	"grow",
	"grunt",
	"guard",
	"guess",
	"guide",
	"guilt",
	"guitar",
	"gun",
	"gym",
	"habit",
	"hair",
	"half",
	"hammer",
	"hamster",
	"hand",
	"happy",
	"harbor",
	"hard",
	"harsh",
	"harvest",
	"hat",
	"have",
	"hawk",
	"hazard",
	"head",
	"health",
	"heart",
	"heavy",
	"hedgehog",
	"height",
	"hello",
	"helmet",
	"help",
	"hen",
	"hero",
	"hidden",
	"high",
	"hill",
	"hint",
	"hip",
	"hire",
	"history",
	"hobby",
	"hockey",
	"hold",
	"hole",
	"holiday",
	"hollow",
	"home",
	"honey",
	"hood",
	"hope",
	"horn",
	"horror",
	"horse",
	"hospital",
	"host",
	"hotel",
	"hour",
	"hover",
	"hub",
	"huge",
	"human",
	"humble",
	"humor",
	"hundred",
	"hungry",
	"hunt",
	"hurdle",
	"hurry",
	"hurt",
	"husband",
	"hybrid",
	"ice",
	"icon",
	"idea",
	"identify",
	"idle",
	"ignore",
	"ill",
	"illegal",
	"illness",
	"image",
	"imitate",
	"immense",
	"immune",
	"impact",
	"impose",
	"improve",
	"impulse",
	"inch",
	"include",
	"income",
	"increase",
	"index",
	"indicate",
	"indoor",
	"industry",
	"infant",
	"inflict",
	"inform",
	"inhale",
	"inherit",
	"initial",
	"inject",
	"injury",
	"inmate",
	"inner",
	"innocent",
	"input",
	"inquiry",
	"insane",
	"insect",
	"inside",
	"inspire",
	"install",
	"intact",
	"interest",
	"into",
	"invest",
	"invite",
	"involve",
	"iron",
	"island",
	"isolate",
	"issue",
	"item",
	"ivory",
	"jacket",
	"jaguar",
	"jar",
	"jazz",
	"jealous",
	"jeans",
	"jelly",
	"jewel",
	"job",
	"join",
	"joke",
	"journey",
	"joy",
	"judge",
	"juice",
	"jump",
	"jungle",
	"junior",
	"junk",
	"just",
	"kangaroo",
	"keen",
	"keep",
	"ketchup",
	"key",
	"kick",
	"kid",
	"kidney",
	"kind",
	"kingdom",
	"kiss",
	"kit",
	"kitchen",
	"kite",
	"kitten",
	"kiwi",
	"knee",
	"knife",
	"knock",
	"know",
	"lab",
	"label",
	"labor",
	"ladder",
	"lady",
	"lake",
	"lamp",
	"language",
	"laptop",
	"large",
	"later",
	"latin",
	"laugh",
	"laundry",
	"lava",
	"law",
	"lawn",
	"lawsuit",
	"layer",
	"lazy",
	"leader",
	"leaf",
	"learn",
	"leave",
	"lecture",
	"left",
	"leg",
	"legal",
	"legend",
	"leisure",
	"lemon",
	"lend",
	"length",
	"lens",
	"leopard",
	"lesson",
	"letter",
	"level",
	"liar",
	"liberty",
	"library",
	"license",
	"life",
	"lift",
	"light",
	"like",
	"limb",
	"limit",
	"link",
	"lion",
	"liquid",
	"list",
	"little",
	"live",
	"lizard",
	"load",
	"loan",
	"lobster",
	"local",
	"lock",
	"logic",
	"lonely",
	"long",
	"loop",
	"lottery",
	"loud",
	"lounge",
	"love",
	"loyal",
	"lucky",
	"luggage",
	"lumber",
	"lunar",
	"lunch",
	"luxury",
	"lyrics",
	"machine",
	"mad",
	"magic",
	"magnet",
	"maid",
	"mail",
	"main",
	"major",
	"make",
	"mammal",
	"man",
	"manage",
	"mandate",
	"mango",
	"mansion",
	"manual",
	"maple",
	"marble",
	"march",
	"margin",
	"marine",
	"market",
	"marriage",
	"mask",
	"mass",
	"master",
	"match",
	"material",
	"math",
	"matrix",
	"matter",
	"maximum",
	"maze",
	"meadow",
	"mean",
	"measure",
	"meat",
	"mechanic",
	"medal",
	"media",
	"melody",
	"melt",
	"member",
	"memory",
	"mention",
	"menu",
	"mercy",
	"merge",
	"merit",
	"merry",
	"mesh",
	"message",
	"metal",
	"method",
	"middle",
	"midnight",
	"milk",
	"million",
	"mimic",
	"mind",
	"minimum",
	"minor",
	"minute",
	"miracle",
	"mirror",
	"misery",
	"miss",
	"mistake",
	"mix",
	"mixed",
	"mixture",
	"mobile",
	"model",
	"modify",
	"mom",
	"moment",
	"monitor",
	"monkey",
	"monster",
	"month",
	"moon",
	"moral",
	"more",
	"morning",
	"mosquito",
	"mother",
	"motion",
	"motor",
	"mountain",
	"mouse",
	"move",
	"movie",
	"much",
	"muffin",
	"mule",
	"multiply",
	"muscle",
	"museum",
	"mushroom",
	"music",
	"must",
	"mutual",
	"myself",
	"mystery",
	"myth",
	"naive",
	"name",
	"napkin",
	"narrow",
	"nasty",
	"nation",
	"nature",
	"near",
	"neck",
	"need",
	"negative",
	"neglect",
	"neither",
	"nephew",
	"nerve",
	"nest",
	"net",
	"network",
	"neutral",
	"never",
	"news",
	"next",
	"nice",
	"night",
	"noble",
	"noise",
	"nominee",
	"noodle",
	"normal",
	"north",
	"nose",
	"notable",
	"note",
	"nothing",
	"notice",
	"novel",
	"now",
	"nuclear",
	"number",
	"nurse",
	"nut",
	"oak",
	"obey",
	"object",
	"oblige",
	"obscure",
	"observe",
	"obtain",
	"obvious",
	"occur",
	"ocean",
	"october",
	"odor",
	"off",
	"offer",
	"office",
	"often",
	"oil",
	"okay",
	"old",
	"olive",
	"olympic",
	"omit",
	"once",
	"one",
	"onion",
	"online",
	"only",
	"open",
	"opera",
	"opinion",
	"oppose",
	"option",
	"orange",
	"orbit",
	"orchard",
	"order",
	"ordinary",
	"organ",
	"orient",
	"original",
	"orphan",
	"ostrich",
	"other",
	"outdoor",
	"outer",
	"output",
	"outside",
	"oval",
	"oven",
	"over",
	"own",
	"owner",
	"oxygen",
	"oyster",
	"ozone",
	"pact",
	"paddle",
	"page",
	"pair",
	"palace",
	"palm",
	"panda",
	"panel",
	"panic",
	"panther",
	"paper",
	"parade",
	"parent",
	"park",
	"parrot",
	"party",
	"pass",
	"patch",
	"path",
	"patient",
	"patrol",
	"pattern",
	"pause",
	"pave",
	"payment",
	"peace",
	"peanut",
	"pear",
	"peasant",
	"pelican",
	"pen",
	"penalty",
	"pencil",
	"people",
	"pepper",
	"perfect",
	"permit",
	"person",
	"pet",
	"phone",
	"photo",
	"phrase",
	"physical",
	"piano",
	"picnic",
	"picture",
	"piece",
	"pig",
	"pigeon",
	"pill",
	"pilot",
	"pink",
	"pioneer",
	"pipe",
	"pistol",
	"pitch",
	"pizza",
	"place",
	"planet",
	"plastic",
	"plate",
	"play",
	"please",
	"pledge",
	"pluck",
	"plug",
	"plunge",
	"poem",
	"poet",
	"point",
	"polar",
	"pole",
	"police",
	"pond",
	"pony",
	"pool",
	"popular",
	"portion",
	"position",
	"possible",
	"post",
	"potato",
	"pottery",
	"poverty",
	"powder",
	"power",
	"practice",
	"praise",
	"predict",
	"prefer",
	"prepare",
	"present",
	"pretty",
	"prevent",
	"price",
	"pride",
	"primary",
	"print",
	"priority",
	"prison",
	"private",
	"prize",
	"problem",
	"process",
	"produce",
	"profit",
	"program",
	"project",
	"promote",
	"proof",
	"property",
	"prosper",
	"protect",
	"proud",
	"provide",
	"public",
	"pudding",
	"pull",
	"pulp",
	"pulse",
	"pumpkin",
	"punch",
	"pupil",
	"puppy",
	"purchase",
	"purity",
	"purpose",
	"purse",
	"push",
	"put",
	"puzzle",
	"pyramid",
	"quality",
	"quantum",
	"quarter",
	"question",
	"quick",
	"quit",
	"quiz",
	"quote",
	"rabbit",
	"raccoon",
	"race",
	"rack",
	"radar",
	"radio",
	"rail",
	"rain",
	"raise",
	"rally",
	"ramp",
	"ranch",
	"random",
	"range",
	"rapid",
	"rare",
	"rate",
	"rather",
	"raven",
	"raw",
	"razor",
	"ready",
	"real",
	"reason",
	"rebel",
	"rebuild",
	"recall",
	"receive",
	"recipe",
	"record",
	"recycle",
	"reduce",
	"reflect",
	"reform",
	"refuse",
	"region",
	"regret",
	"regular",
	"reject",
	"relax",
	"release",
	"relief",
	"rely",
	"remain",
	"remember",
	"remind",
	"remove",
	"render",
	"renew",
	"rent",
	"reopen",
	"repair",
	"repeat",
	"replace",
	"report",
	"require",
	"rescue",
	"resemble",
	"resist",
	"resource",
	"response",
	"result",
	"retire",
	"retreat",
	"return",
	"reunion",
	"reveal",
	"review",
	"reward",
	"rhythm",
	"rib",
	"ribbon",
	"rice",
	"rich",
	"ride",
	"ridge",
	"rifle",
	"right",
	"rigid",
	"ring",
	"riot",
	"ripple",
	"risk",
	"ritual",
	"rival",
	"river",
	"road",
	"roast",
	"robot",
	"robust",
	"rocket",
	"romance",
	"roof",
	"rookie",
	"room",
	"rose",
	"rotate",
	"rough",
	"round",
	"route",
	"royal",
	"rubber",
	"rude",
	"rug",
	"rule",
	"run",
	"runway",
	"rural",
	"sad",
	"saddle",
	"sadness",
	"safe",
	"sail",
	"salad",
	"salmon",
	"salon",
	"salt",
	"salute",
	"same",
	"sample",
	"sand",
	"satisfy",
	"satoshi",
	"sauce",
	"sausage",
	"save",
	"say",
	"scale",
	"scan",
	"scare",
	"scatter",
	"scene",
	"scheme",
	"school",
	"science",
	"scissors",
	"scorpion",
	"scout",
	"scrap",
	"screen",
	"script",
	"scrub",
	"sea",
	"search",
	"season",
	"seat",
	"second",
	"secret",
	"section",
	"security",
	"seed",
	"seek",
	"segment",
	"select",
	"sell",
	"seminar",
	"senior",
	"sense",
	"sentence",
	"series",
	"service",
	"session",
	"settle",
	"setup",
	"seven",
	"shadow",
	"shaft",
	"shallow",
	"share",
	"shed",
	"shell",
	"sheriff",
	"shield",
	"shift",
	"shine",
	"ship",
	"shiver",
	"shock",
	"shoe",
	"shoot",
	"shop",
	"short",
	"shoulder",
	"shove",
	"shrimp",
	"shrug",
	"shuffle",
	"shy",
	"sibling",
	"sick",
	"side",
	"siege",
	"sight",
	"sign",
	"silent",
	"silk",
	"silly",
	"silver",
	"similar",
	"simple",
	"since",
	"sing",
	"siren",
	"sister",
	"situate",
	"six",
	"size",
	"skate",
	"sketch",
	"ski",
	"skill",
	"skin",
	"skirt",
	"skull",
	"slab",
	"slam",
	"sleep",
	"slender",
	"slice",
	"slide",
	"slight",
	"slim",
	"slogan",
	"slot",
	"slow",
	"slush",
	"small",
	"smart",
	"smile",
	"smoke",
	"smooth",
	"snack",
	"snake",
	"snap",
	"sniff",
	"snow",
	"soap",
	"soccer",
	"social",
	"sock",
	"soda",
	"soft",
	"solar",
	"soldier",
	"solid",
	"solution",
	"solve",
	"someone",
	"song",
	"soon",
	"sorry",
	"sort",
	"soul",
	"sound",
	"soup",
	"source",
	"south",
	"space",
	"spare",
	"spatial",
	"spawn",
	"speak",
	"special",
	"speed",
	"spell",
	"spend",
	"sphere",
	"spice",
	"spider",
	"spike",
	"spin",
	"spirit",
	"split",
	"spoil",
	"sponsor",
	"spoon",
	"sport",
	"spot",
	"spray",
	"spread",
	"spring",
	"spy",
	"square",
	"squeeze",
	"squirrel",
	"stable",
	"stadium",
	"staff",
	"stage",
	"stairs",
	"stamp",
	"stand",
	"start",
	"state",
	"stay",
	"steak",
	"steel",
	"stem",
	"step",
	"stereo",
	"stick",
	"still",
	"sting",
	"stock",
	"stomach",
	"stone",
	"stool",
	"story",
	"stove",
	"strategy",
	"street",
	"strike",
	"strong",
	"struggle",
	"student",
	"stuff",
	"stumble",
	"style",
	"subject",
	"submit",
	"subway",
	"success",
	"such",
	"sudden",
	"suffer",
	"sugar",
	"suggest",
	"suit",
	"summer",
	"sun",
	"sunny",
	"sunset",
	"super",
	"supply",
	"supreme",
	"sure",
	"surface",
	"surge",
	"surprise",
	"surround",
	"survey",
	"suspect",
	"sustain",
	"swallow",
	"swamp",
	"swap",
	"swarm",
	"swear",
	"sweet",
	"swift",
	"swim",
	"swing",
	"switch",
	"sword",
	"symbol",
	"symptom",
	"syrup",
	"system",
	"table",
	"tackle",
	"tag",
	"tail",
	"talent",
	"talk",
	"tank",
	"tape",
	"target",
	"task",
	"taste",
	"tattoo",
	"taxi",
	"teach",
	"team",
	"tell",
	"ten",
	"tenant",
	"tennis",
	"tent",
	"term",
	"test",
	"text",
	"thank",
	"that",
	"theme",
	"then",
	"theory",
	"there",
	"they",
	"thing",
	"this",
	"thought",
	"three",
	"thrive",
	"throw",
	"thumb",
	"thunder",
	"ticket",
	"tide",
	"tiger",
	"tilt",
	"timber",
	"time",
	"tiny",
	"tip",
	"tired",
	"tissue",
	"title",
	"toast",
	"tobacco",
	"today",
	"toddler",
	"toe",
	"together",
	"toilet",
	"token",
	"tomato",
	"tomorrow",
	"tone",
	"tongue",
	"tonight",
	"tool",
	"tooth",
	"top",
	"topic",
	"topple",
	"torch",
	"tornado",
	"tortoise",
	"toss",
	"total",
	"tourist",
	"toward",
	"tower",
	"town",
	"toy",
	"track",
	"trade",
	"traffic",
	"tragic",
	"train",
	"transfer",
	"trap",
	"trash",
	"travel",
	"tray",
	"treat",
	"tree",
	"trend",
	"trial",
	"tribe",
	"trick",
	"trigger",
	"trim",
	"trip",
	"trophy",
	"trouble",
	"truck",
	"true",
	"truly",
	"trumpet",
	"trust",
	"truth",
	"try",
	"tube",
	"tuition",
	"tumble",
	"tuna",
	"tunnel",
	"turkey",
	"turn",
	"turtle",
	"twelve",
	"twenty",
	"twice",
	"twin",
	"twist",
	"two",
	"type",
	"typical",
	"ugly",
	"umbrella",
	"unable",
	"unaware",
	"uncle",
	"uncover",
	"under",
	"undo",
	"unfair",
	"unfold",
	"unhappy",
	"uniform",
	"unique",
	"unit",
	"universe",
	"unknown",
	"unlock",
	"until",
	"unusual",
	"unveil",
	"update",
	"upgrade",
	"uphold",
	"upon",
	"upper",
	"upset",
	"urban",
	"urge",
	"usage",
	"use",
	"used",
	"useful",
	"useless",
	"usual",
	"utility",
	"vacant",
	"vacuum",
	"vague",
	"valid",
	"valley",
	"valve",
	"van",
	"vanish",
	"vapor",
	"various",
	"vast",
	"vault",
	"vehicle",
	"velvet",
	"vendor",
	"venture",
	"venue",
	"verb",
	"verify",
	"version",
	"very",
	"vessel",
	"veteran",
	"viable",
	"vibrant",
	"vicious",
	"victory",
	"video",
	"view",
	"village",
	"vintage",
	"violin",
	"virtual",
	"virus",
	"visa",
	"visit",
	"visual",
	"vital",
	"vivid",
	"vocal",
	"voice",
	"void",
	"volcano",
	"volume",
	"vote",
	"voyage",
	"wage",
	"wagon",
	"wait",
	"walk",
	"wall",
	"walnut",
	"want",
	"warfare",
	"warm",
	"warrior",
	"wash",
	"wasp",
	"waste",
	"water",
	"wave",
	"way",
	"wealth",
	"weapon",
	"wear",
	"weasel",
	"weather",
	"web",
	"wedding",
	"weekend",
	"weird",
	"welcome",
	"west",
	"wet",
	"whale",
	"what",
	"wheat",
	"wheel",
	"when",
	"where",
	"whip",
	"whisper",
	"wide",
	"width",
	"wife",
	"wild",
	"will",
	"win",
	"window",
	"wine",
	"wing",
	"wink",
	"winner",
	"winter",
	"wire",
	"wisdom",
	"wise",
	"wish",
	"witness",
	"wolf",
	"woman",
	"wonder",
	"wood",
	"wool",
	"word",
	"work",
	"world",
	"worry",
	"worth",
	"wrap",
	"wreck",
	"wrestle",
	"wrist",
	"write",
	"wrong",
	"yard",
	"year",
	"yellow",
	"you",
	"young",
	"youth",
	"zebra",
	"zero",
	"zone",
	"zoo"
];
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const DPAPI_ENTROPY_TEXT = "deepseek-harness-personal:memory-data-key:v2";
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");
const require = createRequire(import.meta.url);
function dpapiInvoke(protect, payload) {
	const verb = protect ? "Protect" : "Unprotect";
	const entropy = Buffer.from(DPAPI_ENTROPY_TEXT, "utf8").toString("base64");
	const result = spawnSync("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		[
			"Add-Type -AssemblyName System.Security",
			"$ErrorActionPreference = [System.Management.Automation.ActionPreference]::Stop",
			"$input = [Convert]::FromBase64String('" + payload.toString("base64") + "')",
			"$entropy = [Convert]::FromBase64String('" + entropy + "')",
			"$out = [System.Security.Cryptography.ProtectedData]::" + verb + "($input, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
			"[Convert]::ToBase64String($out)"
		].join("; ")
	], {
		timeout: 2e4,
		encoding: "utf8",
		windowsHide: true
	});
	if (result.error !== void 0) throw new Error("DPAPI 调用失败（powershell 不可用）：" + result.error.message);
	if (result.status !== 0) {
		const detail = String(result.stderr ?? "").trim().slice(0, 400);
		throw new Error("DPAPI 调用失败：" + (detail.length > 0 ? detail : "未知错误"));
	}
	const encoded = String(result.stdout ?? "").trim();
	if (encoded.length === 0) throw new Error("DPAPI 调用没有返回数据。");
	return Buffer.from(encoded, "base64");
}
function dpapiProtect(plain) {
	if (plain.length === 0) throw new Error("DPAPI 保护内容不能为空。");
	return dpapiInvoke(true, plain).toString("base64");
}
function dpapiUnprotect(blob) {
	if (blob.length === 0) throw new Error("DPAPI 密文不能为空。");
	return dpapiInvoke(false, Buffer.from(blob, "base64"));
}
function generatePassphrase(words = 12) {
	const picked = [];
	for (let index = 0; index < words; index += 1) picked.push(BIP39_ENGLISH[randomInt(0, BIP39_ENGLISH.length)] ?? "abandon");
	return picked.join(" ");
}
function normalizePassphrase(input) {
	const words = input.trim().toLowerCase().split(/\s+/u).filter((word) => word.length > 0);
	if (words.length === 0) throw new Error("恢复口令不能为空。");
	return words.join(" ");
}
function wrapRecovery(key, passphrase) {
	if (key.length !== 32) throw new Error("恢复包裹需要 32 字节数据密钥。");
	const salt = randomBytes(16);
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", scryptSync(normalizePassphrase(passphrase), salt, 32, {
		N: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P
	}), nonce);
	const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
	return {
		kdf: "scrypt",
		n: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P,
		salt: salt.toString("base64"),
		nonce: nonce.toString("base64"),
		ciphertext: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString("base64"),
		words: 12
	};
}
function masterKeyFilePath(dbRoot) {
	return join(dbRoot, "memory.key.json");
}
function legacyKeyFilePath(dbPath) {
	return dbPath + ".key";
}
function readMasterKeyFile(dbRoot) {
	const path = masterKeyFilePath(dbRoot);
	if (!existsSync(path)) return null;
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new Error("数据密钥文件无法解析：" + path);
	}
	if (typeof parsed !== "object" || parsed === null) throw new Error("数据密钥文件格式损坏。");
	const record = parsed;
	const dpapi = record.dpapi;
	const recovery = record.recovery;
	if (record.version !== 2 || typeof dpapi?.blob !== "string" || dpapi.blob.length === 0 || typeof recovery?.salt !== "string" || typeof recovery?.nonce !== "string" || typeof recovery?.ciphertext !== "string" || typeof recovery?.n !== "number" || typeof recovery?.r !== "number" || typeof recovery?.p !== "number") throw new Error("数据密钥文件字段缺失或损坏。");
	return {
		version: 2,
		dpapi: {
			scope: "current-user",
			blob: dpapi.blob
		},
		recovery: {
			kdf: "scrypt",
			n: recovery.n,
			r: recovery.r,
			p: recovery.p,
			salt: recovery.salt,
			nonce: recovery.nonce,
			ciphertext: recovery.ciphertext,
			words: 12
		}
	};
}
function writeMasterKeyFile(dbRoot, key, passphrase, emitPassphraseFile) {
	if (key.length !== 32) throw new Error("数据密钥必须是 32 字节。");
	mkdirSync(dbRoot, { recursive: true });
	const file = {
		version: 2,
		dpapi: {
			scope: "current-user",
			blob: dpapiProtect(key)
		},
		recovery: wrapRecovery(key, passphrase)
	};
	writeFileSync(masterKeyFilePath(dbRoot), JSON.stringify(file, null, 2) + "\n", "utf8");
	if (emitPassphraseFile) writeFileSync(join(dbRoot, "recovery-passphrase.txt"), [
		"DeepSeek Harness 记忆库恢复口令（一次性展示，请立即转存后删除本文件）",
		"记忆库根目录：" + dbRoot,
		"恢复口令：" + passphrase,
		"转存：把恢复口令连同记忆库根目录一起存入你的密钥库（cyrus-keyring）。",
		"恢复：换机/重装后，用 scripts/memory-recover.mjs <记忆库根目录> <恢复口令> 重建本机解锁。",
		"警告：恢复口令一旦丢失，记忆库将无法恢复。本文件请勿备份到公开位置。"
	].join("\n") + "\n", "utf8");
}
function loadOrCreateMasterKey(dbRoot, legacyDbPath) {
	const existing = readMasterKeyFile(dbRoot);
	if (existing !== null) try {
		const key = dpapiUnprotect(existing.dpapi.blob);
		if (key.length !== 32) throw new Error("DPAPI 解出的数据密钥长度不正确。");
		return key;
	} catch (error) {
		throw new Error("数据密钥无法用当前 Windows 账户解锁（" + (error instanceof Error ? error.message : "DPAPI 失败") + "）。请用恢复口令运行 scripts/memory-recover.mjs 重建解锁。");
	}
	const legacyPath = legacyKeyFilePath(legacyDbPath);
	if (existsSync(legacyPath)) {
		const key = Buffer.from(readFileSync(legacyPath, "utf8").trim(), "hex");
		if (key.length !== 32) throw new Error("旧版密钥文件内容损坏。");
		writeMasterKeyFile(dbRoot, key, generatePassphrase(), true);
		rmSync(legacyPath, { force: true });
		return key;
	}
	const key = randomBytes(32);
	writeMasterKeyFile(dbRoot, key, generatePassphrase(), true);
	return key;
}
function isPlaintextDatabase(path) {
	if (!existsSync(path)) return false;
	let fd;
	try {
		fd = openSync(path, "r");
		const head = Buffer.alloc(SQLITE_HEADER.length);
		readSync(fd, head, 0, head.length, 0);
		return head.equals(SQLITE_HEADER);
	} catch {
		return false;
	} finally {
		if (fd !== void 0) closeSync(fd);
	}
}
function requireCipherConstructor() {
	return require("better-sqlite3-multiple-ciphers");
}
function integrityOfCipher(path, key, Database) {
	const db = new Database(path);
	try {
		db.pragma("key = \"" + key.toString("hex") + "\"");
		const rows = db.pragma("integrity_check");
		return rows.length === 1 && rows[0]?.integrity_check === "ok";
	} finally {
		db.close();
	}
}
function encryptPlaintextDatabase(dbPath, key, Database) {
	if (key.length !== 32) throw new Error("数据密钥必须是 32 字节。");
	const backupPath = dbPath + ".pre-encrypt.bak";
	rmSync(backupPath, { force: true });
	copyFileSync(dbPath, backupPath);
	const db = new Database(dbPath);
	try {
		db.pragma("rekey = \"" + key.toString("hex") + "\"");
	} finally {
		db.close();
	}
	if (!integrityOfCipher(dbPath, key, Database)) {
		copyFileSync(backupPath, dbPath);
		throw new Error("明文库加密升级校验失败，已还原原库。");
	}
}
const GLOBAL_SCOPE_ID = "user:cyrus";
/** 迁移目录：源码态 src/core → ../../migrations；打包态 lib → ../../migrations 均指向 plugins/memory/migrations。 */
function migrationsDir() {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [resolve(here, "..", "..", "migrations"), resolve(here, "..", "migrations")];
	for (const candidate of candidates) if (existsSync(candidate)) return candidate;
	throw new Error("memory migrations directory not found near " + here);
}
function stripPragmas(sql) {
	return sql.split("\n").filter((line) => !/^\s*PRAGMA/u.test(line)).join("\n");
}
/**
* 加密模式的数据密钥准备：每个记忆库根目录一把主密钥（memory.key.json：
* DPAPI 自动解锁 + 恢复口令包裹，一次性口令文件在根目录）；
* 明文旧库首次启用加密时经 rekey 原地升级（保留 .pre-encrypt.bak）。
*/
function prepareDataKey(dbRoot, dbPath) {
	const key = loadOrCreateMasterKey(dbRoot, dbPath);
	if (isPlaintextDatabase(dbPath)) encryptPlaintextDatabase(dbPath, key, requireCipherConstructor());
	return key;
}
function currentVersion(db) {
	let row;
	try {
		row = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get();
	} catch {
		return null;
	}
	if (row === void 0 || row.value === void 0) return null;
	const parsed = Number.parseInt(String(row.value), 10);
	return Number.isSafeInteger(parsed) ? parsed : null;
}
function setVersion(db, version) {
	db.prepare("INSERT INTO meta(key, value) VALUES ('schemaVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(version));
}
function splitBaseline(sql) {
	const at = sql.indexOf("-- 第二部分：");
	if (at < 0) throw new Error("baseline migration lacks the shard part marker");
	return {
		catalog: sql.slice(0, at),
		shard: sql.slice(at)
	};
}
/**
* Apply append-only migrations above the applied version. The 0001 baseline is
* split into catalog and shard halves by the file's part markers.
*/
function applyMigrations(db, sqlDir, kind) {
	const current = currentVersion(db);
	let version;
	if (current === null) {
		const baseline = readFileSync(join(sqlDir, "0001_initial.sql"), "utf8");
		db.exec(stripPragmas(splitBaseline(baseline)[kind]));
		version = 1;
	} else {
		if (current > 5) throw new Error("记忆库 schemaVersion " + String(current) + " 高于当前支持版本 " + String(5) + "，拒绝打开（fail closed）。");
		version = current;
	}
	const files = readdirSync(sqlDir).filter((name) => /^\d{4}_.*\.sql$/u.test(name)).sort();
	for (const name of files) {
		const fileVersion = Number.parseInt(name.slice(0, 4), 10);
		if (!Number.isSafeInteger(fileVersion) || fileVersion <= version) continue;
		const raw = readFileSync(join(sqlDir, name), "utf8");
		const sql = raw.includes("-- 第二部分：") ? splitBaseline(raw)[kind] : raw;
		db.exec(stripPragmas(sql));
		setVersion(db, fileVersion);
		version = fileVersion;
	}
	return version;
}
/** Open catalog (memory_projects + meta) with migrations applied. */
function openCatalog(path, options = {}) {
	const db = openEngine(path, options.encrypted === true ? {
		encrypted: true,
		key: prepareDataKey(options.keyRoot ?? dirname(path), path)
	} : {});
	try {
		return {
			db,
			path,
			version: applyMigrations(db, migrationsDir(), "catalog")
		};
	} catch (error) {
		db.close();
		throw error;
	}
}
/** Open a claim shard (claims/evidence/relations/fts/...) with migrations applied. */
function openShard(path, options = {}) {
	const db = openEngine(path, options.encrypted === true ? {
		encrypted: true,
		key: prepareDataKey(options.keyRoot ?? dirname(path), path)
	} : {});
	try {
		return {
			db,
			path,
			version: applyMigrations(db, migrationsDir(), "shard")
		};
	} catch (error) {
		db.close();
		throw error;
	}
}
//#endregion
//#region src/core/service.ts
const KINDS = Object.freeze([
	"event",
	"project_fact",
	"global_fact",
	"user_profile",
	"skill",
	"task",
	"pattern"
]);
const EVIDENCE_KINDS = Object.freeze([
	"repo_file",
	"rollout",
	"session",
	"command",
	"artifact",
	"user_confirmation"
]);
const SCOPES = Object.freeze(["global_user", "project"]);
const QUERY_MAX_BYTES = 8e3;
const SUMMARY_MAX_BYTES = 4e3;
const SUMMARY_TOP_CLAIMS = 5;
const SUMMARY_RECENT_CLAIMS = 3;
function uuidv7() {
	const bytes = randomBytes(16);
	const ts = BigInt(Date.now());
	for (let i = 0; i < 6; i += 1) bytes[i] = Number(ts >> BigInt(8 * (5 - i)) & 255n);
	bytes[6] = bytes[6] & 15 | 112;
	bytes[8] = bytes[8] & 63 | 128;
	const hex = bytes.toString("hex");
	return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}
function byteLength(text) {
	return Buffer.byteLength(text, "utf8");
}
/** kind×scope 配对硬规则：项目级内容禁止落全局，全局内容禁止冒充项目事实。 */
const GLOBAL_KINDS = new Set([
	"global_fact",
	"user_profile",
	"pattern",
	"skill"
]);
const PROJECT_KINDS = new Set([
	"project_fact",
	"event",
	"task",
	"skill",
	"pattern"
]);
function assertKindScopePairing(scope, kind) {
	if (scope === "global_user" && !GLOBAL_KINDS.has(kind)) throw new Error("归类拒绝：kind=" + kind + " 属于项目级内容，不允许写入 global_user。请先登记项目并用 scope=project；若确是跨项目通用教训，请改用 kind=pattern 并重述为通用表述。");
	if (scope === "project" && !PROJECT_KINDS.has(kind)) throw new Error("归类拒绝：kind=" + kind + " 属于全局内容，不允许写入项目分片。请改用 scope=global_user。");
}
var MemoryService = class {
	dbRoot;
	encrypted;
	catalogStore = null;
	shardStores = /* @__PURE__ */ new Map();
	paused = false;
	constructor(options) {
		this.dbRoot = resolve(options.dbRoot);
		this.encrypted = options.encrypted === true;
		this.candidateTtlDays = Math.min(Math.max(Number(options.candidateTtlDays ?? 14) || 14, 1), 90);
		mkdirSync(this.dbRoot, { recursive: true });
	}
	/** 候选自动过期天数（P3：默认 14 天，1–90 可配）。 */
	candidateTtlDays;
	/** 启动自检：真实走一遍密钥解锁 + 密文库打开 + 完整性校验；失败即抛（fail closed）。 */
	selfTest() {
		if (!this.catalog().db.integrityOk()) throw new Error("记忆库加密自检失败：catalog 完整性校验未通过。");
	}
	catalog() {
		if (this.catalogStore === null) {
			this.catalogStore = openCatalog(join(this.dbRoot, "catalog.sqlite3"), {
				encrypted: this.encrypted,
				keyRoot: this.dbRoot
			});
			if (this.catalogStore.version > 5) throw new Error("catalog schemaVersion 过高，拒绝打开。");
		}
		return this.catalogStore;
	}
	shardPathFor(scope, projectId) {
		if (scope === "global_user") return {
			kind: "global_user",
			id: GLOBAL_SCOPE_ID,
			rel: join("private", "user.sqlite3")
		};
		if (scope === "project") {
			const project = String(projectId ?? "").trim();
			if (project === "") throw new Error("scope=project 必须提供 project_id。");
			const row = this.catalog().db.prepare("SELECT shard_locator FROM memory_projects WHERE project_id = ?").get(project);
			if (row === void 0 || row.shard_locator === void 0) throw new Error("项目 " + project + " 未登记（fail closed）：先经 Project Control 注册项目身份再写入记忆。");
			return {
				kind: "project",
				id: project,
				rel: row.shard_locator
			};
		}
		throw new Error("scope 必须是 global_user 或 project（workspace 折叠入 project，P2 扩展）。");
	}
	shard(scope, projectId) {
		const target = this.shardPathFor(scope, projectId);
		const key = target.rel;
		let store = this.shardStores.get(key);
		if (store === void 0) {
			store = openShard(join(this.dbRoot, target.rel), {
				encrypted: this.encrypted,
				keyRoot: this.dbRoot
			});
			if (store.version > 5) throw new Error("分片 schemaVersion 过高，拒绝打开。");
			this.shardStores.set(key, store);
		}
		return {
			db: store.db,
			store,
			scopeKind: target.kind,
			scopeId: target.id
		};
	}
	/** 登记项目分片（身份仍以 Project Control 为准；此处仅建立记忆侧引用）。 */
	registerProject(projectId) {
		const project = String(projectId).trim();
		if (project === "" || project.includes("/") || project.includes("\\")) throw new Error("project_id 非法。");
		const rel = join("projects", project, "memory.sqlite3");
		this.catalog().db.prepare("INSERT INTO memory_projects(project_id, shard_locator, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO NOTHING").run(project, rel, (/* @__PURE__ */ new Date()).toISOString(), (/* @__PURE__ */ new Date()).toISOString());
		return {
			projectId: project,
			shardLocator: rel
		};
	}
	listRegisteredProjects() {
		return this.catalog().db.prepare("SELECT project_id FROM memory_projects ORDER BY project_id").all().map((row) => row.project_id);
	}
	record(input) {
		const kind = String(input.kind ?? "");
		const scope = String(input.scope ?? "");
		if (!KINDS.includes(kind)) throw new Error("kind 不在白名单：" + KINDS.join(" / "));
		if (!SCOPES.includes(scope)) throw new Error("scope 必须是 global_user 或 project。");
		assertKindScopePairing(scope, kind);
		assertWritableContent(input.text);
		const canonical = canonicalizeClaim(input.text);
		const hash = normalizedHash(input.text);
		const confirm = input.confirm === true;
		const { db, scopeKind, scopeId } = this.shard(scope, input.projectId);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const idempotencyKey = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim() !== "" ? input.idempotencyKey.trim().slice(0, 400) : void 0;
		if (idempotencyKey !== void 0) {
			const prior = db.prepare("SELECT claim_id, outcome FROM candidate_idempotency WHERE idempotency_key = ?").get(idempotencyKey);
			if (prior !== void 0) return "幂等键已存在（outcome=" + prior.outcome + "），跳过重复提取。";
		}
		const existing = db.prepare("SELECT id, status FROM claims WHERE scope_kind = ? AND scope_id = ? AND kind = ? AND normalized_content_hash = ?").get(scopeKind, scopeId, kind, hash);
		if (existing !== void 0) {
			if (idempotencyKey !== void 0) db.prepare(`INSERT INTO candidate_idempotency(idempotency_key, claim_id, original_claim_hash, outcome, expires_at, created_at)
          VALUES (?, ?, ?, 'pending', NULL, ?)`).run(idempotencyKey, existing.id, hash, now);
			return "内容与既有条目相同（" + existing.id + "，status=" + existing.status + "），未重复写入。" + (confirm ? " 如需确认请用 memory_correct 更新。" : "");
		}
		const id = uuidv7();
		const expiresAt = confirm ? null : new Date(Date.now() + this.candidateTtlDays * 864e5).toISOString();
		const factualAt = typeof input.factualAt === "string" && input.factualAt.trim() !== "" ? input.factualAt.trim().slice(0, 40) : null;
		db.prepare(`INSERT INTO claims(id, scope_kind, scope_id, kind, canonical_text, searchable_text, status, authority_class,
      confidence, importance, sensitivity_class, normalized_content_hash, expires_at, factual_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 50, 50, 'internal', ?, ?, ?, ?, ?)`).run(id, scopeKind, scopeId, kind, canonical, buildSearchableText(canonical), confirm ? "active" : "candidate", confirm ? "user_confirmed" : "llm_extracted", hash, expiresAt, factualAt, now, now);
		if (idempotencyKey !== void 0) db.prepare(`INSERT INTO candidate_idempotency(idempotency_key, claim_id, original_claim_hash, outcome, expires_at, created_at)
        VALUES (?, ?, ?, 'pending', ?, ?)`).run(idempotencyKey, id, hash, expiresAt, now);
		if (confirm) db.prepare("INSERT INTO embedding_jobs(claim_id, state, created_at, updated_at) VALUES (?, 'pending', ?, ?) ON CONFLICT(claim_id) DO NOTHING").run(id, now, now);
		const evidenceKind = typeof input.evidenceKind === "string" && EVIDENCE_KINDS.includes(input.evidenceKind) ? input.evidenceKind : "user_confirmation";
		if (typeof input.evidence === "string" && input.evidence.trim() !== "") {
			const evidenceId = uuidv7();
			db.prepare(`INSERT INTO evidence_sources(id, kind, portable_locator, captured_at, availability, sensitivity_class)
        VALUES (?, ?, ?, ?, 'available', 'internal')`).run(evidenceId, evidenceKind, input.evidence.trim(), now);
			db.prepare("INSERT INTO claim_evidence(claim_id, evidence_id, kind, created_at) VALUES (?, ?, ?, ?)").run(id, evidenceId, "DERIVED_FROM", now);
		}
		if (confirm) return "已确认写入（active + user_confirmed）：" + id + "\n  scope: " + scopeKind + "/" + scopeId + "\n  kind: " + kind + "\n  claim: " + canonical;
		return "已暂存为候选（candidate，14 天内确认，否则自动过期）：" + id + "\n  scope: " + scopeKind + "/" + scopeId + "\n  kind: " + kind + "\n  claim: " + canonical + "\n回传 confirm=true 即确认写入为 active + user_confirmed。";
	}
	query(input) {
		const q = String(input.q ?? "").trim();
		if (q === "") throw new Error("query 不能为空。");
		const limit = Math.min(Math.max(Number(input.limit ?? 5) || 5, 1), 10);
		const { db, scopeKind, scopeId } = input.scope === "project" || input.projectId !== void 0 && input.projectId !== "" ? this.shard("project", input.projectId) : this.shard("global_user");
		const tokens = buildSearchableText(q).split(/\s+/u).filter((token) => token.length > 0).slice(0, 8);
		const ftsQuery = tokens.map((token) => "\"" + token.replace(/"/gu, "\"\"") + "\"").join(" OR ");
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const runId = uuidv7();
		db.prepare("INSERT INTO recall_runs(id, project_id, query_hash, query_len, created_at) VALUES (?, ?, ?, ?, ?)").run(runId, scopeKind === "project" ? scopeId : null, createHash("sha256").update(q).digest("hex"), q.length, now);
		let rows;
		if (tokens.length === 0) rows = db.prepare("SELECT * FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'active' ORDER BY importance DESC, updated_at DESC LIMIT ?").all(scopeKind, scopeId, limit);
		else {
			const matched = db.prepare("SELECT rowid FROM claims_fts WHERE claims_fts MATCH ? LIMIT 64").all(ftsQuery);
			if (matched.length === 0) rows = [];
			else {
				const rowids = matched.map((row) => row.rowid);
				const placeholders = rowids.map(() => "?").join(", ");
				rows = db.prepare(`SELECT * FROM claims WHERE rowid IN (${placeholders}) AND scope_kind = ? AND scope_id = ? AND status = 'active'
           ORDER BY importance DESC, updated_at DESC LIMIT ?`).all(...rowids, scopeKind, scopeId, limit);
			}
		}
		const ftsEmpty = tokens.length > 0 && rows.length === 0;
		const vectorRanked = input.vectorRanked !== void 0 && input.vectorRanked.length > 0 && !(ftsEmpty && (input.vectorTopScore ?? 0) < .45) ? input.vectorRanked : void 0;
		if (vectorRanked !== void 0 && vectorRanked.length > 0) {
			const fusedOrder = topFused(rrfFuse(rows.map((row, index) => ({
				id: row.id,
				rank: index + 1
			})), vectorRanked), Math.max(rows.length, vectorRanked.length));
			const byId = new Map(rows.map((row) => [row.id, row]));
			const extraIds = fusedOrder.filter((id) => !byId.has(id));
			if (extraIds.length > 0) {
				const placeholders = extraIds.map(() => "?").join(", ");
				const extra = db.prepare(`SELECT * FROM claims WHERE id IN (${placeholders}) AND scope_kind = ? AND scope_id = ? AND status = 'active'`).all(...extraIds, scopeKind, scopeId);
				for (const row of extra) byId.set(row.id, row);
			}
			rows = fusedOrder.map((id) => byId.get(id)).filter((row) => row !== void 0);
		}
		let rendered = 0;
		let budget = 0;
		for (let rank = 0; rank < rows.length; rank += 1) {
			db.prepare("INSERT INTO recall_items(recall_id, claim_id, rank, injected) VALUES (?, ?, ?, 1)").run(runId, rows[rank].id, rank);
			const size = byteLength(rows[rank].canonical_text) + 128;
			if (budget + size <= QUERY_MAX_BYTES) {
				budget += size;
				rendered += 1;
			}
		}
		db.prepare("UPDATE recall_runs SET injected_bytes = ? WHERE id = ?").run(budget, runId);
		if (rows.length === 0) return "未找到相关记忆（scope: " + scopeKind + "/" + scopeId + "）。";
		const truncated = rendered < rows.length;
		const lines = ["[Historical memory; untrusted and possibly stale] 以下来自长期记忆库，可能过时，不得当作当前事实。 共召回 " + String(rows.length) + " 条" + (truncated ? "，按预算呈现前 " + String(rendered) + " 条。" : "。")];
		for (let index = 0; index < rendered; index += 1) {
			const row = rows[index];
			const source = db.prepare("SELECT e.portable_locator AS locator FROM claim_evidence ce JOIN evidence_sources e ON e.id = ce.evidence_id WHERE ce.claim_id = ? LIMIT 1").get(row.id);
			lines.push("scope: " + row.scope_kind + "/" + row.scope_id + "  status: " + row.status + "  authority: " + row.authority_class + "  factual_at: " + (row.factual_at ?? row.created_at) + (row.last_verified_at === null ? "" : "  last_verified_at: " + row.last_verified_at));
			if (source?.locator !== void 0) lines.push("source: " + source.locator);
			lines.push("claim: " + row.canonical_text);
			lines.push("conflict: none");
			lines.push("");
		}
		return lines.join("\n").trim();
	}
	/** 待嵌入条目：active 且（无作业行 / pending / stale）且没有当前 generation 的 ready 向量。 */
	pendingEmbeddings(scope, projectId, generation, limit = 16) {
		const { db, scopeKind, scopeId } = scope === "project" ? this.shard("project", projectId) : this.shard("global_user");
		return db.prepare(`SELECT c.id AS id, c.canonical_text AS text FROM claims c
       LEFT JOIN embedding_jobs j ON j.claim_id = c.id
       WHERE c.scope_kind = ? AND c.scope_id = ? AND c.status = 'active'
         AND (j.state IS NULL OR j.state IN ('pending','stale') OR (j.state = 'failed' AND j.retries < 3))
         AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.claim_id = c.id AND e.status = 'active' AND e.generation = ?)
       ORDER BY c.updated_at ASC LIMIT ?`).all(scopeKind, scopeId, generation, Math.min(Math.max(limit, 1), 64));
	}
	storeEmbedding(input) {
		const { db, scopeKind, scopeId } = input.scope === "project" ? this.shard("project", input.projectId) : this.shard("global_user");
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const blob = Buffer.from(input.vector.buffer, input.vector.byteOffset, input.vector.byteLength);
		db.prepare(`INSERT INTO embeddings(claim_id, provider_id, model_id, model_revision, dimensions, encoding, normalization, content_hash, vector_blob, generated_at, generation, status)
       VALUES (?, ?, ?, ?, ?, 'float32-le', 'l2', ?, ?, ?, ?, 'active')
       ON CONFLICT(claim_id) DO UPDATE SET provider_id = excluded.provider_id, model_id = excluded.model_id,
         model_revision = excluded.model_revision, dimensions = excluded.dimensions, content_hash = excluded.content_hash,
         vector_blob = excluded.vector_blob, generated_at = excluded.generated_at, generation = excluded.generation, status = 'active'`).run(input.id, input.providerId, input.modelId, input.modelRevision, input.dimensions, input.contentHash, blob, now, input.generation);
		db.prepare(`INSERT INTO embedding_jobs(claim_id, state, error_code, retries, created_at, updated_at)
       SELECT id, 'ready', NULL, 0, ?, ? FROM claims WHERE id = ? AND scope_kind = ? AND scope_id = ?
       ON CONFLICT(claim_id) DO UPDATE SET state = 'ready', error_code = NULL, updated_at = excluded.updated_at`).run(now, now, input.id, scopeKind, scopeId);
	}
	/** 嵌入失败：只记错误码与重试次数，不记正文（评审 §4.2.2）。 */
	markEmbeddingFailed(scope, projectId, id, errorCode) {
		const { db, scopeKind, scopeId } = scope === "project" ? this.shard("project", projectId) : this.shard("global_user");
		const now = (/* @__PURE__ */ new Date()).toISOString();
		db.prepare("UPDATE embedding_jobs SET state = 'failed', error_code = ?, retries = retries + 1, updated_at = ? WHERE claim_id = ? AND state != 'ready' AND claim_id IN (SELECT id FROM claims WHERE scope_kind = ? AND scope_id = ?)").run(errorCode.slice(0, 120), now, id, scopeKind, scopeId);
	}
	/** 对账：embeddings 里已有当前 generation 的 ready 向量，但作业行缺失时补行（修复统计漏报）。 */
	reconcileEmbeddingJobs(scope, projectId, generation) {
		const { db, scopeKind, scopeId } = scope === "project" ? this.shard("project", projectId) : this.shard("global_user");
		const result = db.prepare(`INSERT INTO embedding_jobs(claim_id, state, error_code, retries, created_at, updated_at)
       SELECT e.claim_id, 'ready', NULL, 0, e.generated_at, e.generated_at FROM embeddings e
       JOIN claims c ON c.id = e.claim_id
       WHERE c.scope_kind = ? AND c.scope_id = ? AND c.status = 'active' AND e.status = 'active' AND e.generation = ?
       ON CONFLICT(claim_id) DO NOTHING`).run(scopeKind, scopeId, generation);
		return Number(result.changes ?? 0);
	}
	/** generation 变更：旧向量全部退役，对应作业转 stale（等回填重嵌）。 */
	retireStaleEmbeddings(scope, projectId, generation) {
		const { db, scopeKind, scopeId } = scope === "project" ? this.shard("project", projectId) : this.shard("global_user");
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const retired = db.prepare("UPDATE embeddings SET status = 'retired' WHERE status = 'active' AND generation != ? AND claim_id IN (SELECT id FROM claims WHERE scope_kind = ? AND scope_id = ?)").run(generation, scopeKind, scopeId);
		db.prepare("UPDATE embedding_jobs SET state = 'stale', updated_at = ? WHERE state = 'ready' AND claim_id IN (SELECT claim_id FROM embeddings WHERE status = 'retired')").run(now);
		return Number(retired.changes ?? 0);
	}
	/** 查询侧：本 scope 当前 generation 的全部活跃向量（数百条规模 brute-force，≤limit 截断）。 */
	activeEmbeddingVectors(scope, projectId, generation, limit = 512) {
		const { db, scopeKind, scopeId } = scope === "project" ? this.shard("project", projectId) : this.shard("global_user");
		return db.prepare(`SELECT e.claim_id AS claimId, e.vector_blob AS blob FROM embeddings e
       JOIN claims c ON c.id = e.claim_id
       WHERE c.scope_kind = ? AND c.scope_id = ? AND c.status = 'active' AND e.status = 'active' AND e.generation = ?
       ORDER BY c.updated_at DESC LIMIT ?`).all(scopeKind, scopeId, generation, Math.min(Math.max(limit, 1), 1024)).map((row) => ({
			claimId: row.claimId,
			vector: new Float32Array(row.blob.buffer, row.blob.byteOffset, Math.floor(row.blob.byteLength / 4))
		})).filter((row) => row.vector.length > 0);
	}
	embeddingStats(scope, projectId) {
		const { db } = scope === "project" ? this.shard("project", projectId) : this.shard("global_user");
		const rows = db.prepare("SELECT j.state AS state, COUNT(*) AS c FROM embedding_jobs j JOIN claims c ON c.id = j.claim_id WHERE c.status = ? GROUP BY j.state").all("active");
		const stats = {
			pending: 0,
			ready: 0,
			failed: 0,
			stale: 0
		};
		for (const row of rows) if (row.state === "pending") stats.pending = row.c;
		else if (row.state === "ready") stats.ready = row.c;
		else if (row.state === "failed") stats.failed = row.c;
		else if (row.state === "stale") stats.stale = row.c;
		return stats;
	}
	/** 预览：项目条目构成与可重置范围（只读；令牌由插件层管理并二次确认）。 */
	resetProjectPreview(projectId) {
		const { db, scopeKind, scopeId } = this.shard("project", projectId);
		const counts = db.prepare("SELECT status, COUNT(*) AS c FROM claims WHERE scope_kind = ? AND scope_id = ? GROUP BY status").all(scopeKind, scopeId);
		const pick = (status) => counts.find((row) => row.status === status)?.c ?? 0;
		const tombstones = db.prepare("SELECT COUNT(*) AS c FROM tombstones WHERE scope_kind = ? AND scope_id = ?").get(scopeKind, scopeId);
		return {
			projectId,
			total: counts.reduce((sum, row) => sum + row.c, 0),
			active: pick("active"),
			candidates: pick("candidate"),
			archived: pick("archived"),
			tombstones: tombstones.c
		};
	}
	/** 执行重置：archive（全部条目转归档，保留审计）或 delete（逐条 tombstone 后物理删除）。写 catalog 回执。 */
	resetProject(projectId, input) {
		const { db, scopeKind, scopeId } = this.shard("project", projectId);
		const mode = input.mode === "delete" ? "delete" : "archive";
		const tokenHash = createHash("sha256").update(input.confirmToken).digest("hex");
		const before = this.resetProjectPreview(projectId).total;
		const now = (/* @__PURE__ */ new Date()).toISOString();
		if (mode === "archive") db.prepare("UPDATE claims SET status = 'archived', updated_at = ? WHERE scope_kind = ? AND scope_id = ? AND status != 'archived'").run(now, scopeKind, scopeId);
		else {
			const rows = db.prepare("SELECT id, normalized_content_hash AS hash FROM claims WHERE scope_kind = ? AND scope_id = ?").all(scopeKind, scopeId);
			for (const row of rows) db.prepare("INSERT INTO tombstones(id, scope_kind, scope_id, content_hash, deleted_at, reason) VALUES (?, ?, ?, ?, ?, ?)").run(uuidv7(), scopeKind, scopeId, row.hash, now, "reset_project:" + (input.reason ?? ""));
			db.prepare("DELETE FROM claims WHERE scope_kind = ? AND scope_id = ?").run(scopeKind, scopeId);
		}
		const after = mode === "archive" ? this.resetProjectPreview(projectId).archived : 0;
		const receiptId = uuidv7();
		this.catalog().db.prepare("INSERT INTO project_reset_receipts(id, project_id, mode, confirm_token_hash, claims_before, claims_after, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(receiptId, projectId, mode, tokenHash, before, after, (input.reason ?? "").slice(0, 500), now);
		return "项目 " + projectId + " 已" + (mode === "archive" ? "归档" : "删除") + "：处理 " + String(before) + " 条。回执 " + receiptId;
	}
	/** 审计：项目重置回执列表（catalog 侧）。 */
	listProjectResetReceipts(projectId) {
		return (projectId === void 0 ? this.catalog().db.prepare("SELECT * FROM project_reset_receipts ORDER BY created_at DESC LIMIT 50").all() : this.catalog().db.prepare("SELECT * FROM project_reset_receipts WHERE project_id = ? ORDER BY created_at DESC LIMIT 50").all(projectId)).map((row) => ({
			id: row.id,
			projectId: row.project_id,
			mode: row.mode,
			claimsBefore: row.claims_before,
			claimsAfter: row.claims_after,
			reason: row.reason,
			createdAt: row.created_at
		}));
	}
	/** 暂停自动候选与自动召回（quick-pass 注入门由插件层检查）。 */
	isPaused() {
		return this.paused;
	}
	setPaused(on) {
		this.paused = on;
		return this.paused;
	}
	/** 列出待处理候选（status=candidate，按创建时间升序 = 最老优先）。 */
	listCandidates(input) {
		const { db, scopeKind, scopeId } = input.scope === "project" || input.projectId !== void 0 && input.projectId !== "" ? this.shard("project", input.projectId) : this.shard("global_user");
		const limit = Math.min(Math.max(Number(input.limit ?? 10) || 10, 1), 50);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const rows = db.prepare("SELECT id, kind, canonical_text, expires_at, factual_at, created_at FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'candidate' ORDER BY created_at ASC LIMIT ?").all(scopeKind, scopeId, limit);
		if (rows.length === 0) return "当前没有待处理候选（scope: " + scopeKind + "/" + scopeId + "）。";
		const lines = ["待处理候选 " + String(rows.length) + " 条（scope: " + scopeKind + "/" + scopeId + "，最老优先；用 memory_review 确认或拒绝）："];
		for (const row of rows) lines.push("- [" + row.id + "] (" + row.kind + ") " + row.canonical_text + "  // 事实时间: " + (row.factual_at !== null ? row.factual_at.slice(0, 10) : "未记录（录入 " + row.created_at.slice(0, 10) + "）") + "  // 到期: " + String(row.expires_at ?? "未设") + (row.expires_at !== null && row.expires_at <= now ? "（已过期，将被清理）" : ""));
		return lines.join("\n");
	}
	/** 评审候选：confirm → active + user_confirmed；reject → archived（退出候选队列与默认召回）。 */
	reviewCandidate(input) {
		const id = String(input.id ?? "").trim();
		if (id === "") throw new Error("必须提供候选 id（来自 memory_candidates）。");
		const decision = input.decision === "reject" ? "reject" : "confirm";
		const { db, scopeKind, scopeId } = input.scope === "project" || input.projectId !== void 0 && input.projectId !== "" ? this.shard("project", input.projectId) : this.shard("global_user");
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const claim = db.prepare("SELECT id, kind, canonical_text, status, revision FROM claims WHERE id = ? AND scope_kind = ? AND scope_id = ?").get(id, scopeKind, scopeId);
		if (claim === void 0) throw new Error("未找到候选 " + id + "（scope: " + scopeKind + "/" + scopeId + "）。");
		if (claim.status !== "candidate") throw new Error("条目 " + id + " 当前状态是 " + claim.status + "，不是候选。");
		if (decision === "confirm") {
			db.prepare("UPDATE claims SET status = 'active', authority_class = 'user_confirmed', last_verified_at = ?, updated_at = ?, revision = revision + 1, expires_at = NULL WHERE id = ?").run(now, now, id);
			db.prepare("UPDATE candidate_idempotency SET outcome = 'promoted' WHERE claim_id = ?").run(id);
			db.prepare("INSERT INTO embedding_jobs(claim_id, state, created_at, updated_at) VALUES (?, 'pending', ?, ?) ON CONFLICT(claim_id) DO NOTHING").run(id, now, now);
		} else {
			db.prepare("UPDATE claims SET status = 'archived', updated_at = ?, expires_at = NULL WHERE id = ?").run(now, id);
			db.prepare("UPDATE candidate_idempotency SET outcome = 'rejected' WHERE claim_id = ?").run(id);
		}
		db.prepare("INSERT INTO promotion_events(id, claim_id, decision, reviewer, rationale, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(uuidv7(), id, decision, "user", String(input.rationale ?? "").trim().slice(0, 500), now);
		return decision === "confirm" ? "已确认：" + id + " → active + user_confirmed（scope: " + scopeKind + "/" + scopeId + "）。" : "已拒绝：" + id + " → archived（退出候选队列与默认召回）。";
	}
	/** 过期清理（维护任务）：删除到期候选并保留幂等键 outcome；返回清理数。 */
	expireCandidates() {
		const now = (/* @__PURE__ */ new Date()).toISOString();
		let expired = 0;
		for (const rel of ["private/user.sqlite3", ...this.listRegisteredProjects().map((id) => join("projects", id, "memory.sqlite3"))]) {
			let store;
			try {
				store = openShard(join(this.dbRoot, rel), {
					encrypted: this.encrypted,
					keyRoot: this.dbRoot
				});
			} catch {
				continue;
			}
			try {
				store.db.prepare("UPDATE candidate_idempotency SET outcome = 'expired' WHERE outcome = 'pending' AND claim_id IN (SELECT id FROM claims WHERE status = 'candidate' AND expires_at IS NOT NULL AND expires_at <= ?)").run(now);
				const result = store.db.prepare("DELETE FROM claims WHERE status = 'candidate' AND expires_at IS NOT NULL AND expires_at <= ?").run(now);
				expired += Number(result.changes ?? 0);
			} finally {
				store.db.close();
			}
		}
		return expired;
	}
	/** 候选摘要块（挂入 summary）：待处理数、最老 3 条、本分片决策统计。 */
	candidateDigest(db, scopeKind, scopeId) {
		const pending = db.prepare("SELECT COUNT(*) AS c FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'candidate'").get(scopeKind, scopeId);
		const oldest = db.prepare("SELECT id, kind, canonical_text, expires_at FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'candidate' ORDER BY created_at ASC LIMIT 3").all(scopeKind, scopeId);
		const decisions = db.prepare("SELECT decision, COUNT(*) AS c FROM promotion_events WHERE created_at >= ? GROUP BY decision ORDER BY c DESC").all((/* @__PURE__ */ new Date(Date.now() - 7 * 864e5)).toISOString());
		const lines = ["候选队列: 待处理 " + String(pending.c) + " 条（14 天不处理自动过期）"];
		if (oldest.length > 0) {
			lines.push("最老候选:");
			for (const row of oldest) lines.push("  - [" + row.id + "] " + row.canonical_text.slice(0, 120));
		}
		if (decisions.length > 0) lines.push("近 7 天评审: " + decisions.map((d) => d.decision + " " + String(d.c)).join(" / "));
		return lines.join("\n");
	}
	/** 紧凑摘要（渐进披露第一层）：种类/状态计数、高重要性条目、最近更新、冲突对。 */
	summary(input) {
		const { db, scopeKind, scopeId } = input.scope === "project" || input.projectId !== void 0 && input.projectId !== "" ? this.shard("project", input.projectId) : this.shard("global_user");
		const topLimit = Math.min(Math.max(Number(input.limit ?? SUMMARY_TOP_CLAIMS) || SUMMARY_TOP_CLAIMS, 1), 10);
		const kindCounts = db.prepare("SELECT kind, COUNT(*) AS c FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'active' GROUP BY kind ORDER BY c DESC").all(scopeKind, scopeId);
		const statusCounts = db.prepare("SELECT status, COUNT(*) AS c FROM claims WHERE scope_kind = ? AND scope_id = ? GROUP BY status").all(scopeKind, scopeId);
		const top = db.prepare("SELECT id, kind, canonical_text, importance FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'active' ORDER BY importance DESC, updated_at DESC LIMIT ?").all(scopeKind, scopeId, topLimit);
		const recent = db.prepare("SELECT id, kind, canonical_text, COALESCE(factual_at, last_verified_at, updated_at) AS fresh_at FROM claims WHERE scope_kind = ? AND scope_id = ? AND status = 'active' ORDER BY fresh_at DESC LIMIT ?").all(scopeKind, scopeId, SUMMARY_RECENT_CLAIMS);
		const conflicts = db.prepare("SELECT cr.source_id AS a, cr.target_id AS b, s.canonical_text AS at, t.canonical_text AS bt FROM claim_relations cr JOIN claims s ON s.id = cr.source_id JOIN claims t ON t.id = cr.target_id WHERE cr.kind = ? LIMIT 5").all("CONFLICTS_WITH");
		const lines = ["紧凑摘要（scope: " + scopeKind + "/" + scopeId + "；不可信历史参考，先看这里再决定是否 query）"];
		lines.push("active: " + kindCounts.map((row) => row.kind + "×" + String(row.c)).join(" ") + "（" + (kindCounts.length === 0 ? "无" : "共 " + String(kindCounts.reduce((sum, row) => sum + row.c, 0)) + " 条") + "）");
		lines.push("status: " + statusCounts.map((row) => row.status + "×" + String(row.c)).join(" "));
		lines.push("重要条目（importance 排序）：");
		for (const row of top) lines.push("  [" + row.kind + "] " + row.canonical_text + "（" + row.id.slice(0, 8) + "）");
		lines.push("最近验证/更新：");
		for (const row of recent) lines.push("  [" + row.kind + "] " + row.canonical_text + "（" + row.fresh_at.slice(0, 10) + "）");
		lines.push("冲突对（需成对呈现）：");
		if (conflicts.length === 0) lines.push("  （无）");
		for (const pair of conflicts) lines.push("  " + pair.at + " ⇄ " + pair.bt);
		lines.push("");
		lines.push(this.candidateDigest(db, scopeKind, scopeId));
		const text = lines.join("\n");
		if (byteLength(text) > SUMMARY_MAX_BYTES) return text.slice(0, Math.floor(SUMMARY_MAX_BYTES * .8)) + "\n…（摘要超出预算，已截断；请用 memory_query 精确检索）";
		return text;
	}
	list(input) {
		const limit = Math.min(Math.max(Number(input.limit ?? 20) || 20, 1), 50);
		const { db, scopeKind, scopeId } = input.scope === "project" || input.projectId !== void 0 && input.projectId !== "" ? this.shard("project", input.projectId) : this.shard("global_user");
		const conditions = ["scope_kind = ?", "scope_id = ?"];
		const args = [scopeKind, scopeId];
		if (typeof input.kind === "string" && input.kind !== "") {
			conditions.push("kind = ?");
			args.push(input.kind);
		}
		if (typeof input.status === "string" && input.status !== "") {
			conditions.push("status = ?");
			args.push(input.status);
		}
		const rows = db.prepare("SELECT id, kind, status, authority_class, canonical_text, factual_at, created_at FROM claims WHERE " + conditions.join(" AND ") + " ORDER BY updated_at DESC LIMIT ?").all(...args, limit);
		if (rows.length === 0) return "（空）";
		return rows.map((row) => row.id + " [" + row.status + " / " + row.authority_class + " / " + row.kind + "] " + row.canonical_text + "  // " + (row.factual_at !== null ? "事实 " + row.factual_at.slice(0, 10) : "录 " + row.created_at.slice(0, 10))).join("\n");
	}
	status() {
		const lines = ["dbRoot: " + this.dbRoot];
		lines.push("registered projects: " + (this.listRegisteredProjects().join(", ") || "（无）"));
		const shards = ["private/user.sqlite3", ...this.listRegisteredProjects().map((id) => join("projects", id, "memory.sqlite3"))];
		for (const rel of shards) {
			const path = join(this.dbRoot, rel);
			if (!existsSync(path)) {
				lines.push("shard " + rel + ": 未创建");
				continue;
			}
			const store = openShard(path, {
				encrypted: this.encrypted,
				keyRoot: this.dbRoot
			});
			const counts = store.db.prepare("SELECT COUNT(*) AS c FROM claims WHERE status = 'active'").get();
			const fts = store.db.prepare("SELECT COUNT(*) AS c FROM claims_fts").get();
			lines.push("shard " + rel + ": schemaVersion=" + String(store.version) + " active=" + String(counts.c) + " ftsRows=" + String(fts.c));
			store.db.close();
		}
		lines.push("schemaVersion: " + String(this.catalog().version));
		return lines.join("\n");
	}
	findClaim(id) {
		const candidates = [this.shard("global_user")];
		for (const project of this.listRegisteredProjects()) candidates.push(this.shard("project", project));
		for (const ref of candidates) {
			const row = ref.db.prepare("SELECT * FROM claims WHERE id = ?").get(id);
			if (row !== void 0) return {
				shardRef: ref,
				row
			};
		}
		return null;
	}
	explain(id) {
		const found = this.findClaim(id);
		if (found === null) throw new Error("未找到条目 " + id + "。");
		const { shardRef, row } = found;
		const evidence = shardRef.db.prepare("SELECT e.kind AS kind, e.portable_locator AS locator, e.availability AS availability FROM claim_evidence ce JOIN evidence_sources e ON e.id = ce.evidence_id WHERE ce.claim_id = ?").all(id);
		const promotions = shardRef.db.prepare("SELECT decision, target, rationale, created_at FROM promotion_events WHERE claim_id = ? ORDER BY created_at DESC").all(id);
		const recallCount = shardRef.db.prepare("SELECT COUNT(*) AS c FROM recall_items WHERE claim_id = ?").get(id).c;
		return [
			"id: " + row.id,
			"scope: " + row.scope_kind + "/" + row.scope_id + "  kind: " + row.kind,
			"status: " + row.status + "  authority: " + row.authority_class + "  sensitivity: " + row.sensitivity_class,
			"claim: " + row.canonical_text,
			"created_at: " + row.created_at + "  updated_at: " + row.updated_at + (row.last_verified_at === null ? "" : "  last_verified_at: " + row.last_verified_at),
			"evidence: " + (evidence.length === 0 ? "（无）" : evidence.map((e) => e.kind + " " + e.locator + " (" + e.availability + ")").join("；")),
			"promotions: " + (promotions.length === 0 ? "（无）" : promotions.map((p) => p.decision + (p.target === null ? "" : " → " + p.target) + (p.rationale === null || p.rationale === "" ? "" : "（" + p.rationale + "）") + " @ " + p.created_at).join("；")),
			"recall_uses: " + String(recallCount)
		].join("\n");
	}
	correct(id, correctedText) {
		assertWritableContent(correctedText);
		const found = this.findClaim(id);
		if (found === null) throw new Error("未找到条目 " + id + "。");
		const { shardRef, row } = found;
		if (row.status === "archived") throw new Error("已归档条目不可再修正。");
		const canonical = canonicalizeClaim(correctedText);
		const hash = normalizedHash(correctedText);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const newId = uuidv7();
		const db = shardRef.db;
		db.exec("BEGIN");
		try {
			db.prepare(`INSERT INTO claims(id, scope_kind, scope_id, kind, canonical_text, searchable_text, status, authority_class,
        confidence, importance, sensitivity_class, normalized_content_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', 'user_confirmed', 50, 50, ?, ?, ?, ?)`).run(newId, row.scope_kind, row.scope_id, row.kind, canonical, buildSearchableText(canonical), row.sensitivity_class, hash, now, now);
			db.prepare("UPDATE claims SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ?").run(newId, now, id);
			db.prepare("INSERT INTO claim_relations(source_id, target_id, kind, created_at) VALUES (?, ?, ?, ?)").run(newId, id, "SUPERSEDES", now);
			db.prepare("INSERT INTO promotion_events(id, claim_id, decision, reviewer, rationale, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(uuidv7(), id, "archive", "user", "corrected by " + newId, now);
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
		return "已修正：新条目 " + newId + "（active + user_confirmed）取代 " + id + "（superseded）。\n  claim: " + canonical;
	}
	archive(id, reason) {
		const found = this.findClaim(id);
		if (found === null) throw new Error("未找到条目 " + id + "。");
		const now = (/* @__PURE__ */ new Date()).toISOString();
		found.shardRef.db.prepare("UPDATE claims SET status = 'archived', updated_at = ? WHERE id = ?").run(now, id);
		found.shardRef.db.prepare("INSERT INTO promotion_events(id, claim_id, decision, reviewer, rationale, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(uuidv7(), id, "archive", "user", reason ?? "", now);
		return "已归档 " + id + "（退出默认召回，保留审计）。";
	}
	/** 一致性快照：VACUUM INTO + integrity_check + manifest + sha256。 */
	backup(kind = "daily") {
		const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/gu, "-");
		const dir = join(this.dbRoot, "memory-snapshots", stamp);
		mkdirSync(dir, { recursive: true });
		const entries = [];
		const sources = [
			{ rel: join("private", "user.sqlite3") },
			{ rel: "catalog.sqlite3" },
			...this.listRegisteredProjects().map((id) => ({ rel: join("projects", id, "memory.sqlite3") }))
		];
		for (const source of sources) {
			const live = join(this.dbRoot, source.rel);
			if (!existsSync(live)) continue;
			const snap = join(dir, source.rel.replace(/[\\\/]/gu, "__"));
			const cached = this.shardStores.get(source.rel);
			const opened = cached === void 0 ? openShard(live, {
				encrypted: this.encrypted,
				keyRoot: this.dbRoot
			}) : void 0;
			const db = cached?.db ?? opened.db;
			try {
				if (!db.integrityOk()) throw new Error("integrity_check 失败：" + source.rel);
				db.vacuumInto(snap);
				const hash = createHash("sha256").update(readFileSync(snap)).digest("hex");
				entries.push({
					file: snap,
					sha256: hash
				});
			} finally {
				opened?.db.close();
			}
		}
		const manifest = {
			kind,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			schemaVersion: 1,
			entries
		};
		writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
		return "快照完成（" + entries.length + " 个文件）：" + dir + "\n" + entries.map((entry) => "  " + entry.file + "  sha256=" + entry.sha256).join("\n");
	}
	/** 导出包：JSONL + manifest + hashes（仅包含非 Restrict 的长期内容；local_locator 默认省略）。 */
	exportPackage(input) {
		const useProject = input.scope === "project" || input.projectId !== void 0 && input.projectId !== "";
		const { db, scopeKind, scopeId } = useProject ? this.shard("project", input.projectId) : this.shard("global_user");
		const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/gu, "-");
		const dir = join(this.dbRoot, "exports", "export-" + (useProject ? scopeId : "global-user") + "-" + stamp);
		mkdirSync(dir, { recursive: true });
		const tables = [
			{
				name: "claims",
				jsonl: "claims.jsonl"
			},
			{
				name: "evidence_sources",
				jsonl: "evidence.jsonl"
			},
			{
				name: "claim_evidence",
				jsonl: "claim_evidence.jsonl"
			},
			{
				name: "claim_relations",
				jsonl: "claim_relations.jsonl"
			},
			{
				name: "promotion_events",
				jsonl: "promotions.jsonl"
			},
			{
				name: "tombstones",
				jsonl: "tombstones.jsonl"
			}
		];
		const counts = {};
		for (const table of tables) {
			const rows = db.prepare("SELECT * FROM " + table.name).all();
			if (table.name === "evidence_sources") {
				for (const row of rows) if (row.local_locator !== null) row.local_locator = null;
			}
			const lines = rows.map((row) => JSON.stringify(row)).join("\n");
			writeFileSync(join(dir, table.jsonl), lines === "" ? "" : lines + "\n");
			counts[table.name] = rows.length;
		}
		const manifest = {
			exportFormatVersion: 1,
			schemaVersion: 1,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			scopeKind,
			scopeId,
			counts,
			files: tables.map((table) => ({
				name: table.jsonl,
				sha256: createHash("sha256").update(readFileSync(join(dir, table.jsonl))).digest("hex")
			}))
		};
		const manifestPath = join(dir, "manifest.json");
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
		writeFileSync(join(dir, "hashes.sha256"), manifest.files.map((f) => f.sha256 + " *" + f.name).join("\n") + "\n");
		return "导出完成：" + dir + "\n  counts: " + Object.entries(counts).map(([k, v]) => k + "=" + String(v)).join(" ") + "\n  manifest: " + manifestPath;
	}
	/** 导入导出包到目标分片（P1 供 fixture 往返验证；真实导入走 shadow import 合同）。 */
	importPackage(dir, options) {
		const { db } = options.scope === "project" || options.projectId !== void 0 && options.projectId !== "" ? this.shard("project", options.projectId) : this.shard("global_user");
		const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
		const tables = [
			{
				name: "claims",
				jsonl: "claims.jsonl"
			},
			{
				name: "evidence_sources",
				jsonl: "evidence.jsonl"
			},
			{
				name: "claim_evidence",
				jsonl: "claim_evidence.jsonl"
			},
			{
				name: "claim_relations",
				jsonl: "claim_relations.jsonl"
			},
			{
				name: "promotion_events",
				jsonl: "promotions.jsonl"
			},
			{
				name: "tombstones",
				jsonl: "tombstones.jsonl"
			}
		];
		let inserted = 0;
		db.exec("BEGIN");
		try {
			for (const table of tables) {
				const rows = readFileSync(join(dir, table.jsonl), "utf8").trim() === "" ? [] : readFileSync(join(dir, table.jsonl), "utf8").trim().split("\n").map((line) => JSON.parse(line));
				for (const row of rows) {
					const columns = Object.keys(row);
					const values = columns.map((column) => row[column]);
					db.prepare("INSERT INTO " + table.name + " (" + columns.join(", ") + ") VALUES (" + columns.map(() => "?").join(", ") + ")").run(...values);
					inserted += 1;
				}
			}
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
		return "导入完成：" + String(inserted) + " 行（counts: " + JSON.stringify(manifest.counts) + "）";
	}
	close() {
		for (const store of this.shardStores.values()) store.db.close();
		this.shardStores.clear();
		this.catalogStore?.db.close();
		this.catalogStore = null;
	}
};
const MAX_CONTEXT_CHARS_HARD = 8e3;
const USER_PART_MAX_CHARS = 400;
var ExtractorError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "ExtractorError";
		this.code = code;
	}
};
/** 提取提示词：绑定项目时开放 project 范围，否则只允许全局通用内容。 */
function extractionPrompt(projectId) {
	const bindingLine = projectId === void 0 ? "当前未绑定项目：只允许 scope=\"global_user\"（kind 限 pattern/global_fact/user_profile/skill）。" : "当前项目：" + projectId + "。项目专属事实/事件用 scope=\"project\"（kind 限 project_fact/event）；跨项目通用教训用 scope=\"global_user\" + kind=\"pattern\"。";
	return [
		"你是记忆提取助手。请阅读对话并提取值得长期记住的内容（技术经验、已验证的修复、可复用方法、明确约定或决定、重要事实），只输出一个 JSON 对象（不要 Markdown 代码块、不要多余文字）：",
		"{\"candidates\":[{\"kind\":\"pattern\",\"scope\":\"global_user\",\"text\":\"一句中文陈述\",\"confidence\":60}]}",
		"规则：",
		"- 最多 " + String(2) + " 条，按重要程度排序；没有值得记的内容就输出 {\"candidates\":[]}。",
		"- text 必须是完整陈述句（不含密钥/令牌/口令/身份证号/银行卡号等敏感信息），只提取对话中明确出现的内容，不要编造。",
		"- kind 白名单：pattern、global_fact、user_profile、skill、project_fact、event。",
		bindingLine
	].join("\n");
}
/** 轮末提取需求门：助手有实质回复，且对话含教训/约定/修复类信号或用户明确要求记住。 */
const EXTRACTION_SKIP = /^翻译[:：]|^改写|^润色|^复述|^总结一下/u;
const EXTRACTION_LESSON = /坑|教训|根因|经验|修复|解决|错误|失败|注意|约定|决定|拍板|规范|方法|方案|以后|别再|再犯/u;
const EXTRACTION_EXPLICIT = /记住|记一下|记下来/u;
const EXTRACTION_ADMIN_TOOL = /memory_candidates|memory_review|memory_pause|memory_status|memory_list|memory_summary|memory_query|memory_record/u;
const EXTRACTION_ADMIN_TALK = /候选|评审|记忆库|自动提取/u;
const EXTRACTION_ADMIN_SHORT = /^(全部)?拒绝$|^确认$|^confirm$|^reject$|^看下候选$/u;
function extractionGate(userText, assistantText) {
	const user = String(userText ?? "").trim();
	const assistant = String(assistantText ?? "").trim();
	if (assistant.length < 20) return false;
	if (EXTRACTION_SKIP.test(user)) return false;
	if (EXTRACTION_ADMIN_TOOL.test(user)) return false;
	if (EXTRACTION_ADMIN_TALK.test(user)) return false;
	if (user.length <= 12 && EXTRACTION_ADMIN_SHORT.test(user)) return false;
	if (EXTRACTION_EXPLICIT.test(user)) return true;
	const probe = (user + "\n" + assistant).slice(0, 4e3);
	return EXTRACTION_LESSON.test(probe);
}
/** 有界上下文：用户意图留头、助手结论留尾，总长不超预算。 */
function buildExtractionContext(userText, assistantText, maxChars) {
	const cap = Math.min(Math.max(Number(maxChars) || 1500, 200), MAX_CONTEXT_CHARS_HARD);
	const user = canonicalizeClaim(userText);
	const assistant = canonicalizeClaim(assistantText);
	const userPart = user.length <= USER_PART_MAX_CHARS ? user : user.slice(0, USER_PART_MAX_CHARS - 1) + "…";
	const prefix = userPart === "" ? "助手：" : "用户：" + userPart + "\n助手：";
	const body = prefix + assistant;
	if (body.length <= cap) return body;
	const budget = cap - prefix.length;
	if (budget < 60) return body.slice(0, cap);
	return prefix + "…" + assistant.slice(-(budget - 1));
}
/**
* 解析模型输出为合法候选（有界）：剥离代码围栏 → JSON → 逐条校验
* （kind×scope 配对、敏感硬拦截、长度、去重、≤2 条）。任何一条不合格只丢弃该条。
*/
function parseExtractionResult(raw, projectId) {
	const text = String(raw ?? "").trim();
	if (text === "") return [];
	const candidateText = (/```(?:json)?\s*([\s\S]*?)```/u.exec(text)?.[1] ?? text).trim();
	let payload;
	if (candidateText.startsWith("{") || candidateText.startsWith("[")) try {
		payload = JSON.parse(candidateText);
	} catch {
		payload = void 0;
	}
	if (payload === void 0) {
		const braceStart = candidateText.indexOf("{");
		const braceEnd = candidateText.lastIndexOf("}");
		if (braceStart >= 0 && braceEnd > braceStart) try {
			payload = JSON.parse(candidateText.slice(braceStart, braceEnd + 1));
		} catch {
			payload = void 0;
		}
	}
	if (payload === void 0) {
		const bracketStart = candidateText.indexOf("[");
		const bracketEnd = candidateText.lastIndexOf("]");
		if (bracketStart >= 0 && bracketEnd > bracketStart) try {
			payload = JSON.parse(candidateText.slice(bracketStart, bracketEnd + 1));
		} catch {
			payload = void 0;
		}
	}
	const list = Array.isArray(payload) ? payload : payload !== null && typeof payload === "object" && Array.isArray(payload.candidates) ? payload.candidates : [];
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const item of list) {
		if (out.length >= 2) break;
		if (item === null || typeof item !== "object") continue;
		const record = item;
		const kind = typeof record.kind === "string" ? record.kind.trim() : "";
		const scope = record.scope === "project" ? "project" : record.scope === "global_user" ? "global_user" : "";
		const rawText = typeof record.text === "string" ? record.text.trim() : "";
		if (kind === "" || scope === "" || rawText === "") continue;
		if (scope === "project" && projectId === void 0) continue;
		try {
			assertKindScopePairing(scope, kind);
		} catch {
			continue;
		}
		try {
			assertWritableContent(rawText);
		} catch {
			continue;
		}
		const canonical = canonicalizeClaim(rawText);
		if (canonical.length < 12 || canonical.length > 4e3) continue;
		const hash = normalizedHash(canonical);
		if (seen.has(hash)) continue;
		seen.add(hash);
		const confidence = Math.min(Math.max(Number(record.confidence ?? 50) || 50, 0), 100);
		out.push({
			kind,
			scope,
			text: canonical,
			confidence
		});
	}
	return out;
}
/**
* 一次有界 OpenAI 兼容提取调用：单个 user message 携带提示词 + 对话上下文。
* 与 image-vision 同构（Host 侧发起，密钥/原始回复不进入渲染进程）。
*/
async function extractCandidates(input, options = {}) {
	const { endpoint, apiKey, model, context, projectId } = input;
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 3e4;
	let base;
	try {
		base = new URL(endpoint);
		if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("unsupported protocol");
	} catch {
		throw new ExtractorError("INVALID_ENDPOINT", "提取模型 API 地址无效。");
	}
	const target = new URL(base.pathname.replace(/\/$/u, "") + "/chat/completions", base);
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, timeoutMs);
	const abortFromCaller = () => {
		controller.abort();
	};
	options.signal?.addEventListener("abort", abortFromCaller);
	try {
		const response = await fetchImpl(target.toString(), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer " + apiKey
			},
			body: JSON.stringify({
				model,
				...input.disableThinking === true ? { thinking: { type: "disabled" } } : {},
				messages: [{
					role: "user",
					content: extractionPrompt(projectId) + "\n\n【对话】\n" + context
				}]
			}),
			signal: controller.signal
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			if (response.status === 401 || response.status === 403) throw new ExtractorError("PROVIDER_AUTH_FAILED", "提取模型服务拒绝了密钥。");
			if (response.status === 404) throw new ExtractorError("PROVIDER_NOT_FOUND", "提取模型服务地址或模型名无效（404）。");
			throw new ExtractorError("PROVIDER_ERROR", "提取模型服务返回 HTTP " + String(response.status) + "。" + detail.slice(0, 120));
		}
		const payload = await response.json();
		const usage = payload.usage;
		const content = payload.choices?.[0]?.message?.content;
		if (typeof content !== "string" || content.trim() === "") throw new ExtractorError("EMPTY_RESPONSE", "提取模型没有返回可用的文字内容。");
		return {
			candidates: parseExtractionResult(content, projectId),
			provider: base.host,
			model: typeof payload.model === "string" && payload.model !== "" ? payload.model : model,
			...usage === void 0 ? {} : { usage: {
				...typeof usage.prompt_tokens === "number" ? { promptTokens: usage.prompt_tokens } : {},
				...typeof usage.completion_tokens === "number" ? { completionTokens: usage.completion_tokens } : {},
				...typeof usage.prompt_cache_hit_tokens === "number" ? { cacheHitTokens: usage.prompt_cache_hit_tokens } : {},
				...typeof usage.prompt_cache_miss_tokens === "number" ? { cacheMissTokens: usage.prompt_cache_miss_tokens } : {}
			} }
		};
	} catch (error) {
		if (error instanceof ExtractorError) throw error;
		if (error?.name === "AbortError" || controller.signal.aborted) throw new ExtractorError("PROVIDER_TIMEOUT", "提取模型服务响应超时。");
		throw new ExtractorError("PROVIDER_UNREACHABLE", "无法连接提取模型服务。");
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", abortFromCaller);
	}
}
//#endregion
//#region src/core/codex-import-extractor.ts
const CODEX_IMPORT_MODEL = "deepseek-v4-flash";
const CODEX_IMPORT_PRICES = Object.freeze({
	cacheHitIn: .05,
	missIn: 1.5,
	out: 4.5
});
const CHARS_PER_CALL = 4e3;
const PROMPT_TOKENS = 800;
const MIN_CANDIDATE_CHARS = 12;
const MAX_OUTPUT_CANDIDATES = 5;
function readStagingPackage(packageDir) {
	const read = (name) => readFileSync(join(packageDir, name), "utf8").trim().split(String.fromCharCode(10)).filter((l) => l !== "").map((l) => JSON.parse(l));
	if (!existsSync(join(packageDir, "sessions.jsonl")) || !existsSync(join(packageDir, "turn-index.jsonl"))) throw new Error("staging 包不完整：需要 sessions.jsonl 与 turn-index.jsonl（先跑 codex-import-dryrun.mjs）");
	return {
		sessions: read("sessions.jsonl"),
		turns: read("turn-index.jsonl")
	};
}
/** locator（codex://<rollout>#<line>）→ 消息原文。按 rollout 懒读源文件并缓存；绝不复制正文到状态/日志。 */
function locatorTextReader(packageDir) {
	const manifest = JSON.parse(readFileSync(join(packageDir, "manifest.json"), "utf8"));
	const sessions = readFileSync(join(packageDir, "sessions.jsonl"), "utf8").trim().split(String.fromCharCode(10)).filter((l) => l !== "").map((l) => JSON.parse(l));
	const fileByRollout = new Map(sessions.map((s) => [s.rollout_id, s.source_file]));
	const cache = /* @__PURE__ */ new Map();
	return (locator) => {
		const match = /^codex:\/\/([^#]+)#(\d+)$/u.exec(locator);
		if (match === null) return "";
		const rolloutId = match[1] ?? "";
		const lineSeq = Number(match[2] ?? "");
		const rel = fileByRollout.get(rolloutId);
		if (rel === void 0) return "";
		let lines = cache.get(rolloutId);
		if (lines === void 0) {
			const full = join(manifest.sessionsRoot, rel);
			if (!existsSync(full)) {
				cache.set(rolloutId, []);
				return "";
			}
			lines = readFileSync(full, "utf8").split(String.fromCharCode(10));
			cache.set(rolloutId, lines);
		}
		const line = lines[lineSeq - 1];
		if (line === void 0 || line.trim() === "") return "";
		try {
			const content = JSON.parse(line).payload?.content;
			if (!Array.isArray(content)) return "";
			const parts = [];
			for (const block of content) {
				const text = block?.text ?? block?.output_text ?? block?.input_text;
				if (typeof text === "string" && text !== "") parts.push(text);
			}
			return parts.join(String.fromCharCode(10));
		} catch {
			return "";
		}
	};
}
/** 试点采样：指定项目标签 + 混合采样（最新/最老/最大），确定性（同 seed 同结果）。 */
function sampleSessions(sessions, options) {
	let state = (options.seed ?? 42) >>> 0;
	const rand = () => {
		state = state * 1664525 + 1013904223 >>> 0;
		return state / 4294967296;
	};
	const pool = sessions.filter((s) => s.project_label === options.projectLabel && s.turn_count > 0);
	if (pool.length <= options.count) return pool;
	const byLast = [...pool].sort((a, b) => (b.last_at ?? "") > (a.last_at ?? "") ? 1 : -1);
	const byFirst = [...pool].sort((a, b) => (a.first_at ?? "") > (b.first_at ?? "") ? 1 : -1);
	const bySize = [...pool].sort((a, b) => b.turn_count - a.turn_count);
	const picked = /* @__PURE__ */ new Map();
	const sources = [
		byLast,
		byFirst,
		bySize
	];
	let cursor = 0;
	while (picked.size < options.count && sources.some((s) => s.length > 0)) {
		const source = sources[cursor % sources.length];
		if (source === void 0) break;
		const item = source[Math.floor(rand() * Math.min(source.length, Math.max(3, options.count)))];
		if (item !== void 0 && !picked.has(item.rollout_id)) picked.set(item.rollout_id, item);
		cursor += 1;
		if (cursor > options.count * 12) break;
	}
	return [...picked.values()].sort((a, b) => a.rollout_id < b.rollout_id ? -1 : 1);
}
function buildBatches(sessions, turns, options = {}) {
	const charsPerCall = options.charsPerCall ?? CHARS_PER_CALL;
	const turnMap = /* @__PURE__ */ new Map();
	for (const turn of turns) {
		if (turn.char_length < MIN_CANDIDATE_CHARS) continue;
		const list = turnMap.get(turn.rollout_id) ?? [];
		list.push(turn);
		turnMap.set(turn.rollout_id, list);
	}
	const batches = [];
	for (const session of sessions) {
		const list = turnMap.get(session.rollout_id) ?? [];
		if (list.length === 0) continue;
		let current = [];
		let chars = 0;
		for (const turn of list) {
			if (chars > 0 && chars + turn.char_length > charsPerCall) {
				batches.push({
					rolloutId: session.rollout_id,
					sessionId: session.session_id,
					messages: current,
					chars
				});
				current = [];
				chars = 0;
			}
			current.push({
				locator: turn.locator,
				role: turn.role,
				charLength: turn.char_length,
				...turn.timestamp === void 0 ? {} : { timestamp: turn.timestamp }
			});
			chars += turn.char_length;
		}
		if (current.length > 0) batches.push({
			rolloutId: session.rollout_id,
			sessionId: session.session_id,
			messages: current,
			chars
		});
	}
	return batches;
}
/** 空闲时段闸门：北京时 9-12、14-18 为高峰，其余空闲（官方价一半）。 */
function isOffPeak(now = /* @__PURE__ */ new Date()) {
	const hour = now.getHours();
	return !(hour >= 9 && hour < 12 || hour >= 14 && hour < 18);
}
/** 单调用成本（元）：按官方口径分缓存命中/未命中/输出。 */
function callCostYuan(usage) {
	const miss = usage.missIn ?? 0;
	const hit = usage.hitIn ?? 0;
	const out = usage.out ?? 0;
	return (miss * CODEX_IMPORT_PRICES.missIn + hit * CODEX_IMPORT_PRICES.cacheHitIn + out * CODEX_IMPORT_PRICES.out) / 1e6;
}
"" + String.fromCharCode(10);
/** 批量提取（有界）：限速顺序执行、成本硬上限、时段闸门、断点续跑、重试≤3。 */
async function runExtraction(options) {
	const result = {
		calls: 0,
		spentYuan: 0,
		candidates: [],
		stopped: "completed"
	};
	let done = 0;
	if (existsSync(options.checkpointFile ?? "")) {
		const cp = JSON.parse(readFileSync(options.checkpointFile ?? "", "utf8"));
		done = Math.min(Number(cp.done ?? 0), options.batches.length);
		result.spentYuan = Number(cp.spentYuan ?? 0);
		result.candidates = cp.candidates ?? [];
	}
	for (let i = done; i < options.batches.length; i += 1) {
		const batch = options.batches[i];
		if (batch === void 0) {
			result.stopped = "error";
			result.error = "批次缺失";
			break;
		}
		if (options.offPeakOnly !== false && !isOffPeak()) {
			result.stopped = "off-peak";
			break;
		}
		if (result.spentYuan >= options.budgetYuan) {
			result.stopped = "budget";
			break;
		}
		const excerpt = batch.messages.map((m) => m.role + "(" + m.locator + "): " + options.readText(m.locator)).join(String.fromCharCode(10));
		const context = "项目：食溯。摘录（" + String(batch.chars) + " 字符，会话 " + batch.sessionId + "）：\n" + excerpt;
		let lastError = null;
		for (let attempt = 1; attempt <= 3; attempt += 1) try {
			const out = await extractCandidates({
				endpoint: options.endpoint,
				apiKey: options.apiKey,
				model: CODEX_IMPORT_MODEL,
				context,
				projectId: options.projectId,
				disableThinking: true
			}, {
				timeoutMs: options.timeoutMs ?? 6e4,
				...options.fetchImpl === void 0 ? {} : { fetchImpl: options.fetchImpl }
			});
			result.calls += 1;
			const u = out.usage;
			result.spentYuan += u !== void 0 ? callCostYuan({
				missIn: u.cacheMissTokens ?? u.promptTokens ?? 0,
				hitIn: u.cacheHitTokens ?? 0,
				out: u.completionTokens ?? 0
			}) : callCostYuan({
				missIn: Math.round(batch.chars * .6) + PROMPT_TOKENS,
				out: 400
			});
			let factualAt;
			for (const message of batch.messages) if (message.timestamp !== void 0 && message.timestamp !== "") factualAt = message.timestamp;
			for (const candidate of out.candidates.slice(0, MAX_OUTPUT_CANDIDATES)) result.candidates.push({
				...candidate,
				locator: batch.messages[0]?.locator ?? "",
				rolloutId: batch.rolloutId,
				sessionId: batch.sessionId,
				factualAt
			});
			lastError = null;
			break;
		} catch (error) {
			lastError = error;
			if (error instanceof ExtractorError && [
				"PROVIDER_AUTH_FAILED",
				"PROVIDER_NOT_FOUND",
				"INVALID_ENDPOINT"
			].includes(error.code)) break;
			await new Promise((resolve) => setTimeout(resolve, 2e3 * attempt));
		}
		if (lastError !== null) {
			result.stopped = "error";
			result.error = String(lastError instanceof Error ? lastError.message : lastError);
			break;
		}
		done = i + 1;
		options.onProgress?.({
			done,
			total: options.batches.length,
			spentYuan: result.spentYuan,
			candidates: result.candidates.length
		});
		if (options.checkpointFile !== void 0) writeFileSync(options.checkpointFile, JSON.stringify({
			done,
			spentYuan: result.spentYuan,
			candidates: result.candidates
		}), "utf8");
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return result;
}
//#endregion
//#region src/core/context-bridge.ts
const MEMORY_CONTEXT_API_PREFIX = "/__personal/memory/context";
const MAX_CONTEXT_BODY_BYTES = 4096;
const MAX_BINDINGS = 256;
const MAX_SESSION_ID_CHARS = 200;
const MAX_PROJECT_ID_CHARS = 200;
function contextError(code, message, status = 400) {
	return Object.assign(new Error(message), {
		code,
		status,
		expose: true
	});
}
/** 导出为可测 HTTP 处理器（与 image-vision 同构）。 */
function createMemoryContextRequestHandler(runtime) {
	return async (request, response) => {
		try {
			if (request.headers["x-dsh-console"] !== "1") throw contextError("CONSOLE_CLIENT_REQUIRED", "此接口只供个人桌面项目控制台使用。", 403);
			if ((request.method ?? "GET") !== "POST") throw contextError("METHOD_NOT_ALLOWED", "此接口只支持 POST。", 405);
			const body = await readJsonBody(request, MAX_CONTEXT_BODY_BYTES);
			const sessionId = boundedField(body.sessionId, MAX_SESSION_ID_CHARS);
			if (sessionId === "") throw contextError("INVALID_BODY", "缺少 sessionId。");
			const raw = body.projectId;
			let projectId;
			if (raw !== null && raw !== void 0 && raw !== "") {
				if (typeof raw !== "string") throw contextError("INVALID_BODY", "projectId 非法。");
				projectId = raw.trim();
				if (projectId === "" || projectId.length > MAX_PROJECT_ID_CHARS) throw contextError("INVALID_BODY", "projectId 非法。");
				if (projectId.includes("/") || projectId.includes("\\") || projectId === "." || projectId === "..") throw contextError("INVALID_BODY", "projectId 非法。");
				runtime.service.registerProject(projectId);
			}
			runtime.bindings.set(sessionId, projectId);
			pruneBindings(runtime.bindings);
			sendJson(response, 200, {
				ok: true,
				data: {
					sessionId,
					projectId: projectId ?? null
				}
			});
		} catch (error) {
			const status = errorStatus(error);
			sendJson(response, status, {
				ok: false,
				error: {
					code: errorCode(error, status),
					message: status >= 500 ? "记忆绑定服务请求失败。" : messageOf(error)
				}
			});
		}
	};
}
function pruneBindings(bindings) {
	while (bindings.size > MAX_BINDINGS) {
		const first = bindings.keys().next().value;
		if (first === void 0) break;
		bindings.delete(first);
	}
}
function boundedField(value, maxLength) {
	if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) return "";
	return value.trim();
}
async function readJsonBody(request, maximum) {
	const chunks = [];
	let size = 0;
	const declared = Number(request.headers["content-length"] ?? 0);
	if (Number.isFinite(declared) && declared > maximum) throw contextError("BODY_TOO_LARGE", "请求正文过大。", 413);
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > maximum) throw contextError("BODY_TOO_LARGE", "请求正文过大。", 413);
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw contextError("INVALID_BODY", "请求正文必须是对象。");
		return parsed;
	} catch (error) {
		if (error instanceof Error && "code" in error && typeof error.code === "string") throw error;
		throw contextError("INVALID_BODY", "请求正文不是有效 JSON。");
	}
}
function errorStatus(error) {
	const status = error?.status;
	return typeof status === "number" && status >= 400 && status <= 599 ? status : 500;
}
function errorCode(error, status) {
	const code = error?.code;
	return typeof code === "string" && code !== "" ? code : status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
}
function messageOf(error) {
	return error instanceof Error && error.message.trim() !== "" ? error.message : "请求失败。";
}
function sendJson(response, status, value) {
	if (response.headersSent) return;
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	response.end(JSON.stringify(value));
}
//#endregion
//#region src/core/embedding.ts
const MAX_PENDING = 32;
const INIT_TIMEOUT_MS = 12e4;
const EMBED_TIMEOUT_MS = 6e4;
/** worker 文件定位：源码态 src/core → embedding-worker.ts；打包态 lib → embedding-worker.js。 */
function embeddingWorkerPath() {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [resolve(here, "embedding-worker.ts"), resolve(here, "core", "embedding-worker.js")];
	for (const candidate of candidates) if (existsSync(candidate)) return candidate;
	throw new Error("embedding worker 未找到（near " + here + "）。");
}
var EmbeddingRuntime = class {
	modelDir;
	manifest;
	generation;
	worker = null;
	pending = /* @__PURE__ */ new Map();
	nextId = 1;
	initPromise = null;
	state = "idle";
	lastError = "";
	constructor(options) {
		this.modelDir = resolve(options.modelDir);
		this.manifest = options.manifest;
		this.generation = options.generation;
	}
	stateText() {
		return this.state;
	}
	lastErrorText() {
		return this.lastError;
	}
	/** 单飞初始化：worker 懒加载，首次调用才拉起；重复调用共享同一 promise。 */
	ensureReady() {
		this.initPromise ??= this.initialize();
		return this.initPromise;
	}
	async initialize() {
		if (this.state === "ready") return;
		if (this.state === "loading") {
			await new Promise((resolvePromise, rejectPromise) => {
				const timer = setInterval(() => {
					if (this.state === "ready") {
						clearInterval(timer);
						resolvePromise();
					}
					if (this.state === "failed") {
						clearInterval(timer);
						rejectPromise(new Error(this.lastError || "embedding 初始化失败"));
					}
				}, 50);
			});
			return;
		}
		this.state = "loading";
		try {
			const worker = new Worker(embeddingWorkerPath());
			this.worker = worker;
			const ready = new Promise((resolvePromise, rejectPromise) => {
				const timer = setTimeout(() => {
					rejectPromise(/* @__PURE__ */ new Error("embedding 初始化超时（" + String(INIT_TIMEOUT_MS / 1e3) + "s）"));
				}, INIT_TIMEOUT_MS);
				worker.once("message", (message) => {
					clearTimeout(timer);
					if (message.type === "ready") resolvePromise();
					else if (message.type === "error") rejectPromise(new Error(message.error));
					else rejectPromise(/* @__PURE__ */ new Error("embedding worker 意外消息"));
				});
				worker.once("error", (error) => {
					clearTimeout(timer);
					rejectPromise(error);
				});
				worker.once("exit", (code) => {
					clearTimeout(timer);
					rejectPromise(/* @__PURE__ */ new Error("embedding worker 提前退出（code " + String(code) + "）"));
				});
			});
			worker.on("message", (message) => {
				this.dispatch(message);
			});
			worker.postMessage({
				type: "init",
				modelDir: this.modelDir,
				dtype: this.manifest.dtype
			});
			await ready;
			this.state = "ready";
			this.lastError = "";
		} catch (error) {
			this.state = "failed";
			this.lastError = error instanceof Error ? error.message : String(error);
			this.initPromise = null;
			throw error;
		}
	}
	dispatch(message) {
		const id = Number(message.id ?? 0);
		const pending = this.pending.get(id);
		if (pending === void 0) return;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		if (message.type === "embedded" && message.vectors instanceof ArrayBuffer) {
			pending.resolve({
				vectors: message.vectors,
				count: Number(message.count ?? 0),
				dimensions: Number(message.dimensions ?? 0)
			});
			return;
		}
		if (message.type === "error") {
			pending.reject(new Error(String(message.error ?? "embedding 未知错误")));
			return;
		}
		pending.reject(/* @__PURE__ */ new Error("embedding worker 意外响应"));
	}
	/**
	* 有界嵌入：purpose='query' 按 manifest.queryInstruction 加前缀；document 不加。
	* 队列上限 MAX_PENDING，超限显式报 busy（评审 §2.2B：不无限堆积）。
	*/
	async embed(texts, purpose) {
		if (texts.length === 0) throw new Error("embed 文本不能为空");
		if (this.pending.size >= MAX_PENDING) throw new Error("embedding 队列已满（busy），请稍后重试");
		await this.ensureReady();
		const id = this.nextId;
		this.nextId += 1;
		const result = await new Promise((resolvePromise, rejectPromise) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				rejectPromise(/* @__PURE__ */ new Error("embedding 请求超时（" + String(EMBED_TIMEOUT_MS / 1e3) + "s）"));
			}, EMBED_TIMEOUT_MS);
			this.pending.set(id, {
				resolve: resolvePromise,
				reject: rejectPromise,
				timer
			});
			this.worker?.postMessage({
				type: "embed",
				id,
				texts,
				purpose,
				pooling: this.manifest.pooling,
				queryInstruction: this.manifest.queryInstruction
			});
		});
		if (result.dimensions !== this.manifest.dimensions) throw new Error("embedding 维度不符：期望 " + String(this.manifest.dimensions) + "，实际 " + String(result.dimensions));
		return {
			vectors: new Float32Array(result.vectors),
			count: result.count,
			dimensions: result.dimensions,
			generation: this.generation
		};
	}
	/** 关闭：终止 worker（等待中的请求全部拒绝）。 */
	async close() {
		this.initPromise = null;
		this.state = "idle";
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			this.pending.delete(id);
			pending.reject(/* @__PURE__ */ new Error("embedding 运行时已关闭"));
		}
		const worker = this.worker;
		this.worker = null;
		if (worker !== null) await worker.terminate();
	}
};
//#endregion
//#region src/core/embedding-manifest.ts
const EMBEDDING_MANIFEST_NAME = "MODEL_MANIFEST.json";
function text(value, fallback = "") {
	return typeof value === "string" ? value : fallback;
}
function numberValue(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function objectValue(value) {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
	return {};
}
function fileEntry(value) {
	const row = objectValue(value);
	const path = text(row.path);
	const sha256 = text(row.sha256);
	if (path === "" || !/^[0-9a-f]{64}$/u.test(sha256)) return null;
	return {
		path,
		bytes: numberValue(row.bytes, 0),
		sha256
	};
}
function isPooling(value) {
	return value === "cls" || value === "mean" || value === "last_token";
}
/** 读取并做形状校验；目录缺失/JSON 非法/字段越界一律返回 null（调用方走 semantic_unavailable）。 */
function readEmbeddingManifest(modelDir) {
	const manifestPath = join(resolve(modelDir), EMBEDDING_MANIFEST_NAME);
	if (!existsSync(manifestPath)) return null;
	let parsed = null;
	try {
		parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		return null;
	}
	const record = objectValue(parsed);
	if (record.schemaVersion !== 1) return null;
	const modelId = text(record.modelId);
	const dimensions = numberValue(record.dimensions, 0);
	const dtype = text(record.dtype);
	const pooling = record.pooling;
	const files = objectValue(record.files);
	const model = fileEntry(files.model);
	const tokenizer = fileEntry(files.tokenizer);
	const config = fileEntry(files.config);
	if (modelId === "" || dimensions < 16 || dimensions > 16384 || dtype === "" || !isPooling(pooling) || record.normalization !== "l2" || model === null || tokenizer === null || config === null) return null;
	const source = objectValue(record.source);
	return {
		schemaVersion: 1,
		role: text(record.role),
		modelId,
		source: {
			repository: text(source.repository),
			revision: text(source.revision)
		},
		license: text(record.license),
		dimensions,
		maxInputTokens: numberValue(record.maxInputTokens, 512),
		dtype,
		pooling,
		normalization: "l2",
		queryInstruction: text(record.queryInstruction),
		files: {
			model,
			tokenizer,
			config
		}
	};
}
function sha256Of(filePath) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
/**
* 校验 manifest 与本地文件是否一致：大小恒查（廉价），SHA-256 按 verifyHashes 开关
* （首次加载/自检时为 true；日常启动 false，避免每次哈希 570MB 模型）。
* 通过后返回 generation（全部影响向量语义的字段 + 运行时版本哈希）。
*/
function verifyEmbeddingManifest(modelDir, manifest, runtimeVersions, verifyHashes = false) {
	const dir = resolve(modelDir);
	const entries = [
		["model", manifest.files.model],
		["tokenizer", manifest.files.tokenizer],
		["config", manifest.files.config]
	];
	for (const [name, file] of entries) {
		const path = join(dir, file.path);
		if (!existsSync(path)) return {
			ok: false,
			error: name + " 文件缺失：" + file.path
		};
		const size = statSync(path).size;
		if (file.bytes > 0 && size !== file.bytes) return {
			ok: false,
			error: name + " 大小不符：期望 " + String(file.bytes) + "，实际 " + String(size)
		};
		if (verifyHashes) {
			const hash = sha256Of(path);
			if (hash !== file.sha256) return {
				ok: false,
				error: name + " SHA-256 不符（" + hash.slice(0, 12) + "…）"
			};
		}
	}
	return {
		ok: true,
		generation: embeddingGeneration(manifest, runtimeVersions)
	};
}
/** generation = 语义合同哈希（模型/分词器/预处理/运行时），与文档 P4 方案 §7.2.3 一致。 */
function embeddingGeneration(manifest, runtimeVersions) {
	const material = {
		modelId: manifest.modelId,
		repository: manifest.source.repository,
		revision: manifest.source.revision,
		modelSha256: manifest.files.model.sha256,
		tokenizerSha256: manifest.files.tokenizer.sha256,
		dtype: manifest.dtype,
		pooling: manifest.pooling,
		normalization: manifest.normalization,
		queryInstruction: manifest.queryInstruction,
		maxInputTokens: manifest.maxInputTokens,
		transformersJs: runtimeVersions.transformersJs,
		onnxruntimeNode: runtimeVersions.onnxruntimeNode
	};
	return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
}
//#endregion
//#region src/core/embedding-pipeline.ts
function embeddingScopes(service) {
	return [{ scope: "global_user" }, ...service.listRegisteredProjects().map((projectId) => ({
		scope: "project",
		projectId
	}))];
}
function isUnitVector(vector) {
	let norm = 0;
	for (let i = 0; i < vector.length; i += 1) {
		const value = vector[i];
		if (!Number.isFinite(value)) return false;
		norm += value * value;
	}
	const length = Math.sqrt(norm);
	return length > .9 && length < 1.1;
}
/** 一轮回填：每 scope 先退役旧 generation，再批量嵌入待办（≤batch）。任何失败只记作业状态。 */
async function drainEmbeddings(service, runtime, options) {
	const result = {
		embedded: 0,
		failed: 0,
		skipped: 0,
		retired: 0,
		seen: 0
	};
	const batch = Math.min(Math.max(Number(options.batch ?? 16) || 16, 1), 32);
	let ready = true;
	try {
		await runtime.ensureReady();
	} catch {
		ready = false;
	}
	if (!ready) {
		result.skipped += 1;
		return result;
	}
	for (const target of embeddingScopes(service)) {
		try {
			result.retired += service.retireStaleEmbeddings(target.scope, target.projectId, options.generation);
		} catch {}
		let pending = [];
		try {
			service.reconcileEmbeddingJobs(target.scope, target.projectId, options.generation);
			pending = service.pendingEmbeddings(target.scope, target.projectId, options.generation, batch);
		} catch {
			continue;
		}
		if (pending.length === 0) continue;
		result.seen += pending.length;
		try {
			const embedded = await runtime.embed(pending.map((item) => item.text), "document");
			if (embedded.count !== pending.length) throw new Error("嵌入数量不符：期望 " + String(pending.length) + "，实际 " + String(embedded.count));
			for (let i = 0; i < pending.length; i += 1) {
				const item = pending[i];
				const vector = embedded.vectors.subarray(i * embedded.dimensions, (i + 1) * embedded.dimensions);
				if (vector.length !== options.dimensions || !isUnitVector(vector)) {
					service.markEmbeddingFailed(target.scope, target.projectId, item.id, "BAD_VECTOR");
					result.failed += 1;
					continue;
				}
				service.storeEmbedding({
					id: item.id,
					scope: target.scope,
					projectId: target.projectId,
					providerId: options.providerId,
					modelId: options.modelId,
					modelRevision: options.modelRevision,
					dimensions: options.dimensions,
					contentHash: options.contentHashOf(item.text),
					vector,
					generation: options.generation
				});
				result.embedded += 1;
			}
		} catch (error) {
			for (const item of pending) try {
				service.markEmbeddingFailed(target.scope, target.projectId, item.id, "EMBED_FAILED");
			} catch {}
			result.failed += pending.length;
		}
	}
	return result;
}
//#endregion
//#region src/core/embedding-status.ts
/** 与根 package.json 依赖版本一致（generation 材料，变更即新 generation）。 */
const EMBEDDING_RUNTIME_VERSIONS = Object.freeze({
	transformersJs: "4.2.0",
	onnxruntimeNode: "1.24.3"
});
function renderEmbeddingStatus(input) {
	if (input.enabled !== true) return "向量嵌入（P4-2）：未开启（embeddingEnabled=false）。";
	if (input.modelDir === "") return "向量嵌入（P4-2）：已开启但未配置模型目录（embeddingModelDir 为空）——语义召回保持 FTS。";
	if (input.manifest === null) return [
		"向量嵌入（P4-2）：已开启",
		"  模型目录：" + input.modelDir,
		"  manifest：无效（" + (input.manifestError === "" ? "未找到" : input.manifestError) + "）——semantic_unavailable，召回维持 FTS",
		"  worker：未加载",
		"  hybrid 召回：未启用（功能门通过后开启）"
	].join("\n");
	const jobs = input.jobs === null ? "" : "\n  jobs：pending " + String(input.jobs.pending) + " / ready " + String(input.jobs.ready) + " / failed " + String(input.jobs.failed) + " / stale " + String(input.jobs.stale);
	return [
		"向量嵌入（P4-2）：已开启",
		"  模型目录：" + input.modelDir,
		"  manifest：OK（" + input.manifest.modelId + "，" + String(input.manifest.dimensions) + " 维，" + input.manifest.dtype + "/" + input.manifest.pooling + "/l2）",
		"  generation：" + (input.generation === "" ? "未生成" : input.generation),
		"  worker：" + input.workerState + (input.workerError === "" ? "" : "（" + input.workerError + "）")
	].join("\n") + jobs + "\n  上次回填：" + input.lastDrain + "\n  hybrid 召回：" + (input.hybridEnabled ? "已启用（FTS+向量 RRF 融合）" : "未启用（功能门通过后开启）");
}
//#endregion
//#region src/core/foundation-runtime.ts
/** 定位 personal-foundation 主机包入口（源码态 src/core → ../../，打包态 lib → ../）。 */
function foundationBundleUrl() {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [resolve(here, "..", "..", "..", "personal-foundation", "lib", "index.js"), resolve(here, "..", "..", "personal-foundation", "lib", "index.js")];
	for (const candidate of candidates) if (existsSync(candidate)) return pathToFileURL(candidate).href;
	throw new Error("personal-foundation 主机包未找到（near " + here + "）。");
}
/** 加载 personal-foundation 主机包并取出 PersonalStore 构造器（结构校验 + 失败即抛，由调用方吞错）。 */
async function loadFoundationStoreConstructor() {
	const PersonalStore = (await import(foundationBundleUrl())).PersonalStore;
	if (typeof PersonalStore !== "function") throw new Error("personal-foundation 主机包未导出 PersonalStore（lib 版本过旧，请重建插件）。");
	return PersonalStore;
}
//#endregion
//#region src/core/official-fallback.ts
/** 与上游 llm-deepseek 的 PUBLIC_BASE_URL 一致。 */
const DEEPSEEK_OFFICIAL_ENDPOINT = "https://api.deepseek.com";
function officialExtractionConnection(apiKey, baseUrl) {
	const key = typeof apiKey === "string" ? apiKey.trim() : "";
	if (key === "") return null;
	return {
		endpoint: typeof baseUrl === "string" && baseUrl.trim() !== "" ? baseUrl.trim() : DEEPSEEK_OFFICIAL_ENDPOINT,
		apiKey: key,
		label: "deepseek-official（开发版默认密钥）"
	};
}
function blocksText(blocks) {
	if (!Array.isArray(blocks)) return "";
	const parts = [];
	for (const block of blocks) {
		if (block === null || typeof block !== "object") continue;
		const record = block;
		if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
	}
	return parts.join("\n").trim();
}
function topLevelSession(session) {
	const depth = session.header?.delegationDepth;
	return !(typeof depth === "number" && depth > 0);
}
/**
* 订阅适配器：把 (session, event) 流折叠成每轮一份 {userText, assistantText}，
* 在 turn/end（reason=completed）触发一次有界提取。所有异步工作在后台完成。
*/
function createTurnEndExtractor(deps) {
	const buffers = /* @__PURE__ */ new Map();
	const inflight = /* @__PURE__ */ new Set();
	const onEvent = (session, event) => {
		const sessionId = typeof session.header?.id === "string" && session.header.id !== "" ? session.header.id : "";
		if (sessionId === "" || !topLevelSession(session)) return;
		if (event.type === "user/message") {
			if (event.data?.source?.kind !== "user") return;
			const text = blocksText(event.data?.content);
			if (text === "") return;
			const buffer = buffers.get(sessionId);
			if (buffer === void 0) {
				if (buffers.size >= 64) {
					const first = buffers.keys().next().value;
					if (first !== void 0) buffers.delete(first);
				}
				buffers.set(sessionId, {
					userText: text,
					assistantText: ""
				});
			} else buffer.userText = buffer.userText === "" ? text : buffer.userText + "\n" + text;
			return;
		}
		if (event.type === "assistant/message") {
			const text = blocksText(event.data?.message?.content);
			if (text === "") return;
			const buffer = buffers.get(sessionId);
			if (buffer !== void 0) buffer.assistantText = text;
			return;
		}
		if (event.type === "turn/end") {
			const buffer = buffers.get(sessionId);
			if (buffer === void 0) return;
			buffers.delete(sessionId);
			if (event.data?.reason?.kind !== "completed") return;
			const task = runTurnExtraction(sessionId, Number(event.data?.turn ?? 0), buffer);
			inflight.add(task);
			task.finally(() => {
				inflight.delete(task);
			});
		}
	};
	async function runTurnExtraction(sessionId, turn, buffer) {
		const outcome = (outcome) => {
			deps.onOutcome?.(outcome);
		};
		try {
			if (deps.service.isPaused()) {
				outcome({
					kind: "paused",
					detail: "memory_pause 暂停中"
				});
				return;
			}
			if (!extractionGate(buffer.userText, buffer.assistantText)) {
				outcome({
					kind: "gate-skip",
					detail: "需求门未通过（回复过短或无教训/修复/约定信号）"
				});
				return;
			}
			const projectId = deps.bindings.get(sessionId);
			const connection = await deps.runtime().then((runtime) => runtime.findConnection());
			if (connection === null) {
				outcome({
					kind: "no-connection",
					detail: "无「记忆提取」连接且无官方密钥回退（DEEPSEEK_API_KEY）"
				});
				return;
			}
			const context = buildExtractionContext(buffer.userText, buffer.assistantText, deps.maxContextChars);
			const output = await extractCandidates({
				endpoint: connection.endpoint,
				apiKey: connection.apiKey,
				model: deps.model,
				context,
				projectId,
				...deps.disableThinking === true ? { disableThinking: true } : {}
			}, {
				timeoutMs: deps.timeoutMs,
				...deps.fetchImpl === void 0 ? {} : { fetchImpl: deps.fetchImpl }
			});
			let written = 0;
			let index = 0;
			for (const candidate of output.candidates) {
				index += 1;
				if (!deps.service.record({
					kind: candidate.kind,
					text: candidate.text,
					scope: candidate.scope,
					projectId: candidate.scope === "project" ? projectId : void 0,
					confirm: false,
					evidence: "session://" + sessionId + "#" + String(turn),
					evidenceKind: "session",
					idempotencyKey: [
						projectId ?? "global",
						sessionId,
						String(turn),
						"v1",
						String(index)
					].join("|")
				}).includes("幂等键已存在")) written += 1;
			}
			outcome({
				kind: "ok",
				detail: "写入 " + String(written) + " 条候选（模型 " + output.model + "，连接 " + connection.label + "）"
			});
		} catch (error) {
			outcome({
				kind: "failed",
				detail: "提取失败：" + (error instanceof Error && error.message !== "" ? error.message : String(error))
			});
		}
	}
	const flush = async () => {
		while (inflight.size > 0) await Promise.allSettled([...inflight]);
	};
	return {
		onEvent,
		flush
	};
}
//#endregion
//#region src/index.ts
/**
* @cyrus/dsh-memory — P1 最小存储：分片 SQLite + FTS5 + 显式工具。
* 边界：dbRoot 未配置时用系统临时目录（开发/夹具阶段）；真实数据目录与加密在后续阶段按合同落地。
* 工具全部 Host 侧有界：参数白名单、长度上限、scope 硬过滤、写入门禁。
*/
const Config = Schema.object({
	dbRoot: Schema.string().default(""),
	encryptionEnabled: Schema.boolean().default(true),
	quickPassEnabled: Schema.boolean().default(process.env.DSH_MEMORY_QUICKPASS === "1"),
	quickPassMaxBytes: Schema.number().min(200).max(8e3).default(2e3),
	quickPassMaxItems: Schema.number().min(1).max(5).default(3),
	selfTest: Schema.boolean().default(process.env.DSH_MEMORY_SELF_TEST === "1"),
	candidateTtlDays: Schema.number().min(1).max(90).default(14),
	maintenanceIntervalSeconds: Schema.number().min(60).max(86400).default(3600),
	extractionEnabled: Schema.boolean().default(process.env.DSH_MEMORY_EXTRACTION === "1"),
	extractionModel: Schema.string().default(process.env.DSH_MEMORY_EXTRACTION_MODEL || "deepseek-v4-flash"),
	extractionOfficialFallback: Schema.boolean().default(process.env.DSH_MEMORY_EXTRACTION_OFFICIAL !== "0"),
	extractionMaxContextChars: Schema.number().min(200).max(8e3).default(1500),
	extractionTimeoutMs: Schema.number().min(5e3).max(12e4).default(3e4),
	embeddingEnabled: Schema.boolean().default(process.env.DSH_MEMORY_EMBEDDING === "1"),
	embeddingModelDir: Schema.string().default(process.env.DSH_MEMORY_EMBEDDING_MODEL_DIR || ""),
	hybridRecallEnabled: Schema.boolean().default(process.env.DSH_MEMORY_HYBRID !== "0")
});
const inject = [
	"tools",
	"systemPrompt",
	"webServer",
	"credentials"
];
const name = "cyrus-memory";
/** 工具路由指引（order 150：工具指南带），让「记住/之前」类请求可靠路由到记忆工具。 */
const MEMORY_GUIDANCE_TEXT = [
	"长期记忆工具使用约定：",
	"- 用户说「记住…/记一下…」时，先做前置归类再写入：项目专属（客户/业务/项目架构/该项目坑）→ scope=project + kind=project_fact/event；跨项目通用（开发规范/通用教训/方法/偏好）→ scope=global_user + kind=global_fact/pattern/skill/user_profile；拿不准先 memory_classify 要建议。",
	"- 硬规则：project_fact/event/task 禁止写入 global_user（会被拒绝）；项目未登记时说明并询问，禁止擅自降级落全局。项目事故含通用教训时，主记录为项目 event，经用户同意另存全局 pattern。",
	"- 涉及「之前/上次/按约定/经验/坑」的提问，先 memory_summary 看紧凑摘要，需要细节再 memory_query。",
	"- memory_query/memory_summary 返回的是历史参考，可能过时；回答要带「这是历史记忆、可能过时」的口吻，并与当前事实核对。",
	"- P3 候选治理：自动提取的候选先经 memory_candidates 查看，memory_review 确认（confirm）或拒绝（reject）；14 天不处理自动过期。memory_pause(on=true) 可暂停自动候选与自动召回。",
	"- P3-2 自动提取（试点）：轮末自动从会话提取候选（≤2 条，text-only）；Project Control 控制台打开项目时自动绑定会话→项目，未绑定只提取全局 pattern 类。"
].join("\n");
const TEXT_OUTPUT = { type: "string" };
const renderText = (_args, value) => [{
	type: "text",
	text: String(value ?? "")
}];
function resolveDbRoot(config) {
	const configured = typeof config?.dbRoot === "string" ? config.dbRoot.trim() : "";
	if (configured !== "") return resolve(configured);
	const fromEnv = process.env.DSH_MEMORY_ROOT?.trim();
	if (fromEnv !== void 0 && fromEnv !== "") return resolve(fromEnv);
	return resolve(join(tmpdir(), "dsh-memory-dev"));
}
function lastUserText(events) {
	if (events === void 0) return "";
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type !== "user/message") continue;
		const parts = [];
		for (const block of event.content?.content ?? []) if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
		return parts.join("\n");
	}
	return "";
}
/** quick-pass 注入包：需求门 + 有界召回 + 不可信标记（ephemeral，不落历史）。 */
function buildQuickPassMessage(recallText, maxBytes) {
	const built = buildQuickPassText(recallText, maxBytes);
	if (built === null) return null;
	return {
		message: createUserMessage({
			content: [{
				type: "text",
				text: built.text
			}],
			source: {
				kind: "plugin",
				plugin: "cyrus-memory",
				form: "notice",
				summary: "memory quick-pass recall"
			}
		}),
		truncated: built.truncated
	};
}
function apply(ctx, config = {}) {
	const service = new MemoryService({
		dbRoot: resolveDbRoot(config),
		encrypted: config.encryptionEnabled === true,
		...config.candidateTtlDays === void 0 ? {} : { candidateTtlDays: config.candidateTtlDays }
	});
	if (config.selfTest === true) service.selfTest();
	ctx.systemPrompt.section({
		name: "tool:memory",
		order: 150,
		text: MEMORY_GUIDANCE_TEXT
	});
	const quickPassEnabled = config.quickPassEnabled === true;
	const quickPassMaxBytes = Math.max(200, Math.min(8e3, Number(config.quickPassMaxBytes ?? 2e3) || 2e3));
	const quickPassMaxItems = Math.max(1, Math.min(5, Number(config.quickPassMaxItems ?? 3) || 3));
	const maintenanceInterval = Math.max(60, Math.min(86400, Number(config.maintenanceIntervalSeconds ?? 3600) || 3600)) * 1e3;
	ctx.effect(() => {
		const timer = setInterval(() => {
			try {
				service.expireCandidates();
			} catch {}
		}, maintenanceInterval);
		timer.unref?.();
		return () => {
			clearInterval(timer);
			if (embedding.runtime !== null) embedding.runtime.close().catch(() => {});
			service.close();
		};
	}, "dsh-memory: maintenance + close service");
	const embeddingEnabled = config.embeddingEnabled === true;
	const hybridRecallEnabled = config.hybridRecallEnabled === true;
	const embeddingModelDir = typeof config.embeddingModelDir === "string" ? config.embeddingModelDir.trim() : "";
	const embedding = { runtime: null };
	let embeddingManifest = null;
	let embeddingManifestError = "";
	let embeddingGenerationValue = "";
	if (embeddingEnabled && embeddingModelDir !== "") {
		const manifest = readEmbeddingManifest(embeddingModelDir);
		if (manifest === null) embeddingManifestError = "MODEL_MANIFEST.json 缺失或形状非法";
		else {
			const verified = verifyEmbeddingManifest(embeddingModelDir, manifest, EMBEDDING_RUNTIME_VERSIONS, false);
			if (verified.ok === true && verified.generation !== void 0) {
				embeddingManifest = manifest;
				embeddingGenerationValue = verified.generation;
			} else embeddingManifestError = verified.error ?? "未知校验错误";
		}
	}
	const getEmbeddingRuntime = () => {
		if (embedding.runtime === null) {
			if (embeddingManifest === null) throw new Error("embedding manifest 无效：" + (embeddingManifestError || "未找到"));
			embedding.runtime = new EmbeddingRuntime({
				modelDir: embeddingModelDir,
				manifest: embeddingManifest,
				generation: embeddingGenerationValue
			});
		}
		return embedding.runtime;
	};
	const embeddingJobsStats = () => {
		if (!embeddingEnabled || embeddingManifest === null) return {
			pending: 0,
			ready: 0,
			failed: 0,
			stale: 0
		};
		const total = {
			pending: 0,
			ready: 0,
			failed: 0,
			stale: 0
		};
		for (const target of embeddingScopes(service)) try {
			const stats = service.embeddingStats(target.scope, target.projectId);
			total.pending += stats.pending;
			total.ready += stats.ready;
			total.failed += stats.failed;
			total.stale += stats.stale;
		} catch {}
		return total;
	};
	let drainRunning = false;
	let loggedEmbeddingReady = false;
	const embeddingLastDrain = {
		text: "未运行",
		at: ""
	};
	const drainOnce = () => {
		if (!embeddingEnabled || embeddingManifest === null || drainRunning) return;
		drainRunning = true;
		(async () => {
			try {
				const result = await drainEmbeddings(service, getEmbeddingRuntime(), {
					providerId: "local-onnx",
					modelId: embeddingManifest.modelId,
					modelRevision: embeddingManifest.source.revision,
					dimensions: embeddingManifest.dimensions,
					generation: embeddingGenerationValue,
					contentHashOf: (text) => normalizedHash(text)
				});
				embeddingLastDrain.text = "seen " + String(result.seen) + " → embedded " + String(result.embedded) + " / failed " + String(result.failed) + " / skipped " + String(result.skipped) + " / retired " + String(result.retired);
				embeddingLastDrain.at = (/* @__PURE__ */ new Date()).toISOString();
				if (!loggedEmbeddingReady && embedding.runtime !== null && embedding.runtime.stateText() === "ready") {
					loggedEmbeddingReady = true;
					console.log("[dsh-memory] 向量嵌入 worker 就绪（" + embeddingManifest.modelId + "，generation " + embeddingGenerationValue + "）");
				}
			} catch (error) {
				embeddingLastDrain.text = "失败：" + (error instanceof Error && error.message !== "" ? error.message : String(error));
				embeddingLastDrain.at = (/* @__PURE__ */ new Date()).toISOString();
				console.warn("[dsh-memory] 嵌入回填失败：" + embeddingLastDrain.text);
			} finally {
				drainRunning = false;
			}
		})();
	};
	if (embeddingEnabled && embeddingManifest !== null) ctx.effect(() => {
		const first = setTimeout(() => {
			drainOnce();
		}, 3e3);
		const timer = setInterval(() => {
			drainOnce();
		}, 3e4);
		first.unref?.();
		timer.unref?.();
		return () => {
			clearTimeout(first);
			clearInterval(timer);
		};
	}, "dsh-memory: embedding backfill drain");
	const projectBindings = /* @__PURE__ */ new Map();
	ctx.effect(() => {
		const unregister = ctx.webServer.register({
			kind: "prefix",
			path: MEMORY_CONTEXT_API_PREFIX,
			handler: createMemoryContextRequestHandler({
				service,
				bindings: projectBindings
			})
		});
		return () => {
			unregister();
		};
	}, "dsh-memory: project context bridge");
	const extractionStats = {
		paused: 0,
		gateSkip: 0,
		noConnection: 0,
		ok: 0,
		failed: 0,
		lastDetail: "暂无"
	};
	if (config.extractionEnabled === true) {
		const extractionModel = typeof config.extractionModel === "string" && config.extractionModel.trim() !== "" ? config.extractionModel.trim() : process.env.DSH_MEMORY_EXTRACTION_MODEL || "deepseek-chat";
		const extractionMaxContextChars = Math.max(200, Math.min(8e3, Number(config.extractionMaxContextChars ?? 1500) || 1500));
		const extractionTimeoutMs = Math.max(5e3, Math.min(12e4, Number(config.extractionTimeoutMs ?? 3e4) || 3e4));
		let runtimePromise = null;
		const extractor = createTurnEndExtractor({
			service,
			runtime: () => {
				runtimePromise ??= openExtractionRuntime(ctx.credentials, config.extractionOfficialFallback !== false);
				return runtimePromise;
			},
			bindings: projectBindings,
			model: extractionModel,
			maxContextChars: extractionMaxContextChars,
			timeoutMs: extractionTimeoutMs,
			disableThinking: true,
			onOutcome: (outcome) => {
				extractionStats.lastDetail = outcome.detail;
				if (outcome.kind === "paused") extractionStats.paused += 1;
				else if (outcome.kind === "gate-skip") extractionStats.gateSkip += 1;
				else if (outcome.kind === "no-connection") extractionStats.noConnection += 1;
				else if (outcome.kind === "ok") extractionStats.ok += 1;
				else extractionStats.failed += 1;
				if (outcome.kind === "failed") console.warn("[dsh-memory] 自动候选提取失败：" + outcome.detail);
			}
		});
		ctx.on("session/event", (session, event) => {
			extractor.onEvent(session, event);
		});
	}
	if (quickPassEnabled) ctx.on("agent/pre-step", async (payload, next) => {
		const decision = await next();
		try {
			if (service.isPaused()) return decision;
			const text = lastUserText(payload.agent?.session?.events);
			if (!needsMemory(text)) return decision;
			const built = buildQuickPassMessage(service.query({
				q: text,
				limit: quickPassMaxItems
			}), quickPassMaxBytes);
			if (built === null) return decision;
			return {
				...decision,
				messages: [...decision.messages ?? [], built.message]
			};
		} catch {
			return decision;
		}
	});
	const tools = ctx.tools;
	tools.register(defineTool({
		name: "memory_record",
		description: "记录一条长期记忆。scope=global_user 为跨项目用户偏好；scope=project 需要已登记的 project_id。首次写入为候选（candidate），回传 confirm=true 确认写入。敏感内容（凭据/身份证/银行卡）会被硬拒绝。",
		parameters: {
			kind: {
				type: "string",
				required: true,
				enum: [
					"event",
					"project_fact",
					"global_fact",
					"user_profile",
					"skill",
					"task",
					"pattern"
				],
				description: "记忆类型白名单"
			},
			text: {
				type: "string",
				required: true,
				description: "记忆内容（1–3 句，≤4000 字符）"
			},
			scope: {
				type: "string",
				required: true,
				enum: ["global_user", "project"],
				description: "归属范围"
			},
			project_id: {
				type: "string",
				description: "scope=project 时必填；必须是已登记项目"
			},
			evidence: {
				type: "string",
				description: "可选来源说明（locator 或用户确认描述）"
			},
			confirm: {
				type: "boolean",
				description: "true = 确认写入（active + user_confirmed）；缺省为候选"
			}
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 1e4,
		async execute(args) {
			return service.record({
				kind: args.kind,
				text: args.text,
				scope: args.scope,
				projectId: args.project_id,
				evidence: args.evidence,
				confirm: args.confirm
			});
		}
	}));
	tools.register(defineTool({
		name: "memory_query",
		description: "按关键词检索长期记忆（FTS5，scope 硬过滤，不跨项目）。结果标记为不可信历史参考，不得当作当前事实。",
		parameters: {
			q: {
				type: "string",
				required: true,
				description: "查询文本"
			},
			scope: {
				type: "string",
				enum: ["global_user", "project"],
				description: "缺省：有 project_id 则按项目，否则 global_user"
			},
			project_id: {
				type: "string",
				description: "项目范围"
			},
			limit: {
				type: "integer",
				description: "1–10，缺省 5"
			}
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 3e4,
		async execute(args) {
			const q = String(args.q ?? "");
			const base = {
				q,
				scope: args.scope,
				projectId: args.project_id,
				limit: args.limit
			};
			if (hybridRecallEnabled && embeddingManifest !== null && q.trim() !== "") try {
				const query = await getEmbeddingRuntime().embed([q], "query");
				const scope = args.scope === "project" || args.project_id !== void 0 && args.project_id !== "" ? "project" : "global_user";
				const docs = service.activeEmbeddingVectors(scope, args.project_id, embeddingGenerationValue);
				const { ranked, topScore } = vectorCandidates(query.vectors, docs);
				if (ranked.length === 0) return service.query(base);
				return service.query({
					...base,
					vectorRanked: ranked,
					vectorTopScore: topScore
				});
			} catch {
				return service.query(base);
			}
			return service.query(base);
		}
	}));
	tools.register(defineTool({
		name: "memory_classify",
		description: "前置归类建议（只读，不写入）：判断一条「记住」内容应是项目级还是全局、该用什么 kind，并给出理由与可选的双记录建议。",
		parameters: {
			text: {
				type: "string",
				required: true,
				description: "用户想记住的内容原文"
			},
			project_hint: {
				type: "string",
				description: "若已知所属项目（名称或 project_id），传进来提高准确度"
			}
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 1e4,
		async execute(args) {
			const suggestion = classifyRecordIntent(args.text, args.project_hint);
			const lines = [
				"归类建议（未写入）：",
				"scope: " + suggestion.scope + "  kind: " + suggestion.kind,
				"理由: " + suggestion.reason
			];
			if (suggestion.dual !== void 0) lines.push("可另存第二条：scope: " + suggestion.dual.scope + "  kind: " + suggestion.dual.kind + "（" + suggestion.dual.reason + "）");
			return lines.join("\n");
		}
	}));
	tools.register(defineTool({
		name: "memory_summary",
		description: "渐进披露第一层：紧凑摘要（active 计数、重要条目、最近更新、冲突对，≤4KB）。先看摘要，需要细节再用 memory_query。",
		parameters: {
			scope: {
				type: "string",
				enum: ["global_user", "project"],
				description: "缺省：有 project_id 则按项目，否则 global_user"
			},
			project_id: { type: "string" },
			limit: {
				type: "integer",
				description: "重要条目数 1–10，缺省 5"
			}
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 1e4,
		async execute(args) {
			return service.summary({
				scope: args.scope,
				projectId: args.project_id,
				limit: args.limit
			});
		}
	}));
	tools.register(defineTool({
		name: "memory_pause",
		description: "暂停/恢复自动候选与自动召回（quick-pass）。on=true 暂停，on=false 恢复。仅影响自动行为，显式 memory_record/query 不受影响。",
		parameters: { on: {
			type: "boolean",
			required: true,
			description: "true = 暂停自动候选与自动召回；false = 恢复"
		} },
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 1e4,
		async execute(args) {
			return service.setPaused(args.on === true) ? "已暂停自动候选与自动召回（显式记录/查询不受影响）。" : "已恢复自动候选与自动召回。";
		}
	}));
	tools.register(defineTool({
		name: "memory_candidates",
		description: "列出待处理候选记忆（status=candidate，最老优先，含到期时间）。配合 memory_review 确认或拒绝；14 天不处理自动过期。",
		parameters: {
			scope: {
				type: "string",
				enum: ["global_user", "project"],
				description: "缺省：有 project_id 则按项目，否则 global_user"
			},
			project_id: { type: "string" },
			limit: {
				type: "integer",
				description: "1–50，缺省 10"
			}
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 1e4,
		async execute(args) {
			return service.listCandidates({
				scope: args.scope,
				projectId: args.project_id,
				limit: args.limit
			});
		}
	}));
	tools.register(defineTool({
		name: "memory_review",
		description: "评审一条候选：decision=confirm 转为 active + user_confirmed；decision=reject 归档（退出候选队列与默认召回）。会写入 promotion 评审记录。",
		parameters: {
			id: {
				type: "string",
				required: true,
				description: "候选 id（来自 memory_candidates）"
			},
			decision: {
				type: "string",
				required: true,
				enum: ["confirm", "reject"]
			},
			scope: {
				type: "string",
				enum: ["global_user", "project"],
				description: "候选所在范围；缺省：有 project_id 则按项目，否则 global_user"
			},
			project_id: { type: "string" },
			rationale: {
				type: "string",
				description: "可选评审理由（≤500 字符）"
			}
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 1e4,
		async execute(args) {
			return service.reviewCandidate({
				id: args.id,
				decision: args.decision === "reject" ? "reject" : "confirm",
				scope: args.scope,
				projectId: args.project_id,
				rationale: args.rationale
			});
		}
	}));
	tools.register(defineTool({
		name: "memory_list",
		description: "列出记忆条目（可按 kind/status 过滤）。",
		parameters: {
			scope: {
				type: "string",
				enum: ["global_user", "project"],
				description: "缺省：有 project_id 则按项目，否则 global_user"
			},
			project_id: { type: "string" },
			kind: { type: "string" },
			status: {
				type: "string",
				enum: [
					"candidate",
					"active",
					"disputed",
					"superseded",
					"archived"
				]
			},
			limit: {
				type: "integer",
				description: "1–50，缺省 20"
			}
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 1e4,
		async execute(args) {
			return service.list({
				scope: args.scope,
				projectId: args.project_id,
				kind: args.kind,
				status: args.status,
				limit: args.limit
			});
		}
	}));
	tools.register(defineTool({
		name: "memory_status",
		description: "记忆库健康状态：目录、分片、schemaVersion、active 条数、FTS 行数、自动提取统计（P3-2）。",
		parameters: { verbose: {
			type: "boolean",
			description: "true 时输出各分片条目数明细"
		} },
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 1e4,
		async execute() {
			return service.status() + "\n" + renderExtractionStats(config, extractionStats, extractionModelText(config)) + "\n" + renderEmbeddingStatus({
				enabled: embeddingEnabled,
				modelDir: embeddingModelDir,
				manifest: embeddingManifest === null ? null : {
					modelId: embeddingManifest.modelId,
					dimensions: embeddingManifest.dimensions,
					dtype: embeddingManifest.dtype,
					pooling: embeddingManifest.pooling
				},
				manifestError: embeddingManifestError,
				generation: embeddingGenerationValue,
				workerState: embedding.runtime === null ? "未加载（首次嵌入时懒加载）" : embedding.runtime.stateText(),
				workerError: embedding.runtime === null ? "" : embedding.runtime.lastErrorText(),
				jobs: embeddingJobsStats(),
				hybridEnabled: hybridRecallEnabled,
				lastDrain: embeddingLastDrain.at === "" ? "未运行" : embeddingLastDrain.text + "（" + embeddingLastDrain.at.slice(11, 19) + "）"
			});
		}
	}));
	tools.register(defineTool({
		name: "memory_explain",
		description: "解释某条记忆：来源证据、状态、提升记录、被召回次数。",
		parameters: { id: {
			type: "string",
			required: true,
			description: "条目 id"
		} },
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 1e4,
		async execute(args) {
			return service.explain(args.id);
		}
	}));
	tools.register(defineTool({
		name: "memory_correct",
		description: "修正一条记忆：写入新条目（active + user_confirmed）并让旧条目 superseded，保留取代链。",
		parameters: {
			id: {
				type: "string",
				required: true
			},
			corrected_text: {
				type: "string",
				required: true,
				description: "修正后的内容（≤4000 字符）"
			}
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 1e4,
		async execute(args) {
			return service.correct(args.id, args.corrected_text);
		}
	}));
	const resetTokens = /* @__PURE__ */ new Map();
	tools.register(defineTool({
		name: "memory_reset_project",
		description: "项目级重置：preview 看条目构成并生成确认令牌；execute 回传令牌与 mode（archive=全部转归档保留审计 / delete=逐条 tombstone 后物理删除，不可逆）完成重置。项目必须先登记。",
		parameters: {
			action: {
				type: "string",
				required: true,
				enum: ["preview", "execute"],
				description: "preview=预览并生成令牌；execute=执行"
			},
			project_id: {
				type: "string",
				required: true,
				description: "项目 id（必须已登记）"
			},
			mode: {
				type: "string",
				enum: ["archive", "delete"],
				description: "execute 时必填：archive 或 delete"
			},
			confirm_token: {
				type: "string",
				description: "execute 时必填：preview 返回的令牌"
			},
			reason: {
				type: "string",
				description: "可选：重置原因（进审计回执）"
			}
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 3e4,
		async execute(args) {
			const projectId = String(args.project_id ?? "").trim();
			if (projectId === "") throw new Error("必须提供 project_id。");
			if (args.action === "preview") {
				const preview = service.resetProjectPreview(projectId);
				const token = randomBytes(6).toString("hex");
				resetTokens.set(projectId, {
					token,
					expiresAt: Date.now() + 10 * 6e4
				});
				return [
					"项目重置预览（project: " + projectId + "）：",
					"  条目总数 " + String(preview.total) + "（active " + String(preview.active) + " / candidate " + String(preview.candidates) + " / archived " + String(preview.archived) + " / tombstones " + String(preview.tombstones) + "）",
					"确认令牌：" + token + "（10 分钟内有效）",
					"执行：再次调用 memory_reset_project，action=execute，回传 project_id / confirm_token / mode（archive 或 delete）。",
					"警告：delete 不可逆（逐条 tombstone 后物理删除）；archive 保留审计可追溯。"
				].join("\n");
			}
			const mode = args.mode === "delete" ? "delete" : "archive";
			const token = String(args.confirm_token ?? "").trim();
			const held = resetTokens.get(projectId);
			if (token === "" || held === void 0 || held.token !== token || held.expiresAt < Date.now()) throw new Error("确认令牌无效或已过期：先 action=preview 获取新令牌。");
			resetTokens.delete(projectId);
			return service.resetProject(projectId, {
				mode,
				confirmToken: token,
				...args.reason === void 0 ? {} : { reason: String(args.reason) }
			});
		}
	}));
	tools.register(defineTool({
		name: "memory_archive",
		description: "归档一条记忆（退出默认召回，保留审计；不可逆语义与删除不同）。",
		parameters: {
			id: {
				type: "string",
				required: true
			},
			reason: {
				type: "string",
				description: "归档原因（进审计）"
			}
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 1e4,
		async execute(args) {
			return service.archive(args.id, args.reason);
		}
	}));
	tools.register(defineTool({
		name: "memory_export",
		description: "导出记忆包（JSONL + manifest + 哈希；evidence.local_locator 一律省略）。",
		parameters: {
			scope: {
				type: "string",
				enum: ["global_user", "project"],
				description: "缺省：有 project_id 则按项目，否则 global_user"
			},
			project_id: { type: "string" }
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 3e4,
		async execute(args) {
			return service.exportPackage({
				scope: args.scope,
				projectId: args.project_id
			});
		}
	}));
	tools.register(defineTool({
		name: "memory_import_codex",
		description: "从 Codex 历史 staging 包提取候选记忆（食溯试点）。默认 dry_run=true：零成本零写入，只报抽样/批次/成本预估；dry_run=false 时按项目写入候选队列（candidate + llm_extracted，带 codex:// 证据），有成本硬上限与空闲时段闸门。",
		parameters: {
			package_dir: {
				type: "string",
				required: true,
				description: "codex-import dry-run 输出包目录（含 sessions.jsonl / turn-index.jsonl）"
			},
			project_id: {
				type: "string",
				description: "dry_run=false 时必填：目标项目 id（已登记）"
			},
			sample: {
				type: "integer",
				description: "抽样会话数，缺省 20（1–100）"
			},
			budget_yuan: {
				type: "number",
				description: "成本硬上限（元），缺省 0.5（0.1–5）"
			},
			dry_run: {
				type: "boolean",
				description: "true=只预演（默认）；false=正式提取并写入候选"
			},
			off_peak_only: {
				type: "boolean",
				description: "只在空闲时段执行（默认 true，高峰自动暂停）"
			}
		},
		output: {
			schema: TEXT_OUTPUT,
			render: renderText
		},
		timeoutMs: 6e5,
		async execute(args) {
			const packageDir = String(args.package_dir ?? "").trim();
			if (packageDir === "" || !existsSync(packageDir)) throw new Error("package_dir 无效：先跑 scripts/codex-import-dryrun.mjs 生成 staging 包。");
			const { sessions, turns } = readStagingPackage(packageDir);
			const sampled = sampleSessions(sessions, {
				projectLabel: "食溯(mealtracker)",
				count: Math.min(Math.max(Number(args.sample ?? 20) || 20, 1), 100)
			});
			const batches = buildBatches(sampled, turns);
			const estCalls = batches.length;
			const estChars = batches.reduce((sum, batch) => sum + batch.chars, 0);
			const estYuan = callCostYuan({
				missIn: Math.round(estChars * .6) + estCalls * 800,
				out: estCalls * 400
			});
			const lines = [
				"Codex 历史提取（试点批次，食溯）：",
				"  抽样会话：" + String(sampled.length) + " / 预计调用：" + String(estCalls),
				"  源码字符：" + String(estChars) + " / 预计成本：￥" + estYuan.toFixed(2) + "（空闲时段官方价；缓存命中只会更低）",
				"  预计候选：" + String(Math.round(estCalls * 2.5)) + " 条（全部 candidate，人工确认后才 active）"
			];
			if (args.dry_run !== false) {
				lines.push("dry-run：未调用模型、未写记忆库。");
				return lines.join("\n");
			}
			const projectId = String(args.project_id ?? "").trim();
			if (projectId === "") throw new Error("正式提取必须提供 project_id（fail closed）。");
			if (!service.listRegisteredProjects().includes(projectId)) throw new Error("项目 " + projectId + " 未在记忆库登记（fail closed）：先经 Project Control 注册项目身份，或用已登记 project_id 重试。");
			const key = await resolveCredential(ctx.credentials, "DEEPSEEK_API_KEY") ?? process.env.DEEPSEEK_API_KEY;
			if (key === void 0) throw new Error("未解析到 DEEPSEEK_API_KEY，无法调用提取模型。");
			const budget = Math.min(Math.max(Number(args.budget_yuan ?? .5) || .5, .1), 5);
			const connection = officialExtractionConnection(key, process.env.DEEPSEEK_BASE_URL);
			if (connection === null) throw new Error("官方回退连接不可用。");
			const result = await runExtraction({
				endpoint: connection.endpoint,
				apiKey: connection.apiKey,
				projectId,
				batches,
				readText: locatorTextReader(packageDir),
				budgetYuan: budget,
				offPeakOnly: args.off_peak_only !== false,
				checkpointFile: join(packageDir, "extract-state.json")
			});
			let written = 0;
			for (const candidate of result.candidates) {
				const kind = [
					"project_fact",
					"event",
					"pattern"
				].includes(candidate.kind) ? candidate.kind : "event";
				try {
					service.record({
						kind,
						text: candidate.text,
						scope: "project",
						projectId,
						confirm: false,
						evidence: candidate.locator,
						evidenceKind: "session",
						...candidate.factualAt === void 0 ? {} : { factualAt: candidate.factualAt }
					});
					written += 1;
				} catch {}
			}
			lines.push("正式提取：调用 " + String(result.calls) + " / 实际成本 ￥" + result.spentYuan.toFixed(3) + " / 候选产出 " + String(result.candidates.length) + " / 写入候选队列 " + String(written) + " / 停止原因 " + result.stopped + (result.error === void 0 ? "" : "（" + result.error + "）"));
			return lines.join("\n");
		}
	}));
}
async function openExtractionRuntime(credentials, officialFallback) {
	const store = new (await (loadFoundationStoreConstructor()))(join(resolve(process.env.DSH_HOME || join(homedir(), ".dsh")), "personal", "personal-suite.json"));
	return { findConnection: async () => {
		const fromStore = await findExtractionConnection(store, credentials);
		if (fromStore !== null) return fromStore;
		if (!officialFallback) return null;
		return officialExtractionConnection(await resolveCredential(credentials, "DEEPSEEK_API_KEY") ?? process.env.DEEPSEEK_API_KEY, process.env.DEEPSEEK_BASE_URL);
	} };
}
/** 取第一个已启用且密钥齐备的「记忆提取」连接（决策②：独立连接，不与其他插件混用）。 */
async function findExtractionConnection(store, credentials) {
	const document = await store.read();
	for (const stored of document.connections) {
		if (stored.kind !== "memory-extraction" || !stored.enabled) continue;
		const [endpoint, apiKey] = await Promise.all([resolveCredential(credentials, stored.endpointRef), resolveCredential(credentials, stored.secretRef)]);
		if (endpoint !== void 0 && apiKey !== void 0) return {
			endpoint,
			apiKey,
			label: stored.label
		};
	}
	return null;
}
async function resolveCredential(credentials, reference) {
	try {
		return (await credentials.resolve(reference))?.value;
	} catch {
		return;
	}
}
function extractionModelText(config) {
	return typeof config.extractionModel === "string" && config.extractionModel.trim() !== "" ? config.extractionModel.trim() : process.env.DSH_MEMORY_EXTRACTION_MODEL || "deepseek-v4-flash";
}
function renderExtractionStats(config, stats, model) {
	if (config.extractionEnabled !== true) return "自动提取（P3-2）：未开启（extractionEnabled=false）。";
	return [
		"自动提取（P3-2）：已开启（模型 " + model + "，关思考，官方密钥回退 " + (config.extractionOfficialFallback === false ? "关" : "开") + "）",
		"  统计：成功 " + String(stats.ok) + " / 失败 " + String(stats.failed) + " / 需求门跳过 " + String(stats.gateSkip) + " / 暂停跳过 " + String(stats.paused) + " / 无连接跳过 " + String(stats.noConnection),
		"  最近结果：" + stats.lastDetail
	].join("\n");
}
//#endregion
export { Config, MEMORY_GUIDANCE_TEXT, apply, buildQuickPassMessage, inject, name, resolveDbRoot };
