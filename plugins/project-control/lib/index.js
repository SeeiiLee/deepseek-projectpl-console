import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, parse, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
//#region src/host/errors.js
var ProjectControlStorageError = class extends Error {
	constructor(code, message, details = void 0, options = void 0) {
		super(message, options);
		this.name = new.target.name;
		this.code = code;
		this.details = details;
	}
};
var InvalidStoragePathError = class extends ProjectControlStorageError {
	constructor(message, details) {
		super("INVALID_STORAGE_PATH", message, details);
	}
};
var WriterLockError = class extends ProjectControlStorageError {
	constructor(lockPath, options = void 0) {
		super("WRITER_ALREADY_ACTIVE", `Project Control writer lock is already held: ${lockPath}`, { lockPath }, options);
	}
};
var MigrationError = class extends ProjectControlStorageError {};
var MigrationChecksumError = class extends MigrationError {
	constructor(version, expectedChecksum, actualChecksum) {
		super("MIGRATION_CHECKSUM_MISMATCH", `Applied migration ${version} no longer matches its immutable checksum.`, {
			version,
			expectedChecksum,
			actualChecksum
		});
	}
};
var MigrationVersionError = class extends MigrationError {
	constructor(version) {
		super("MIGRATION_VERSION_UNSUPPORTED", `Database contains migration ${version}, which is not available to this build.`, { version });
	}
};
var UntrackedDatabaseError = class extends MigrationError {
	constructor(databasePath) {
		super("UNTRACKED_DATABASE", "Refusing to migrate a non-empty database without schema_migrations history.", { databasePath });
	}
};
var IdempotencyConflictError = class extends ProjectControlStorageError {
	constructor(details) {
		super("IDEMPOTENCY_CONFLICT", "The command identity or idempotency key was already used with a different full request.", details);
	}
};
var StorageValidationError = class extends ProjectControlStorageError {
	constructor(message, details = void 0) {
		super("STORAGE_INPUT_INVALID", message, details);
	}
};
//#endregion
//#region src/host/canonical-json.js
function normalizeJson(value, seen, path) {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new StorageValidationError("Command request contains a non-finite number.", { path });
		return Object.is(value, -0) ? 0 : value;
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) throw new StorageValidationError("Command request contains a cycle.", { path });
		seen.add(value);
		const normalized = value.map((item, index) => {
			if (item === void 0 || typeof item === "function" || typeof item === "symbol") throw new StorageValidationError("Command request is not lossless JSON.", { path: `${path}[${index}]` });
			return normalizeJson(item, seen, `${path}[${index}]`);
		});
		seen.delete(value);
		return normalized;
	}
	if (typeof value !== "object") throw new StorageValidationError("Command request is not a JSON value.", { path });
	if (seen.has(value)) throw new StorageValidationError("Command request contains a cycle.", { path });
	seen.add(value);
	const normalized = {};
	for (const key of Object.keys(value).sort()) {
		const child = value[key];
		if (child === void 0 || typeof child === "function" || typeof child === "symbol") throw new StorageValidationError("Command request is not lossless JSON.", { path: `${path}.${key}` });
		normalized[key] = normalizeJson(child, seen, `${path}.${key}`);
	}
	seen.delete(value);
	return normalized;
}
function canonicalJson(value) {
	return JSON.stringify(normalizeJson(value, /* @__PURE__ */ new Set(), "$"));
}
function requestSha256(value) {
	return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
//#endregion
//#region src/host/migrations.js
const MIGRATION_FILE = /^(\d{4})_([a-z0-9][a-z0-9_-]*)\.sql$/;
function sha256$4(contents) {
	return createHash("sha256").update(contents).digest("hex");
}
function loadMigrations(migrationsDirectory) {
	const migrations = readdirSync(migrationsDirectory, { withFileTypes: true }).filter((entry) => entry.isFile() && MIGRATION_FILE.test(entry.name)).map((entry) => {
		const match = MIGRATION_FILE.exec(entry.name);
		const contents = readFileSync(join(migrationsDirectory, entry.name));
		return Object.freeze({
			version: Number.parseInt(match[1], 10),
			name: match[2],
			fileName: entry.name,
			sql: contents.toString("utf8"),
			checksum: sha256$4(contents)
		});
	}).sort((left, right) => left.version - right.version);
	if (migrations.length === 0) throw new MigrationError("MIGRATIONS_MISSING", `No Project Control migrations were found in ${migrationsDirectory}.`);
	for (let index = 0; index < migrations.length; index += 1) {
		const expectedVersion = index + 1;
		if (migrations[index].version !== expectedVersion) throw new MigrationError("MIGRATION_SEQUENCE_INVALID", `Expected migration ${expectedVersion.toString().padStart(4, "0")}, found ${migrations[index].fileName}.`, {
			expectedVersion,
			actualVersion: migrations[index].version
		});
	}
	return migrations;
}
function hasMigrationTable(database) {
	return Boolean(database.prepare(`
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `).get());
}
function hasUserTables(database) {
	return Boolean(database.prepare(`
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> 'schema_migrations'
      LIMIT 1
    `).get());
}
function readAppliedMigrations(database) {
	if (!hasMigrationTable(database)) return [];
	return database.prepare(`
    SELECT version, name, checksum, applied_at AS appliedAt, app_version AS appVersion
    FROM schema_migrations
    ORDER BY version
  `).all();
}
function validateAppliedMigrations(applied, available) {
	const availableByVersion = new Map(available.map((migration) => [migration.version, migration]));
	for (const row of applied) {
		const migration = availableByVersion.get(Number(row.version));
		if (!migration) throw new MigrationVersionError(Number(row.version));
		if (row.checksum !== migration.checksum) throw new MigrationChecksumError(Number(row.version), row.checksum, migration.checksum);
	}
}
function backupFileName(databasePath, currentVersion, now) {
	const stamp = now().replaceAll(/[-:.]/g, "");
	return `${basename(databasePath)}.pre-v${currentVersion + 1}.${stamp}.sqlite3`;
}
async function migrateDatabase({ database, databasePath, databaseExisted, backupDirectory, migrationsDirectory, applicationVersion, now }) {
	const migrations = loadMigrations(migrationsDirectory);
	if (!hasMigrationTable(database) && hasUserTables(database)) throw new UntrackedDatabaseError(databasePath);
	const applied = readAppliedMigrations(database);
	validateAppliedMigrations(applied, migrations);
	const appliedVersions = new Set(applied.map((row) => Number(row.version)));
	const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));
	if (pending.length === 0) return Object.freeze({
		applied: [],
		backupPath: null,
		currentVersion: applied.at(-1)?.version ?? 0
	});
	let backupPath = null;
	if (databaseExisted && statSync(databasePath).size > 0) {
		mkdirSync(backupDirectory, { recursive: true });
		backupPath = join(backupDirectory, backupFileName(databasePath, Number(applied.at(-1)?.version ?? 0), now));
		if (existsSync(backupPath)) throw new MigrationError("MIGRATION_BACKUP_EXISTS", "Migration backup path already exists.", { backupPath });
		await backup(database, backupPath);
	}
	database.exec("BEGIN IMMEDIATE");
	try {
		for (const migration of pending) {
			database.exec(migration.sql);
			database.prepare(`
        INSERT INTO schema_migrations(version, name, checksum, applied_at, app_version)
        VALUES (?, ?, ?, ?, ?)
      `).run(migration.version, migration.name, migration.checksum, now(), applicationVersion);
		}
		database.exec("COMMIT");
	} catch (error) {
		try {
			database.exec("ROLLBACK");
		} catch {}
		throw new MigrationError("MIGRATION_FAILED", `Project Control migration failed; the pre-migration backup was kept at ${backupPath ?? "(new database)"}.`, {
			backupPath,
			causeMessage: error instanceof Error ? error.message : String(error)
		}, { cause: error });
	}
	return Object.freeze({
		applied: pending.map(({ version, name, checksum }) => ({
			version,
			name,
			checksum
		})),
		backupPath,
		currentVersion: pending.at(-1).version
	});
}
//#endregion
//#region src/host/ids.js
function createPrefixedUuidV7(prefix, options = {}) {
	if (!/^[a-z][a-z0-9]{1,7}$/.test(prefix)) throw new StorageValidationError("Business ID prefix is invalid.", { prefix });
	const nowMs = options.nowMs ?? Date.now();
	if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffffffff) throw new StorageValidationError("UUIDv7 timestamp is outside the 48-bit range.");
	const entropy = options.randomBytes ?? randomBytes(10);
	if (!(entropy instanceof Uint8Array) || entropy.length !== 10) throw new StorageValidationError("UUIDv7 entropy must contain exactly 10 bytes.");
	const bytes = new Uint8Array(16);
	let timestamp = BigInt(nowMs);
	for (let index = 5; index >= 0; index -= 1) {
		bytes[index] = Number(timestamp & 255n);
		timestamp >>= 8n;
	}
	bytes[6] = 112 | entropy[0] & 15;
	bytes[7] = entropy[1];
	bytes[8] = 128 | entropy[2] & 63;
	bytes.set(entropy.subarray(3), 9);
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${prefix}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
//#endregion
//#region src/host/writer-lock.js
function acquireWriterLock({ lockPath, instanceId, acquiredAt }) {
	mkdirSync(dirname(lockPath), { recursive: true });
	const database = new DatabaseSync(lockPath, { timeout: 0 });
	let transactionOpen = false;
	try {
		database.exec("PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 0;");
		database.exec(`
      CREATE TABLE IF NOT EXISTS writer_lock_owner (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        instance_id TEXT,
        process_id INTEGER,
        acquired_at TEXT
      ) STRICT;
      INSERT OR IGNORE INTO writer_lock_owner(singleton) VALUES (1);
    `);
		database.exec("BEGIN EXCLUSIVE");
		transactionOpen = true;
		database.prepare(`
      UPDATE writer_lock_owner
      SET instance_id = ?, process_id = ?, acquired_at = ?
      WHERE singleton = 1
    `).run(instanceId, process.pid, acquiredAt);
	} catch (error) {
		if (transactionOpen) try {
			database.exec("ROLLBACK");
		} catch {}
		try {
			database.close();
		} catch {}
		throw new WriterLockError(lockPath, { cause: error });
	}
	let released = false;
	return Object.freeze({
		lockPath,
		release() {
			if (released) return;
			released = true;
			try {
				database.exec("ROLLBACK");
			} finally {
				database.close();
			}
		}
	});
}
//#endregion
//#region src/host/storage.js
const PROTOCOL_VERSION$1 = "project-control.dsh/v1alpha1";
const RESULT_SCHEMA_VERSION = "lifecycle-command-result/v1alpha1";
const EVENT_SCHEMA_VERSION = "lifecycle-normalized-event/v1alpha1";
const EXTERNAL_EVENT_SCHEMA_VERSION$1 = "normalized-event/v1alpha1";
const EXTERNAL_RESULT_SCHEMA_VERSION = "command-result/v1alpha1";
const OUTBOX_DESTINATION = "project-control.lifecycle.events";
const DEFAULT_MIGRATIONS_DIRECTORIES = [fileURLToPath(new URL("../migrations/", import.meta.url)), fileURLToPath(new URL("../../migrations/", import.meta.url))];
function defaultMigrationsDirectory() {
	return DEFAULT_MIGRATIONS_DIRECTORIES.find((candidate) => existsSync(candidate)) ?? DEFAULT_MIGRATIONS_DIRECTORIES[0];
}
const SUPPORTED_REGISTER_KINDS = new Set(["project.registerLegacy", "project.registerManaged"]);
const EVENT_ID$1 = /^evt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTENT_HASH$1 = /^sha256:[0-9a-f]{64}$/;
const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9.-]{1,127}$/;
const TEMPLATE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const DOCUMENT_ROLES$3 = new Set([
	"readme",
	"prd",
	"devlog",
	"progress",
	"next",
	"current_architecture",
	"decision",
	"other"
]);
const RELATIVE_PATH$1 = /^(?!\/)(?!.*[:\\])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\u0000-\u001F\u007F])(?!.*\/\/)(?!.*\/$)[^/]+(?:\/[^/]+)*$/;
const BUSINESS_IDS = Object.freeze({
	src: /^src_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	job: /^job_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	can: /^can_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	doc: /^doc_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	iss: /^iss_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	jis: /^jis_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	loc: /^loc_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	srt: /^srt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	pln: /^pln_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	cmd: /^cmd_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	prj: /^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	rbd: /^rbd_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	wrk: /^wrk_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	run: /^run_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	rev: /^rev_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	rva: /^rva_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	dec: /^dec_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	atb: /^atb_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	upd: /^upd_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	qtn: /^qtn_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	out: /^out_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
});
const INTAKE_SCOPE = "project-control.lifecycle";
const CANDIDATE_STATES = new Set([
	"discovered",
	"conflict",
	"relocation_candidate"
]);
const MAX_SCAN_CANDIDATES = 500;
const MAX_CANDIDATE_DOCUMENTS = 200;
const MAX_CANDIDATE_ISSUES = 200;
const MAX_JOB_ISSUES = 500;
const MAX_SCAN_DOCUMENTS = 1e4;
const MAX_SCAN_ISSUES = 5e3;
const DOCUMENT_INDEX_STATES = new Set([
	"ok",
	"changed",
	"missing",
	"unreadable"
]);
const PARSE_ISSUE_SEVERITIES = new Set([
	"info",
	"warning",
	"error",
	"blocking"
]);
const MAX_INDEX_DOCUMENTS = 200;
const MAX_INDEX_PARSE_ISSUES = 20;
const MAX_REBIND_PROPOSALS = 50;
const MAX_REBIND_CANDIDATES = 50;
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const EXTERNAL_UPDATE_KINDS = new Set([
	"progress.report",
	"blocker.raise",
	"completion.declare"
]);
const EXTERNAL_EVENT_TYPES$1 = Object.freeze({
	"progress.report": "progress.recorded",
	"blocker.raise": "blocker.raised",
	"completion.declare": "completion.declared"
});
const WORK_ITEM_STATUSES = new Set([
	"draft",
	"ready",
	"running",
	"paused",
	"blocked",
	"completed",
	"cancelled"
]);
const REVIEW_RISKS = new Set([
	"unrated",
	"low",
	"medium",
	"high"
]);
/** Actor stamped on console-driven commands issued from the local desktop UI. */
const CONSOLE_ACTOR = Object.freeze({
	kind: "human",
	id: "desktop-console-user",
	applicationId: "deepseek-harness-personal"
});
const INSTANCE_ID_PATTERN$1 = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/;
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WINDOWS_PATH_KEY_VERSION = "windows-unicode-v1:";
function defaultNow() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function requireString(value, field) {
	if (typeof value !== "string" || value.length === 0) throw new StorageValidationError(`${field} must be a non-empty string.`, { field });
	return value;
}
function requireBoundedString(value, field, maximum, minimum = 1) {
	requireString(value, field);
	if (value.length < minimum || value.length > maximum) throw new StorageValidationError(`${field} must contain between ${minimum} and ${maximum} characters.`, {
		field,
		minimum,
		maximum
	});
	return value;
}
function optionalBoundedString(value, field, maximum) {
	if (value === null || value === void 0) return null;
	return requireBoundedString(value, field, maximum);
}
function requireInteger(value, field, minimum = 0) {
	if (!Number.isSafeInteger(value) || value < minimum) throw new StorageValidationError(`${field} must be an integer >= ${minimum}.`, { field });
	return value;
}
function requireObject(value, field) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new StorageValidationError(`${field} must be an object.`, { field });
	return value;
}
function isNetworkPath(value) {
	return /^(?:\\\\\?\\UNC\\|\\\\(?!\?\\)|\/\/)/i.test(value);
}
function projectPathKey(value) {
	if (typeof value !== "string" || value.length === 0) throw new StorageValidationError("A project path key requires a non-empty path string.");
	return `${WINDOWS_PATH_KEY_VERSION}${win32.normalize(value.replaceAll("/", "\\")).normalize("NFC").toLocaleLowerCase("en-US")}`;
}
function sameFilesystemPath(left, right) {
	return projectPathKey(left) === projectPathKey(right);
}
function validateStoragePath(value, field) {
	requireString(value, field);
	const isUnc = isNetworkPath(value);
	if (!isAbsolute(value) || value === ":memory:" || value.startsWith("file:") || isUnc) throw new InvalidStoragePathError(`${field} must be a stable absolute filesystem path.`, {
		field,
		value,
		reason: isUnc ? "network_paths_are_not_supported" : "not_a_stable_absolute_path"
	});
	return normalize(resolve(value));
}
function validateWorkspacePath(value, field) {
	requireBoundedString(value, field, 2048);
	if (!isAbsolute(value) || value.startsWith("file:") || isNetworkPath(value)) throw new InvalidStoragePathError(`${field} must be an absolute local filesystem path.`, {
		field,
		value,
		reason: isNetworkPath(value) ? "network_paths_are_not_supported" : "not_an_absolute_local_path"
	});
	return normalize(resolve(value));
}
function validatePathPair(value, field) {
	const pair = requireObject(value, field);
	const displayPath = validateWorkspacePath(pair.displayPath, `${field}.displayPath`);
	const normalizedPath = validateWorkspacePath(pair.normalizedPath ?? displayPath, `${field}.normalizedPath`);
	return {
		displayPath,
		normalizedPath,
		pathKey: projectPathKey(normalizedPath)
	};
}
function pathIsWithin$1(rootPath, candidatePath) {
	const rootKey = projectPathKey(rootPath);
	const candidateKey = projectPathKey(candidatePath);
	const childPrefix = rootKey.endsWith("\\") ? rootKey : `${rootKey}\\`;
	return candidateKey === rootKey || candidateKey.startsWith(childPrefix);
}
function requireTimestamp(value, field) {
	requireBoundedString(value, field, 64);
	if (!Number.isFinite(Date.parse(value))) throw new StorageValidationError(`${field} must be an ISO-8601 timestamp.`, { field });
	return value;
}
function boundedJson(value, field, maximumBytes, requireJsonObject = false) {
	if (requireJsonObject) requireObject(value, field);
	const stack = [{
		value,
		depth: 0
	}];
	const seen = /* @__PURE__ */ new WeakSet();
	let nodes = 0;
	while (stack.length > 0) {
		const current = stack.pop();
		nodes += 1;
		if (nodes > 1e4 || current.depth > 20) throw new StorageValidationError(`${field} exceeds its JSON structure limit.`, { field });
		if (typeof current.value === "string" && current.value.length > 4096) throw new StorageValidationError(`${field} contains an unbounded metadata string.`, { field });
		if (current.value === null || typeof current.value !== "object") continue;
		if (seen.has(current.value)) throw new StorageValidationError(`${field} must be a tree-shaped JSON value.`, { field });
		seen.add(current.value);
		if (Array.isArray(current.value)) {
			for (const item of current.value) stack.push({
				value: item,
				depth: current.depth + 1
			});
			continue;
		}
		for (const [key, child] of Object.entries(current.value)) {
			if (key.length > 200) throw new StorageValidationError(`${field} contains an oversized JSON key.`, { field });
			if (/^(?:content|contents|body|full(?:text|content)|raw(?:text|content)|file(?:text|content))$/i.test(key)) throw new StorageValidationError(`${field} cannot contain full file-content fields.`, {
				field,
				key
			});
			stack.push({
				value: child,
				depth: current.depth + 1
			});
		}
	}
	const json = canonicalJson(value);
	if (Buffer.byteLength(json, "utf8") > maximumBytes) throw new StorageValidationError(`${field} exceeds its JSON size limit.`, {
		field,
		maximumBytes
	});
	return json;
}
function createBusinessId(idFactory, prefix, field) {
	const id = requireString(idFactory(prefix), field);
	if (!BUSINESS_IDS[prefix]?.test(id)) throw new StorageValidationError(`${field} must be a ${prefix}_ UUIDv7.`, { field });
	return id;
}
function parseJson(value) {
	return value === null || value === void 0 ? null : JSON.parse(value);
}
function mapLocation(row) {
	if (!row) return null;
	return {
		locationId: row.locationId,
		projectId: row.projectId,
		kind: row.kind,
		displayPath: row.displayPath,
		normalizedPath: row.normalizedPath,
		isActive: Boolean(row.isActive),
		verifiedAt: row.verifiedAt,
		revision: Number(row.revision),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}
function mapProject(row, locations = void 0) {
	if (!row) return null;
	const project = {
		projectId: row.projectId,
		mode: row.mode,
		name: row.name,
		originKind: row.originKind,
		templateId: row.templateId,
		templateVersion: row.templateVersion,
		forkedFromProjectId: row.forkedFromProjectId,
		lifecycle: row.lifecycle,
		health: row.health,
		revision: Number(row.revision),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		archivedAt: row.archivedAt
	};
	if (locations !== void 0) project.workspaceLocations = locations.map(mapLocation);
	return project;
}
function mapDocumentBinding(row) {
	return {
		role: row.role,
		relativePath: row.relativePath,
		contentHash: row.contentHash,
		required: Boolean(row.isRequired),
		source: row.source,
		confirmedAt: row.confirmedAt,
		revision: Number(row.revision)
	};
}
function validateDocumentBindings(value, { source, requireContentHash }) {
	if (!Array.isArray(value) || value.length > 200) throw new StorageValidationError("Confirmed document bindings must be an array of at most 200 items.");
	const seen = /* @__PURE__ */ new Set();
	return value.map((raw, index) => {
		const binding = requireObject(raw, `documentBindings[${index}]`);
		const role = requireString(binding.role, `documentBindings[${index}].role`);
		const relativePath = requireString(binding.relativePath, `documentBindings[${index}].relativePath`);
		if (!DOCUMENT_ROLES$3.has(role) || !RELATIVE_PATH$1.test(relativePath)) throw new StorageValidationError("Confirmed document binding contains an invalid role or relative path.", { index });
		const contentHash = binding.contentHash ?? null;
		if ((requireContentHash || contentHash !== null) && !CONTENT_HASH$1.test(contentHash)) throw new StorageValidationError("Confirmed document binding contains an invalid content hash.", { index });
		if (binding.required !== void 0 && typeof binding.required !== "boolean") throw new StorageValidationError("Confirmed document binding required flag must be boolean.", { index });
		const identity = `${role}\u0000${relativePath}`;
		if (seen.has(identity)) throw new StorageValidationError("Confirmed document bindings contain a duplicate role/path pair.", { index });
		seen.add(identity);
		return {
			role,
			relativePath,
			contentHash,
			required: binding.required ?? false,
			source
		};
	});
}
function insertDocumentBindings(database, projectId, bindings, confirmedAt) {
	const statement = database.prepare(`
    INSERT INTO project_document_bindings(
      project_id, role, relative_path, content_hash, is_required,
      source, confirmed_at, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
	for (const binding of bindings) statement.run(projectId, binding.role, binding.relativePath, binding.contentHash, binding.required ? 1 : 0, binding.source, confirmedAt);
}
function validateImportIssue(rawIssue, field, details = {}) {
	const issue = requireObject(rawIssue, field);
	const severity = issue.severity ?? "warning";
	if (![
		"info",
		"warning",
		"error",
		"blocking"
	].includes(severity)) throw new StorageValidationError("Import issue severity is not supported.", details);
	const issueStatus = issue.status ?? "open";
	if (!["open", "resolved"].includes(issueStatus)) throw new StorageValidationError("Import issue status is not supported.", details);
	const resolvedAt = issue.resolvedAt ?? null;
	if (issueStatus === "resolved" !== (resolvedAt !== null)) throw new StorageValidationError("Resolved import issues require resolvedAt and open issues forbid it.", details);
	const issueDetails = { ...requireObject(issue.details ?? {}, `${field}.details`) };
	if (issue.message !== void 0) issueDetails.message = requireBoundedString(issue.message, `${field}.message`, 2e3);
	return {
		code: requireBoundedString(issue.code, `${field}.code`, 100),
		severity,
		detailsJson: boundedJson(issueDetails, `${field}.details`, 16384, true),
		status: issueStatus,
		resolvedAt: resolvedAt === null ? null : requireTimestamp(resolvedAt, `${field}.resolvedAt`)
	};
}
function validateImportScan(input) {
	const scan = requireObject(input, "scan");
	if (!["source_root", "single_project"].includes(scan.mode)) throw new StorageValidationError("scan.mode must be source_root or single_project.");
	const rootPath = validatePathPair(scan.rootPath, "scan.rootPath");
	const sourceInput = scan.sourceRoot === null || scan.sourceRoot === void 0 ? {
		...rootPath,
		scanPreferences: scan.scanPreferences ?? {}
	} : requireObject(scan.sourceRoot, "scan.sourceRoot");
	const sourcePath = validatePathPair(sourceInput, "scan.sourceRoot");
	if (!pathIsWithin$1(sourcePath.normalizedPath, rootPath.normalizedPath)) throw new StorageValidationError("The scan root must remain within its authorized source root.", { reason: "scan_root_outside_source_root" });
	const sourcePreferencesJson = boundedJson(sourceInput.scanPreferences ?? {}, "scan.sourceRoot.scanPreferences", 65536, true);
	if (sourceInput.isEnabled !== void 0 && typeof sourceInput.isEnabled !== "boolean") throw new StorageValidationError("scan.sourceRoot.isEnabled must be boolean.");
	const scanPreferencesJson = boundedJson(scan.scanPreferences ?? sourceInput.scanPreferences ?? {}, "scan.scanPreferences", 65536, true);
	const scannerVersion = requireBoundedString(scan.scannerVersion, "scan.scannerVersion", 100);
	const status = scan.status ?? "completed";
	if (![
		"completed",
		"failed",
		"cancelled"
	].includes(status)) throw new StorageValidationError("scan.status is not supported.");
	const summaryJson = boundedJson(scan.summary ?? {}, "scan.summary", 65536, true);
	if (!Array.isArray(scan.candidates) || scan.candidates.length > MAX_SCAN_CANDIDATES) throw new StorageValidationError(`scan.candidates must contain at most ${MAX_SCAN_CANDIDATES} items.`);
	if (scan.mode === "single_project" && scan.candidates.length > 1) throw new StorageValidationError("A single_project scan cannot persist more than one candidate.");
	const rawJobIssues = scan.issues ?? [];
	if (!Array.isArray(rawJobIssues) || rawJobIssues.length > MAX_JOB_ISSUES) throw new StorageValidationError(`scan.issues must contain at most ${MAX_JOB_ISSUES} items.`);
	const issues = rawJobIssues.map((rawIssue, issueIndex) => validateImportIssue(rawIssue, `scan.issues[${issueIndex}]`, { issueIndex }));
	let totalDocuments = 0;
	let totalIssues = issues.length;
	const seenCandidatePaths = /* @__PURE__ */ new Set();
	const candidates = scan.candidates.map((rawCandidate, candidateIndex) => {
		const candidate = requireObject(rawCandidate, `scan.candidates[${candidateIndex}]`);
		const root = validatePathPair(candidate.root, `scan.candidates[${candidateIndex}].root`);
		if (!pathIsWithin$1(sourcePath.normalizedPath, root.normalizedPath)) throw new StorageValidationError("A candidate root escaped its authorized source root.", {
			reason: "candidate_outside_source_root",
			candidateIndex
		});
		if (!pathIsWithin$1(rootPath.normalizedPath, root.normalizedPath)) throw new StorageValidationError("A candidate root escaped the concrete scan boundary.", {
			reason: "candidate_outside_scan_root",
			candidateIndex
		});
		if (scan.mode === "single_project" && !sameFilesystemPath(root.normalizedPath, rootPath.normalizedPath)) throw new StorageValidationError("A single_project candidate must equal the selected scan root.", {
			reason: "single_project_root_mismatch",
			candidateIndex
		});
		if (seenCandidatePaths.has(root.pathKey)) throw new StorageValidationError("A scan cannot contain the same candidate root twice.", { candidateIndex });
		seenCandidatePaths.add(root.pathKey);
		const detectedMode = candidate.detectedMode ?? "unknown";
		if (![
			"unknown",
			"linked_legacy",
			"managed"
		].includes(detectedMode)) throw new StorageValidationError("Candidate detectedMode is not supported.", { candidateIndex });
		const candidateStatus = candidate.status ?? "discovered";
		if (!CANDIDATE_STATES.has(candidateStatus)) throw new StorageValidationError("Initial candidate status is not supported.", { candidateIndex });
		const confidenceJson = boundedJson(candidate.confidence ?? {}, `scan.candidates[${candidateIndex}].confidence`, 16384, true);
		if (!Array.isArray(candidate.documents) || candidate.documents.length > MAX_CANDIDATE_DOCUMENTS) throw new StorageValidationError(`Each candidate may contain at most ${MAX_CANDIDATE_DOCUMENTS} documents.`, { candidateIndex });
		if (!Array.isArray(candidate.issues) || candidate.issues.length > MAX_CANDIDATE_ISSUES) throw new StorageValidationError(`Each candidate may contain at most ${MAX_CANDIDATE_ISSUES} issues.`, { candidateIndex });
		totalDocuments += candidate.documents.length;
		totalIssues += candidate.issues.length;
		const seenDocuments = /* @__PURE__ */ new Set();
		const documents = candidate.documents.map((rawDocument, documentIndex) => {
			const field = `scan.candidates[${candidateIndex}].documents[${documentIndex}]`;
			const document = requireObject(rawDocument, field);
			const relativePath = requireBoundedString(document.relativePath, `${field}.relativePath`, 512);
			if (!RELATIVE_PATH$1.test(relativePath)) throw new StorageValidationError("Candidate document path must be a safe project-relative path.", {
				candidateIndex,
				documentIndex
			});
			if (seenDocuments.has(relativePath)) throw new StorageValidationError("Candidate documents contain a duplicate relative path.", {
				candidateIndex,
				documentIndex
			});
			seenDocuments.add(relativePath);
			const suggestedRole = document.suggestedRole ?? null;
			if (suggestedRole !== null && !DOCUMENT_ROLES$3.has(suggestedRole)) throw new StorageValidationError("Candidate document role is not supported.", {
				candidateIndex,
				documentIndex
			});
			const sha256 = document.sha256 ?? null;
			if (sha256 !== null && !CONTENT_HASH$1.test(sha256)) throw new StorageValidationError("Candidate document sha256 is invalid.", {
				candidateIndex,
				documentIndex
			});
			return {
				relativePath,
				suggestedRole,
				sha256,
				title: optionalBoundedString(document.title, `${field}.title`, 500),
				preview: optionalBoundedString(document.preview, `${field}.preview`, 1e3),
				observedAt: document.observedAt === void 0 ? null : requireTimestamp(document.observedAt, `${field}.observedAt`),
				evidenceJson: boundedJson(document.evidence ?? {}, `${field}.evidence`, 16384, true)
			};
		});
		const issues = candidate.issues.map((rawIssue, issueIndex) => validateImportIssue(rawIssue, `scan.candidates[${candidateIndex}].issues[${issueIndex}]`, {
			candidateIndex,
			issueIndex
		}));
		return {
			root,
			detectedMode,
			manifestProjectId: optionalBoundedString(candidate.manifestProjectId, `scan.candidates[${candidateIndex}].manifestProjectId`, 100),
			suggestedName: optionalBoundedString(candidate.suggestedName, `scan.candidates[${candidateIndex}].suggestedName`, 200),
			suggestedSummary: optionalBoundedString(candidate.suggestedSummary, `scan.candidates[${candidateIndex}].suggestedSummary`, 2e3),
			summarySource: optionalBoundedString(candidate.summarySource, `scan.candidates[${candidateIndex}].summarySource`, 512),
			confidenceJson,
			status: candidateStatus,
			documents,
			issues
		};
	});
	if (totalDocuments > MAX_SCAN_DOCUMENTS || totalIssues > MAX_SCAN_ISSUES) throw new StorageValidationError("The complete scan exceeds its bounded document or issue total.", {
		totalDocuments,
		totalIssues,
		maximumDocuments: MAX_SCAN_DOCUMENTS,
		maximumIssues: MAX_SCAN_ISSUES
	});
	return {
		mode: scan.mode,
		rootPath,
		sourcePath,
		sourcePreferencesJson,
		scanPreferencesJson,
		sourceEnabled: sourceInput.isEnabled ?? true,
		scannerVersion,
		status,
		summaryJson,
		startedAt: scan.startedAt === void 0 ? null : requireTimestamp(scan.startedAt, "scan.startedAt"),
		completedAt: scan.completedAt === void 0 ? null : requireTimestamp(scan.completedAt, "scan.completedAt"),
		issues,
		candidates
	};
}
function mapSourceRoot(row) {
	if (!row) return null;
	return {
		sourceRootId: row.sourceRootId,
		kind: row.kind,
		displayPath: row.displayPath,
		normalizedPath: row.normalizedPath,
		scanPreferences: parseJson(row.scanPreferencesJson),
		isEnabled: Boolean(row.isEnabled),
		revision: Number(row.revision),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}
function mapImportJobIssue(row) {
	const details = parseJson(row.detailsJson);
	return {
		importJobIssueId: row.importJobIssueId,
		importJobId: row.importJobId,
		code: row.code,
		severity: row.severity,
		message: typeof details?.message === "string" ? details.message : null,
		details,
		status: row.status,
		resolvedAt: row.resolvedAt
	};
}
function mapImportJob(row, issues = []) {
	if (!row) return null;
	return {
		importJobId: row.importJobId,
		sourceRootId: row.sourceRootId,
		rootPathSnapshot: row.rootPathSnapshot,
		rootNormalizedPathSnapshot: row.rootNormalizedPathSnapshot,
		scanPreferencesSnapshot: parseJson(row.scanPreferencesSnapshotJson),
		mode: row.mode,
		status: row.status,
		scannerVersion: row.scannerVersion,
		startedAt: row.startedAt,
		completedAt: row.completedAt,
		summary: parseJson(row.summaryJson),
		issues
	};
}
function mapCandidateDocument(row) {
	return {
		candidateDocumentId: row.candidateDocumentId,
		candidateId: row.candidateId,
		relativePath: row.relativePath,
		suggestedRole: row.suggestedRole,
		sha256: row.sha256,
		title: row.title,
		preview: row.preview,
		observedAt: row.observedAt,
		evidence: parseJson(row.evidenceJson)
	};
}
function mapImportIssue(row) {
	const details = parseJson(row.detailsJson);
	return {
		importIssueId: row.importIssueId,
		candidateId: row.candidateId,
		code: row.code,
		severity: row.severity,
		message: typeof details?.message === "string" ? details.message : null,
		details,
		status: row.status,
		resolvedAt: row.resolvedAt
	};
}
function mapImportCandidate(row, documents = [], issues = []) {
	if (!row) return null;
	return {
		candidateId: row.candidateId,
		importJobId: row.importJobId,
		sourceRootId: row.sourceRootId,
		root: {
			displayPath: row.rootDisplayPath,
			normalizedPath: row.rootNormalizedPath
		},
		detectedMode: row.detectedMode,
		manifestProjectId: row.manifestProjectId,
		suggestedName: row.suggestedName,
		suggestedSummary: row.suggestedSummary,
		summarySource: row.summarySource,
		confidence: parseJson(row.confidenceJson),
		status: row.status,
		statusBeforeIgnored: row.statusBeforeIgnored,
		matchedProjectId: row.matchedProjectId,
		revision: Number(row.revision),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		documents,
		issues
	};
}
function selectSourceRoot(database, sourceRootId) {
	const row = database.prepare(`
    SELECT
      source_root_id AS sourceRootId, kind, display_path AS displayPath,
      normalized_path AS normalizedPath, scan_preferences_json AS scanPreferencesJson,
      is_enabled AS isEnabled, revision, created_at AS createdAt, updated_at AS updatedAt
    FROM project_source_roots
    WHERE source_root_id = ?
  `).get(sourceRootId);
	return row ? Object.freeze(mapSourceRoot(row)) : null;
}
function selectImportJob(database, importJobId) {
	const row = database.prepare(`
    SELECT
      import_job_id AS importJobId, source_root_id AS sourceRootId,
      root_path_snapshot AS rootPathSnapshot,
      root_normalized_path_snapshot AS rootNormalizedPathSnapshot,
      scan_preferences_snapshot_json AS scanPreferencesSnapshotJson,
      mode, status, scanner_version AS scannerVersion,
      started_at AS startedAt, completed_at AS completedAt, summary_json AS summaryJson
    FROM import_jobs
    WHERE import_job_id = ?
  `).get(importJobId);
	if (!row) return null;
	const issues = database.prepare(`
    SELECT
      import_job_issue_id AS importJobIssueId, import_job_id AS importJobId,
      code, severity, details_json AS detailsJson, status, resolved_at AS resolvedAt
    FROM import_job_issues
    WHERE import_job_id = ?
    ORDER BY severity DESC, import_job_issue_id
  `).all(importJobId).map(mapImportJobIssue);
	return Object.freeze(mapImportJob(row, issues));
}
function selectImportCandidate(database, candidateId) {
	const row = database.prepare(`
    SELECT
      candidate_id AS candidateId, import_job_id AS importJobId,
      source_root_id AS sourceRootId, root_display_path AS rootDisplayPath,
      root_normalized_path AS rootNormalizedPath, detected_mode AS detectedMode,
      manifest_project_id AS manifestProjectId, suggested_name AS suggestedName,
      suggested_summary AS suggestedSummary, summary_source AS summarySource,
      confidence_json AS confidenceJson, status,
      status_before_ignored AS statusBeforeIgnored,
      matched_project_id AS matchedProjectId, revision,
      created_at AS createdAt, updated_at AS updatedAt
    FROM import_candidates
    WHERE candidate_id = ?
  `).get(candidateId);
	if (!row) return null;
	const documents = database.prepare(`
    SELECT
      candidate_document_id AS candidateDocumentId, candidate_id AS candidateId,
      relative_path AS relativePath, suggested_role AS suggestedRole, sha256,
      title, preview, observed_at AS observedAt, evidence_json AS evidenceJson
    FROM import_candidate_documents
    WHERE candidate_id = ?
    ORDER BY relative_path, candidate_document_id
  `).all(candidateId).map(mapCandidateDocument);
	const issues = database.prepare(`
    SELECT
      import_issue_id AS importIssueId, candidate_id AS candidateId, code, severity,
      details_json AS detailsJson, status, resolved_at AS resolvedAt
    FROM import_issues
    WHERE candidate_id = ?
    ORDER BY severity DESC, import_issue_id
  `).all(candidateId).map(mapImportIssue);
	return Object.freeze(mapImportCandidate(row, documents, issues));
}
function requireCandidateRevision$1(database, candidateId, expectedRevision) {
	requireString(candidateId, "candidateId");
	requireInteger(expectedRevision, "expectedRevision", 1);
	const row = database.prepare(`
    SELECT status, status_before_ignored AS statusBeforeIgnored,
      matched_project_id AS matchedProjectId, revision
    FROM import_candidates WHERE candidate_id = ?
  `).get(candidateId);
	if (!row) throw new StorageValidationError("Import candidate was not found.", {
		reason: "candidate_not_found",
		candidateId
	});
	if (Number(row.revision) !== expectedRevision) throw new StorageValidationError("Import candidate revision changed.", {
		reason: "revision_conflict",
		candidateId,
		expectedRevision,
		currentRevision: Number(row.revision)
	});
	return row;
}
function mapReceipt(row) {
	if (!row) return null;
	return {
		commandId: row.commandId,
		idempotencyScope: row.idempotencyScope,
		idempotencyKey: row.idempotencyKey,
		kind: row.kind,
		requestSha256: row.requestSha256,
		actor: parseJson(row.actorRef),
		status: row.status,
		result: parseJson(row.resultJson),
		error: parseJson(row.errorJson),
		receivedAt: row.receivedAt,
		completedAt: row.completedAt
	};
}
function mapEvent(row) {
	if (!row) return null;
	return {
		eventId: row.eventId,
		sequence: Number(row.sequence),
		projectId: row.projectId,
		aggregateType: row.aggregateType,
		aggregateId: row.aggregateId,
		beforeRevision: Number(row.beforeRevision),
		afterRevision: Number(row.afterRevision),
		eventType: row.eventType,
		schemaVersion: row.schemaVersion,
		data: parseJson(row.payloadJson),
		actor: parseJson(row.actorRef),
		provenance: parseJson(row.provenanceJson),
		commandId: row.commandId,
		correlationId: row.correlationId,
		causationId: row.causationId,
		occurredAt: row.occurredAt,
		recordedAt: row.recordedAt
	};
}
function validateCommand(command, expectedKind = void 0) {
	requireObject(command, "command");
	requireString(command.commandId, "command.commandId");
	requireString(command.correlationId, "command.correlationId");
	requireString(command.idempotencyKey, "command.idempotencyKey");
	requireString(command.kind, "command.kind");
	if (expectedKind && command.kind !== expectedKind) throw new StorageValidationError(`Expected command kind ${expectedKind}.`, { actualKind: command.kind });
	requireObject(command.actor, "command.actor");
	requireString(command.actor.applicationId, "command.actor.applicationId");
	requireObject(command.target, "command.target");
	if (command.target.aggregateType !== "project") throw new StorageValidationError("Storage lifecycle command target must be a project.");
	requireString(command.target.projectId, "command.target.projectId");
	requireInteger(command.expectedRevision, "command.expectedRevision");
	requireString(command.occurredAt, "command.occurredAt");
	requireObject(command.provenance, "command.provenance");
	requireObject(command.payload, "command.payload");
	canonicalJson(command);
	return command;
}
function validateLocation(location, expectedId = void 0) {
	requireObject(location, "trusted.location");
	requireString(location.locationId, "trusted.location.locationId");
	if (expectedId && location.locationId !== expectedId) throw new StorageValidationError("Resolved location does not match the command locationRef.", {
		expectedId,
		actualId: location.locationId
	});
	requireString(location.displayPath, "trusted.location.displayPath");
	requireString(location.normalizedPath, "trusted.location.normalizedPath");
	if (!isAbsolute(location.displayPath) || !isAbsolute(location.normalizedPath) || isNetworkPath(location.displayPath) || isNetworkPath(location.normalizedPath)) throw new StorageValidationError("Resolved workspace paths must be absolute local paths.");
	if (location.kind !== void 0 && ![
		"primary",
		"mirror",
		"archive"
	].includes(location.kind)) throw new StorageValidationError("Resolved workspace kind is not supported.");
	return location;
}
function commandIdentity(command) {
	return {
		commandId: command.commandId,
		requestHash: requestSha256(command),
		idempotencyKey: command.idempotencyKey,
		idempotencyScope: canonicalJson([command.actor.applicationId, command.target.projectId])
	};
}
function eventTypeForRegister(kind) {
	return kind === "project.registerLegacy" ? "project.legacy.registered" : "project.managed.registered";
}
function outcomeForRegister(kind) {
	return kind === "project.registerLegacy" ? "legacy_registered" : "managed_registered";
}
function insertReceipt(database, command, identity, status, recordedAt, result, error) {
	database.prepare(`
    INSERT INTO command_receipts(
      command_id, idempotency_scope, idempotency_key, kind, request_sha256,
      actor_ref, status, result_json, error_json, received_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(identity.commandId, identity.idempotencyScope, identity.idempotencyKey, command.kind, identity.requestHash, canonicalJson(command.actor), status, result === null ? null : canonicalJson(result), error === null ? null : canonicalJson(error), recordedAt, recordedAt);
}
function findExistingReceipt(database, identity) {
	const byCommand = findReceiptByCommandId(database, identity.commandId);
	if (byCommand) return {
		row: byCommand,
		matchedBy: "commandId"
	};
	const byKey = database.prepare(`
    SELECT
      command_id AS commandId,
      idempotency_scope AS idempotencyScope,
      idempotency_key AS idempotencyKey,
      kind,
      request_sha256 AS requestSha256,
      actor_ref AS actorRef,
      status,
      result_json AS resultJson,
      error_json AS errorJson,
      received_at AS receivedAt,
      completed_at AS completedAt
    FROM command_receipts
    WHERE idempotency_scope = ? AND idempotency_key = ?
  `).get(identity.idempotencyScope, identity.idempotencyKey);
	return byKey ? {
		row: byKey,
		matchedBy: "idempotencyKey"
	} : null;
}
function findReceiptByCommandId(database, commandId) {
	return database.prepare(`
    SELECT
      command_id AS commandId,
      idempotency_scope AS idempotencyScope,
      idempotency_key AS idempotencyKey,
      kind,
      request_sha256 AS requestSha256,
      actor_ref AS actorRef,
      status,
      result_json AS resultJson,
      error_json AS errorJson,
      received_at AS receivedAt,
      completed_at AS completedAt
    FROM command_receipts
    WHERE command_id = ?
  `).get(commandId);
}
function replayOrThrow(existing, identity) {
	if (!existing) return null;
	if (existing.row.requestSha256 !== identity.requestHash) throw new IdempotencyConflictError({
		matchedBy: existing.matchedBy,
		originalCommandId: existing.row.commandId,
		attemptedCommandId: identity.commandId,
		expectedRequestSha256: existing.row.requestSha256,
		actualRequestSha256: identity.requestHash
	});
	const receipt = mapReceipt(existing.row);
	if (receipt.status === "accepted") return Object.freeze({
		...receipt.result,
		status: "replayed"
	});
	return Object.freeze(receipt.result);
}
function nextSequence(database) {
	const row = database.prepare(`
    UPDATE event_sequence
    SET last_value = last_value + 1
    WHERE singleton = 1
    RETURNING last_value AS value
  `).get();
	return Number(row.value);
}
function buildNormalizedEvent({ command, eventId, eventType, sequence, beforeRevision, afterRevision, recordedAt, data }) {
	return {
		protocolVersion: PROTOCOL_VERSION$1,
		schemaVersion: EVENT_SCHEMA_VERSION,
		eventId,
		eventType,
		occurredAt: command.occurredAt,
		recordedAt,
		sequence,
		actor: command.actor,
		target: command.target,
		beforeRevision,
		afterRevision,
		causation: {
			commandId: command.commandId,
			commandKind: command.kind,
			idempotencyKey: command.idempotencyKey,
			correlationId: command.correlationId
		},
		provenance: command.provenance,
		data
	};
}
function insertEvent(database, event, command, aggregateType = "project", aggregateId = command.target.projectId) {
	database.prepare(`
    INSERT INTO domain_events(
      event_id, global_sequence, project_id, aggregate_type, aggregate_id,
      before_revision, aggregate_revision, event_type, schema_version, payload_json,
      actor_ref, provenance_json, command_id, correlation_id, causation_id,
      occurred_at, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(event.eventId, event.sequence, command.target.projectId, aggregateType, aggregateId, event.beforeRevision, event.afterRevision, event.eventType, event.schemaVersion, canonicalJson(event.data), canonicalJson(event.actor), canonicalJson(event.provenance), command.commandId, command.correlationId, command.commandId, event.occurredAt, event.recordedAt);
}
function insertOutbox(database, outboxId, event, recordedAt) {
	database.prepare(`
    INSERT INTO outbox_messages(
      outbox_id, event_id, destination, message_key, schema_version, payload_json,
      status, attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
  `).run(outboxId, event.eventId, OUTBOX_DESTINATION, event.eventId, event.schemaVersion, canonicalJson(event), recordedAt, recordedAt, recordedAt);
}
function rejectionResult(command, recordedAt, code, message, currentRevision = void 0) {
	const result = {
		protocolVersion: PROTOCOL_VERSION$1,
		schemaVersion: RESULT_SCHEMA_VERSION,
		commandId: command.commandId,
		correlationId: command.correlationId,
		kind: command.kind,
		status: "rejected",
		recordedAt,
		error: {
			code,
			message
		}
	};
	if (currentRevision !== void 0) result.currentRevision = currentRevision;
	return result;
}
function validateReferenceContext(value) {
	const context = requireObject(value, "referenceContext");
	const applicationInstanceId = requireBoundedString(context.applicationInstanceId, "referenceContext.applicationInstanceId", 200);
	if (context.scope !== INTAKE_SCOPE) throw new StorageValidationError(`Reference scope must be ${INTAKE_SCOPE}.`, { reason: "scope_not_supported" });
	return {
		applicationInstanceId,
		scope: context.scope
	};
}
function referenceResolutionError(reason) {
	return new StorageValidationError("The intake reference cannot be resolved in this context.", { reason });
}
function validateResolvedReference(row, context, observedAt) {
	if (!row) throw referenceResolutionError("reference_not_found");
	if (row.applicationInstanceId !== context.applicationInstanceId) throw referenceResolutionError("application_instance_mismatch");
	if (row.scope !== context.scope) throw referenceResolutionError("scope_mismatch");
	if (row.revokedAt !== null) throw referenceResolutionError("reference_revoked");
	if (Date.parse(observedAt) >= Date.parse(row.expiresAt)) throw referenceResolutionError("reference_expired");
	if (!Boolean(row.sourceEnabled)) throw referenceResolutionError("source_root_disabled");
	return row;
}
function selectLocationRef(database, locationRef) {
	return database.prepare(`
    SELECT
      r.location_ref AS locationRef, r.candidate_id AS candidateId,
      r.source_root_id AS sourceRootId,
      r.application_instance_id AS applicationInstanceId, r.scope,
      r.display_path AS displayPath, r.normalized_path AS normalizedPath,
      r.issued_at AS issuedAt, r.expires_at AS expiresAt, r.revoked_at AS revokedAt,
      c.root_normalized_path AS candidateNormalizedPath, c.status AS candidateStatus,
      s.display_path AS sourceDisplayPath, s.normalized_path AS sourceNormalizedPath,
      s.is_enabled AS sourceEnabled
    FROM intake_location_refs r
    JOIN import_candidates c ON c.candidate_id = r.candidate_id
    JOIN project_source_roots s ON s.source_root_id = r.source_root_id
    WHERE r.location_ref = ?
  `).get(locationRef);
}
function selectSourceRootRef(database, sourceRootRef) {
	return database.prepare(`
    SELECT
      r.source_root_ref AS sourceRootRef, r.candidate_id AS candidateId,
      r.source_root_id AS sourceRootId,
      r.application_instance_id AS applicationInstanceId, r.scope,
      r.issued_at AS issuedAt, r.expires_at AS expiresAt, r.revoked_at AS revokedAt,
      s.display_path AS sourceDisplayPath, s.normalized_path AS sourceNormalizedPath,
      s.is_enabled AS sourceEnabled
    FROM intake_source_root_refs r
    JOIN project_source_roots s ON s.source_root_id = r.source_root_id
    WHERE r.source_root_ref = ?
  `).get(sourceRootRef);
}
function executeWrite(database, callback) {
	database.exec("BEGIN IMMEDIATE");
	try {
		const result = callback();
		database.exec("COMMIT");
		return result;
	} catch (error) {
		try {
			database.exec("ROLLBACK");
		} catch {}
		throw error;
	}
}
const FILE_SYNC_STATES = new Set([
	"planned",
	"staging",
	"staged",
	"files_committed",
	"accepted",
	"rolled_back",
	"recovery_required"
]);
const FILE_SYNC_TERMINAL_STATES = new Set([
	"accepted",
	"rolled_back",
	"recovery_required"
]);
const FILE_SYNC_TRANSITIONS = Object.freeze({
	planned: new Set([
		"staging",
		"rolled_back",
		"recovery_required"
	]),
	staging: new Set([
		"staged",
		"rolled_back",
		"recovery_required"
	]),
	staged: new Set([
		"files_committed",
		"rolled_back",
		"recovery_required"
	]),
	files_committed: new Set([
		"accepted",
		"rolled_back",
		"recovery_required"
	]),
	recovery_required: new Set(["rolled_back"]),
	rolled_back: new Set(["staging"])
});
function validateFileSyncPlanInput(input) {
	requireObject(input, "input");
	const planId = requireString(input.planId, "input.planId");
	const commandId = requireString(input.commandId, "input.commandId");
	const projectId = requireString(input.projectId, "input.projectId");
	if (!BUSINESS_IDS.pln.test(planId)) throw new StorageValidationError("input.planId must be a pln_ UUIDv7.");
	if (!BUSINESS_IDS.cmd.test(commandId)) throw new StorageValidationError("input.commandId must be a cmd_ UUIDv7.");
	if (!BUSINESS_IDS.prj.test(projectId)) throw new StorageValidationError("input.projectId must be a prj_ UUIDv7.");
	const kind = requireString(input.kind, "input.kind");
	if (!["create_from_template", "upgrade_managed"].includes(kind)) throw new StorageValidationError("input.kind must be create_from_template or upgrade_managed.");
	const syncPolicy = requireString(input.syncPolicy, "input.syncPolicy");
	if (!["atomic_create", "atomic_additive"].includes(syncPolicy)) throw new StorageValidationError("input.syncPolicy must be atomic_create or atomic_additive.");
	const planHash = requireString(input.planHash, "input.planHash");
	const manifestHash = requireString(input.manifestHash, "input.manifestHash");
	if (!CONTENT_HASH$1.test(planHash) || !CONTENT_HASH$1.test(manifestHash)) throw new StorageValidationError("File sync plan hashes must use the sha256: line format.");
	const targetDisplayPath = validateWorkspacePath(input.targetDisplayPath, "input.targetDisplayPath");
	const targetNormalizedPath = validateWorkspacePath(input.targetNormalizedPath ?? targetDisplayPath, "input.targetNormalizedPath");
	const stagingDisplayPath = validateWorkspacePath(input.stagingDisplayPath, "input.stagingDisplayPath");
	if (input.rootPreexistedEmpty !== void 0 && typeof input.rootPreexistedEmpty !== "boolean") throw new StorageValidationError("input.rootPreexistedEmpty must be a boolean.");
	if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 500) throw new StorageValidationError("input.operations must be an array of 1..500 operations.");
	let renderParams = null;
	if (input.renderParams !== void 0) {
		requireObject(input.renderParams, "input.renderParams");
		boundedJson(input.renderParams, "input.renderParams", 4096, true);
		renderParams = input.renderParams;
	}
	const operations = input.operations.map((raw, index) => {
		requireObject(raw, `input.operations[${index}]`);
		const kind = requireString(raw.kind, `input.operations[${index}].kind`);
		if (!["create_directory", "create_file"].includes(kind)) throw new StorageValidationError(`input.operations[${index}].kind is unsupported.`);
		const relativePath = requireString(raw.relativePath, `input.operations[${index}].relativePath`);
		if (!RELATIVE_PATH$1.test(relativePath)) throw new StorageValidationError(`input.operations[${index}].relativePath is invalid.`);
		if (raw.expectedState !== "absent") throw new StorageValidationError("File sync operations may only create absent paths.");
		const contentHash = raw.contentHash === void 0 || raw.contentHash === null ? null : requireString(raw.contentHash, `input.operations[${index}].contentHash`);
		if (kind === "create_file" && (contentHash === null || !CONTENT_HASH$1.test(contentHash))) throw new StorageValidationError("create_file operations require a sha256: contentHash.");
		if (kind === "create_directory" && contentHash !== null) throw new StorageValidationError("create_directory operations cannot carry a contentHash.");
		return Object.freeze({
			kind,
			relativePath,
			expectedState: "absent",
			contentHash
		});
	});
	return Object.freeze({
		planId,
		commandId,
		kind,
		projectId,
		syncPolicy,
		targetDisplayPath,
		targetNormalizedPath,
		stagingDisplayPath,
		planHash,
		manifestHash,
		operations,
		rootPreexistedEmpty: input.rootPreexistedEmpty === true,
		renderParams
	});
}
function rowToFileSyncPlan(row) {
	return Object.freeze({
		planId: row.plan_id,
		commandId: row.command_id,
		kind: row.kind,
		projectId: row.project_id,
		syncPolicy: row.sync_policy,
		targetDisplayPath: row.target_display_path,
		targetNormalizedPath: row.target_normalized_path,
		stagingDisplayPath: row.staging_display_path,
		planHash: row.plan_hash,
		manifestHash: row.manifest_hash,
		state: row.state,
		operations: JSON.parse(row.operations_json),
		createdPaths: JSON.parse(row.created_paths_json),
		renderParams: row.render_params_json === null ? null : JSON.parse(row.render_params_json),
		rootPreexistedEmpty: row.root_preexisted_empty === 1,
		errorCode: row.error_code,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		completedAt: row.completed_at
	});
}
function computeLegacyFingerprint(database, projectId) {
	const bindings = database.prepare(`
    SELECT role, relative_path AS relativePath, content_hash AS contentHash
    FROM project_document_bindings
    WHERE project_id = ?
    ORDER BY role, relative_path
  `).all(projectId).map((row) => ({
		role: row.role,
		relativePath: row.relativePath,
		contentHash: row.contentHash
	}));
	return `sha256:${createHash("sha256").update(canonicalJson({
		projectId,
		documentBindings: bindings
	}), "utf8").digest("hex")}`;
}
function selectPlanRef(database, planRef) {
	return database.prepare(`
    SELECT
      plan_ref AS planRef, ref_kind AS refKind, plan_id AS planId,
      application_instance_id AS applicationInstanceId, scope,
      display_path AS displayPath, normalized_path AS normalizedPath,
      issued_at AS issuedAt, expires_at AS expiresAt, revoked_at AS revokedAt
    FROM file_sync_plan_refs
    WHERE plan_ref = ?
  `).get(planRef);
}
function selectFileSyncPlan(database, planId) {
	const row = database.prepare(`
    SELECT
      plan_id, command_id, kind, project_id, sync_policy,
      target_display_path, target_normalized_path, staging_display_path,
      plan_hash, manifest_hash, state, operations_json, created_paths_json,
      render_params_json, root_preexisted_empty, error_code,
      created_at, updated_at, completed_at
    FROM file_sync_plans
    WHERE plan_id = ?
  `).get(planId);
	return row ? rowToFileSyncPlan(row) : null;
}
function validateParseIssues(value, field) {
	if (!Array.isArray(value) || value.length > MAX_INDEX_PARSE_ISSUES) throw new StorageValidationError(`${field} must be an array of at most ${MAX_INDEX_PARSE_ISSUES} parse issues.`);
	return value.map((raw, index) => {
		const issue = requireObject(raw, `${field}[${index}]`);
		const severity = issue.severity ?? "warning";
		if (!PARSE_ISSUE_SEVERITIES.has(severity)) throw new StorageValidationError(`${field}[${index}].severity is not supported.`, { index });
		const line = issue.line === void 0 || issue.line === null ? null : requireInteger(issue.line, `${field}[${index}].line`, 1);
		return {
			code: requireBoundedString(issue.code, `${field}[${index}].code`, 100),
			severity,
			message: requireBoundedString(issue.message ?? issue.code, `${field}[${index}].message`, 1e3),
			line
		};
	});
}
function validateDocumentIndexInput(input) {
	requireObject(input, "input");
	const projectId = requireString(input.projectId, "input.projectId");
	if (!BUSINESS_IDS.prj.test(projectId)) throw new StorageValidationError("input.projectId must be a prj_ UUIDv7.");
	if (!Array.isArray(input.documentStates) || input.documentStates.length > MAX_INDEX_DOCUMENTS) throw new StorageValidationError(`input.documentStates must be an array of at most ${MAX_INDEX_DOCUMENTS} items.`);
	const seenStates = /* @__PURE__ */ new Set();
	const documentStates = input.documentStates.map((raw, index) => {
		const field = `input.documentStates[${index}]`;
		const item = requireObject(raw, field);
		const role = requireString(item.role, `${field}.role`);
		const relativePath = requireString(item.relativePath, `${field}.relativePath`);
		if (!DOCUMENT_ROLES$3.has(role) || !RELATIVE_PATH$1.test(relativePath)) throw new StorageValidationError("Document index state contains an invalid role or relative path.", { index });
		const identity = `${role}\u0000${relativePath}`;
		if (seenStates.has(identity)) throw new StorageValidationError("Document index states contain a duplicate role/path pair.", { index });
		seenStates.add(identity);
		const bindingSource = requireString(item.bindingSource, `${field}.bindingSource`);
		if (!["user_confirmed", "manifest"].includes(bindingSource)) throw new StorageValidationError(`${field}.bindingSource is not supported.`, { index });
		const state = requireString(item.state, `${field}.state`);
		if (!DOCUMENT_INDEX_STATES.has(state)) throw new StorageValidationError(`${field}.state is not supported.`, { index });
		const contentHash = item.contentHash === void 0 || item.contentHash === null ? null : requireString(item.contentHash, `${field}.contentHash`);
		if (contentHash !== null && !CONTENT_HASH$1.test(contentHash)) throw new StorageValidationError(`${field}.contentHash is invalid.`, { index });
		const byteSize = item.byteSize === void 0 || item.byteSize === null ? null : requireInteger(item.byteSize, `${field}.byteSize`, 0);
		if (byteSize !== null && byteSize > MAX_DOCUMENT_BYTES) throw new StorageValidationError(`${field}.byteSize exceeds the document byte limit.`, { index });
		const readable = state === "ok" || state === "changed";
		if (readable && contentHash === null) throw new StorageValidationError("Readable document index states require a content hash.", { index });
		if (!readable && (contentHash !== null || byteSize !== null)) throw new StorageValidationError("Missing/unreadable document index states cannot carry file facts.", { index });
		return {
			role,
			relativePath,
			bindingSource,
			state,
			contentHash,
			byteSize,
			parseIssues: validateParseIssues(item.parseIssues ?? [], `${field}.parseIssues`)
		};
	});
	if (!Array.isArray(input.rebindProposals) || input.rebindProposals.length > MAX_REBIND_PROPOSALS) throw new StorageValidationError(`input.rebindProposals must be an array of at most ${MAX_REBIND_PROPOSALS} items.`);
	const seenProposals = /* @__PURE__ */ new Set();
	const rebindProposals = input.rebindProposals.map((raw, index) => {
		const field = `input.rebindProposals[${index}]`;
		const item = requireObject(raw, field);
		const role = requireString(item.role, `${field}.role`);
		const missingRelativePath = requireString(item.missingRelativePath, `${field}.missingRelativePath`);
		if (!DOCUMENT_ROLES$3.has(role) || !RELATIVE_PATH$1.test(missingRelativePath)) throw new StorageValidationError("Rebind proposal contains an invalid role or relative path.", { index });
		const identity = `${role}\u0000${missingRelativePath}`;
		if (seenProposals.has(identity)) throw new StorageValidationError("Rebind proposals contain a duplicate role/path pair.", { index });
		seenProposals.add(identity);
		const contentHash = requireString(item.contentHash, `${field}.contentHash`);
		if (!CONTENT_HASH$1.test(contentHash)) throw new StorageValidationError(`${field}.contentHash is invalid.`, { index });
		if (!Array.isArray(item.candidateRelativePaths) || item.candidateRelativePaths.length < 1 || item.candidateRelativePaths.length > MAX_REBIND_CANDIDATES) throw new StorageValidationError(`${field}.candidateRelativePaths must be an array of 1..${MAX_REBIND_CANDIDATES} paths.`, { index });
		const candidateRelativePaths = [...new Set(item.candidateRelativePaths.map((candidate, candidateIndex) => {
			const candidatePath = requireString(candidate, `${field}.candidateRelativePaths[${candidateIndex}]`);
			if (!RELATIVE_PATH$1.test(candidatePath)) throw new StorageValidationError(`${field}.candidateRelativePaths[${candidateIndex}] is invalid.`, { index });
			return candidatePath;
		}))];
		if (candidateRelativePaths.includes(missingRelativePath)) throw new StorageValidationError("A rebind candidate cannot equal its own missing binding path.", { index });
		return {
			role,
			missingRelativePath,
			contentHash,
			candidateRelativePaths
		};
	});
	return Object.freeze({
		projectId,
		documentStates,
		rebindProposals
	});
}
function selectDocumentStateRows(database, projectId) {
	return database.prepare(`
    SELECT
      project_id AS projectId, role, relative_path AS relativePath,
      binding_source AS bindingSource, state, content_hash AS contentHash,
      byte_size AS byteSize, parse_issues_json AS parseIssuesJson,
      revision, first_seen_at AS firstSeenAt, last_verified_at AS lastVerifiedAt,
      updated_at AS updatedAt
    FROM project_document_states
    WHERE project_id = ?
    ORDER BY role, relative_path
  `).all(projectId);
}
function rowToDocumentState(row) {
	return Object.freeze({
		role: row.role,
		relativePath: row.relativePath,
		bindingSource: row.bindingSource,
		state: row.state,
		contentHash: row.contentHash,
		byteSize: row.byteSize === null ? null : Number(row.byteSize),
		parseIssues: parseJson(row.parseIssuesJson),
		revision: Number(row.revision),
		firstSeenAt: row.firstSeenAt,
		lastVerifiedAt: row.lastVerifiedAt
	});
}
function selectRebindProposalRows(database, projectId) {
	return database.prepare(`
    SELECT
      proposal_id AS proposalId, project_id AS projectId, role,
      missing_relative_path AS missingRelativePath, content_hash AS contentHash,
      candidate_relative_paths_json AS candidateRelativePathsJson,
      candidate_count AS candidateCount, unambiguous,
      status, resolved_relative_path AS resolvedRelativePath,
      revision, created_at AS createdAt, updated_at AS updatedAt,
      resolved_at AS resolvedAt
    FROM project_document_rebind_proposals
    WHERE project_id = ?
    ORDER BY created_at, proposal_id
  `).all(projectId);
}
function rowToRebindProposal(row) {
	return {
		proposalId: row.proposalId,
		role: row.role,
		missingRelativePath: row.missingRelativePath,
		contentHash: row.contentHash,
		candidateRelativePaths: parseJson(row.candidateRelativePathsJson),
		candidateCount: Number(row.candidateCount),
		unambiguous: Number(row.unambiguous) === 1,
		status: row.status,
		resolvedRelativePath: row.resolvedRelativePath,
		revision: Number(row.revision),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		resolvedAt: row.resolvedAt
	};
}
function selectWorkItem(database, workItemId) {
	const row = database.prepare(`
    SELECT
      work_item_id AS workItemId, project_id AS projectId, title, instruction,
      acceptance_json AS acceptanceJson, execution_status AS executionStatus,
      review_status AS reviewStatus, priority, revision,
      created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt
    FROM work_items WHERE work_item_id = ?
  `).get(workItemId);
	if (!row) return null;
	return Object.freeze({
		workItemId: row.workItemId,
		projectId: row.projectId,
		title: row.title,
		instruction: row.instruction,
		acceptance: parseJson(row.acceptanceJson),
		executionStatus: row.executionStatus,
		reviewStatus: row.reviewStatus,
		priority: Number(row.priority),
		revision: Number(row.revision),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		archivedAt: row.archivedAt
	});
}
function selectRun(database, runId) {
	const row = database.prepare(`
    SELECT
      run_id AS runId, project_id AS projectId, work_item_id AS workItemId,
      attempt_no AS attemptNo, status,
      instruction_snapshot_json AS instructionSnapshotJson,
      acceptance_snapshot_json AS acceptanceSnapshotJson,
      revision, created_at AS createdAt, started_at AS startedAt,
      completed_at AS completedAt, updated_at AS updatedAt
    FROM runs WHERE run_id = ?
  `).get(runId);
	if (!row) return null;
	return Object.freeze({
		runId: row.runId,
		projectId: row.projectId,
		workItemId: row.workItemId,
		attemptNo: Number(row.attemptNo),
		status: row.status,
		instructionSnapshot: parseJson(row.instructionSnapshotJson),
		acceptanceSnapshot: parseJson(row.acceptanceSnapshotJson),
		revision: Number(row.revision),
		createdAt: row.createdAt,
		startedAt: row.startedAt,
		completedAt: row.completedAt,
		updatedAt: row.updatedAt
	});
}
function selectQuarantineItem(database, quarantineId) {
	const row = database.prepare(`
    SELECT
      quarantine_id AS quarantineId, project_id AS projectId,
      source_kind AS sourceKind, source_ref AS sourceRef,
      reason_code AS reasonCode, payload_ref AS payloadRef,
      status, details_json AS detailsJson, revision,
      created_at AS createdAt, updated_at AS updatedAt, resolved_at AS resolvedAt
    FROM quarantine_items WHERE quarantine_id = ?
  `).get(quarantineId);
	if (!row) return null;
	return Object.freeze({
		quarantineId: row.quarantineId,
		projectId: row.projectId,
		sourceKind: row.sourceKind,
		sourceRef: row.sourceRef,
		reasonCode: row.reasonCode,
		payloadRef: row.payloadRef,
		status: row.status,
		details: parseJson(row.detailsJson),
		revision: Number(row.revision),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		resolvedAt: row.resolvedAt
	});
}
const REVIEW_COLUMNS = `
  review_id AS reviewId, project_id AS projectId, work_item_id AS workItemId,
  reviewed_work_item_revision AS reviewedWorkItemRevision,
  artifact_refs_json AS artifactRefsJson, status, risk,
  requested_by_json AS requestedByJson, decided_by_json AS decidedByJson,
  revision, created_at AS createdAt, updated_at AS updatedAt, decided_at AS decidedAt
`;
function mapReviewRow(row) {
	return {
		reviewId: row.reviewId,
		projectId: row.projectId,
		workItemId: row.workItemId,
		reviewedWorkItemRevision: row.reviewedWorkItemRevision === null ? null : Number(row.reviewedWorkItemRevision),
		artifactRefs: parseJson(row.artifactRefsJson),
		status: row.status,
		risk: row.risk,
		requestedBy: parseJson(row.requestedByJson),
		decidedBy: row.decidedByJson === null ? null : parseJson(row.decidedByJson),
		revision: Number(row.revision),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		decidedAt: row.decidedAt
	};
}
function selectReview(database, reviewId) {
	const row = database.prepare(`SELECT ${REVIEW_COLUMNS} FROM reviews WHERE review_id = ?`).get(reviewId);
	return row ? Object.freeze(mapReviewRow(row)) : null;
}
function mapReviewActionRow(row) {
	return {
		reviewActionId: row.reviewActionId,
		reviewId: row.reviewId,
		action: row.action,
		actor: parseJson(row.actorRef),
		comment: row.comment,
		createdAt: row.createdAt
	};
}
const PROGRESS_UPDATE_COLUMNS = `
  progress_update_id AS progressUpdateId, project_id AS projectId,
  work_item_id AS workItemId, run_id AS runId, kind, summary,
  needs_json AS needsJson, acceptance_claims_json AS acceptanceClaimsJson,
  evidence_json AS evidenceJson, completion_percent AS completionPercent,
  details, thread_id AS threadId, source_event_id AS sourceEventId,
  command_id AS commandId, aggregate_type AS aggregateType,
  aggregate_id AS aggregateId, aggregate_revision AS aggregateRevision,
  generated_by_json AS generatedByJson, created_at AS createdAt
`;
function mapProgressUpdateRow(row) {
	return {
		progressUpdateId: row.progressUpdateId,
		projectId: row.projectId,
		workItemId: row.workItemId,
		runId: row.runId,
		kind: row.kind,
		summary: row.summary,
		needs: parseJson(row.needsJson),
		acceptanceClaims: parseJson(row.acceptanceClaimsJson),
		evidence: parseJson(row.evidenceJson),
		completionPercent: row.completionPercent === null ? null : Number(row.completionPercent),
		details: row.details,
		threadId: row.threadId,
		sourceEventId: row.sourceEventId,
		commandId: row.commandId,
		aggregateType: row.aggregateType,
		aggregateId: row.aggregateId,
		aggregateRevision: Number(row.aggregateRevision),
		generatedBy: parseJson(row.generatedByJson),
		createdAt: row.createdAt
	};
}
async function openProjectControlStorage(options) {
	requireObject(options, "options");
	const databasePath = validateStoragePath(options.databasePath, "options.databasePath");
	const lockPath = validateStoragePath(`${databasePath}.writer-lock.sqlite3`, "derivedLockPath");
	if (options.lockPath !== void 0) {
		const requestedLockPath = validateStoragePath(options.lockPath, "options.lockPath");
		if (!sameFilesystemPath(lockPath, requestedLockPath)) throw new InvalidStoragePathError("options.lockPath cannot override the database-derived single-writer lock.", {
			expectedLockPath: lockPath,
			requestedLockPath
		});
	}
	const backupDirectory = validateStoragePath(options.backupDirectory ?? join(dirname(databasePath), "backups"), "options.backupDirectory");
	const migrationsDirectory = validateStoragePath(options.migrationsDirectory ?? defaultMigrationsDirectory(), "options.migrationsDirectory");
	const applicationVersion = requireString(options.applicationVersion, "options.applicationVersion");
	const instanceId = requireString(options.instanceId, "options.instanceId");
	const now = options.now ?? defaultNow;
	if (typeof now !== "function") throw new StorageValidationError("options.now must be a function.");
	const idFactory = options.idFactory ?? ((prefix) => createPrefixedUuidV7(prefix));
	if (typeof idFactory !== "function") throw new StorageValidationError("options.idFactory must be a function.");
	const databaseExisted = existsSync(databasePath);
	mkdirSync(dirname(databasePath), { recursive: true });
	const openedAt = now();
	const writerLock = acquireWriterLock({
		lockPath,
		instanceId,
		acquiredAt: openedAt
	});
	let database;
	try {
		database = new DatabaseSync(databasePath, { timeout: 2e3 });
		database.function("project_path_key", { deterministic: true }, projectPathKey);
		database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 2000;
    `);
		const migration = await migrateDatabase({
			database,
			databasePath,
			databaseExisted,
			backupDirectory,
			migrationsDirectory,
			applicationVersion,
			now
		});
		return createStorage({
			database,
			databasePath,
			lockPath,
			writerLock,
			migration,
			instanceId,
			openedAt,
			now,
			idFactory
		});
	} catch (error) {
		if (database) try {
			database.close();
		} catch {}
		writerLock.release();
		throw error;
	}
}
function validateTextList(value, field, required = false) {
	if (value === void 0) {
		if (required) throw new StorageValidationError(`${field} is required.`);
		return [];
	}
	if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new StorageValidationError(`${field} must be an array of 1..50 strings.`);
	return value.map((item, index) => requireBoundedString(item, `${field}[${index}]`, 1e3));
}
function validateEvidenceList(value, field, required = false) {
	if (value === void 0) {
		if (required) throw new StorageValidationError(`${field} is required.`);
		return [];
	}
	if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new StorageValidationError(`${field} must be an array of 1..100 evidence references.`);
	return value.map((raw, index) => {
		const evidence = requireObject(raw, `${field}[${index}]`);
		const kind = requireString(evidence.kind, `${field}[${index}].kind`);
		const contentHash = evidence.contentHash === void 0 ? null : requireString(evidence.contentHash, `${field}[${index}].contentHash`);
		if (contentHash !== null && !CONTENT_HASH$1.test(contentHash)) throw new StorageValidationError(`${field}[${index}].contentHash is invalid.`, { index });
		const title = evidence.title === void 0 ? null : requireBoundedString(evidence.title, `${field}[${index}].title`, 200);
		if (kind === "workspace_file") {
			const relativePath = requireString(evidence.relativePath, `${field}[${index}].relativePath`);
			if (!RELATIVE_PATH$1.test(relativePath)) throw new StorageValidationError(`${field}[${index}].relativePath is invalid.`, { index });
			return {
				kind,
				workspaceRef: requireBoundedString(evidence.workspaceRef, `${field}[${index}].workspaceRef`, 127),
				relativePath,
				...contentHash === null ? {} : { contentHash },
				...title === null ? {} : { title }
			};
		}
		if (![
			"artifact",
			"event",
			"test"
		].includes(kind)) throw new StorageValidationError(`${field}[${index}].kind is not supported.`, { index });
		const ref = requireBoundedString(evidence.ref, `${field}[${index}].ref`, 255);
		if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(ref)) throw new StorageValidationError(`${field}[${index}].ref is invalid.`, { index });
		return {
			kind,
			ref,
			...contentHash === null ? {} : { contentHash },
			...title === null ? {} : { title }
		};
	});
}
function validateExternalUpdateCommand$1(command) {
	requireObject(command, "command");
	requireString(command.commandId, "command.commandId");
	requireString(command.correlationId, "command.correlationId");
	requireString(command.idempotencyKey, "command.idempotencyKey");
	const kind = requireString(command.kind, "command.kind");
	if (!EXTERNAL_UPDATE_KINDS.has(kind)) throw new StorageValidationError("command.kind must be an external runtime update kind.");
	requireTimestamp(command.occurredAt, "command.occurredAt");
	const actor = requireObject(command.actor, "command.actor");
	requireString(actor.applicationId, "command.actor.applicationId");
	const target = requireObject(command.target, "command.target");
	const projectId = requireString(target.projectId, "command.target.projectId");
	const workItemId = requireString(target.workItemId, "command.target.workItemId");
	const runId = requireString(target.runId, "command.target.runId");
	const threadId = requireString(target.threadId, "command.target.threadId");
	const aggregateType = requireString(target.aggregateType, "command.target.aggregateType");
	const aggregateId = requireString(target.aggregateId, "command.target.aggregateId");
	if (!BUSINESS_IDS.cmd.test(command.commandId) || !BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.wrk.test(workItemId) || !BUSINESS_IDS.run.test(runId)) throw new StorageValidationError("External update ids must use their prefixed UUIDv7 shapes.");
	if (!THREAD_ID_PATTERN.test(threadId)) throw new StorageValidationError("command.target.threadId is invalid.");
	if (aggregateType === "work_item" && aggregateId !== workItemId) throw new StorageValidationError("work_item aggregateId must equal target.workItemId.");
	if (aggregateType === "run" && aggregateId !== runId) throw new StorageValidationError("run aggregateId must equal target.runId.");
	if (!["work_item", "run"].includes(aggregateType)) throw new StorageValidationError("command.target.aggregateType is not supported.");
	const expectedRevision = requireInteger(command.expectedRevision, "command.expectedRevision", 1);
	const provenance = requireObject(command.provenance, "command.provenance");
	const sourceType = requireString(provenance.sourceType, "command.provenance.sourceType");
	if (![
		"human",
		"agent",
		"harness",
		"imported_document",
		"system"
	].includes(sourceType)) throw new StorageValidationError("command.provenance.sourceType is not supported.");
	requireBoundedString(provenance.sourceId, "command.provenance.sourceId", 255);
	requireBoundedString(provenance.applicationVersion, "command.provenance.applicationVersion", 64);
	const applicationInstanceId = requireString(provenance.applicationInstanceId, "command.provenance.applicationInstanceId");
	if (!INSTANCE_ID_PATTERN$1.test(applicationInstanceId)) throw new StorageValidationError("command.provenance.applicationInstanceId is invalid.");
	requireTimestamp(provenance.observedAt, "command.provenance.observedAt");
	if (provenance.adapterId === void 0 !== (provenance.adapterVersion === void 0)) throw new StorageValidationError("adapterId and adapterVersion must appear together.");
	if (provenance.contentHash !== void 0 && !CONTENT_HASH$1.test(requireString(provenance.contentHash, "command.provenance.contentHash"))) throw new StorageValidationError("command.provenance.contentHash is invalid.");
	const payload = requireObject(command.payload, "command.payload");
	const summary = requireBoundedString(payload.summary, "command.payload.summary", 1e3);
	let normalizedPayload;
	if (kind === "progress.report") {
		normalizedPayload = {
			summary,
			...payload.details === void 0 ? {} : { details: requireBoundedString(payload.details, "command.payload.details", 2e4) },
			...payload.completionPercent === void 0 ? {} : { completionPercent: requireInteger(payload.completionPercent, "command.payload.completionPercent", 0) },
			...payload.nextSteps === void 0 ? {} : { nextSteps: validateTextList(payload.nextSteps, "command.payload.nextSteps") },
			...payload.evidence === void 0 ? {} : { evidence: validateEvidenceList(payload.evidence, "command.payload.evidence") }
		};
		if (payload.completionPercent !== void 0 && payload.completionPercent > 100) throw new StorageValidationError("command.payload.completionPercent cannot exceed 100.");
	} else if (kind === "blocker.raise") normalizedPayload = {
		summary,
		impact: requireBoundedString(payload.impact, "command.payload.impact", 4e3),
		needs: validateTextList(payload.needs, "command.payload.needs", true),
		...payload.evidence === void 0 ? {} : { evidence: validateEvidenceList(payload.evidence, "command.payload.evidence") }
	};
	else normalizedPayload = {
		summary,
		acceptanceClaims: validateTextList(payload.acceptanceClaims, "command.payload.acceptanceClaims", true),
		evidence: validateEvidenceList(payload.evidence, "command.payload.evidence", true)
	};
	canonicalJson(command);
	return Object.freeze({
		commandId: command.commandId,
		correlationId: command.correlationId,
		idempotencyKey: command.idempotencyKey,
		kind,
		occurredAt: command.occurredAt,
		actor,
		target: Object.freeze({
			projectId,
			workItemId,
			runId,
			threadId,
			aggregateType,
			aggregateId
		}),
		expectedRevision,
		provenance,
		payload: Object.freeze(normalizedPayload),
		extensions: command.extensions ?? null
	});
}
function createStorage({ database, databasePath, lockPath, writerLock, migration, instanceId, openedAt, now, idFactory }) {
	let closed = false;
	let lastCounts = {
		projectCount: 0,
		archivedProjectCount: 0
	};
	const ensureOpen = () => {
		if (closed) throw new StorageValidationError("Project Control storage is closed.");
	};
	function rejectAndRecord(command, identity, code, message, currentRevision) {
		const recordedAt = now();
		const result = rejectionResult(command, recordedAt, code, message, currentRevision);
		insertReceipt(database, command, identity, "rejected", recordedAt, result, result.error);
		return Object.freeze(result);
	}
	function rejectExternalUpdate(command, identity, code, message, currentRevision) {
		const recordedAt = now();
		const result = {
			protocolVersion: PROTOCOL_VERSION$1,
			schemaVersion: EXTERNAL_RESULT_SCHEMA_VERSION,
			commandId: command.commandId,
			correlationId: command.correlationId,
			kind: command.kind,
			status: "rejected",
			recordedAt,
			...currentRevision === void 0 ? {} : { currentRevision },
			error: {
				code,
				message
			}
		};
		insertReceipt(database, command, identity, "rejected", recordedAt, result, result.error);
		return Object.freeze(result);
	}
	/**
	* Console-driven commands ride the same audit rails as protocol commands:
	* one CommandReceipt, one append-only domain event, no outbox row (they have
	* no renderer or external consumer). Aggregate revisions always equal the
	* affected row revision so the event stream can never collide with
	* external-update events, which use the same convention.
	*/
	function recordConsoleEvent({ projectId, aggregateType, aggregateId, beforeRevision, afterRevision, eventType, data, recordedAt }) {
		const commandId = createBusinessId(idFactory, "cmd", "consoleCommandId");
		const command = {
			commandId,
			correlationId: commandId,
			idempotencyKey: `console.${eventType}.${commandId}`,
			kind: `console.${eventType}`,
			occurredAt: recordedAt,
			actor: CONSOLE_ACTOR,
			target: {
				projectId,
				aggregateType,
				aggregateId
			},
			expectedRevision: beforeRevision,
			provenance: {
				sourceType: "human",
				sourceId: "desktop-console"
			},
			payload: data
		};
		insertReceipt(database, command, commandIdentity(command), "accepted", recordedAt, {
			protocolVersion: PROTOCOL_VERSION$1,
			schemaVersion: "console-command-result/v1alpha1",
			commandId,
			correlationId: commandId,
			kind: command.kind,
			status: "accepted",
			recordedAt,
			aggregateType,
			aggregateId,
			aggregateRevision: afterRevision
		}, null);
		const event = {
			protocolVersion: PROTOCOL_VERSION$1,
			schemaVersion: "console-event/v1alpha1",
			eventId: idFactory("evt"),
			eventType,
			occurredAt: recordedAt,
			recordedAt,
			sequence: nextSequence(database),
			actor: CONSOLE_ACTOR,
			target: command.target,
			beforeRevision,
			afterRevision,
			causation: {
				commandId,
				idempotencyKey: command.idempotencyKey,
				correlationId: commandId
			},
			provenance: command.provenance,
			data
		};
		insertEvent(database, event, command, aggregateType, aggregateId);
		return Object.freeze(event);
	}
	const storage = {
		status() {
			if (!closed) {
				const counts = database.prepare(`
          SELECT
            count(*) FILTER (WHERE archived_at IS NULL) AS projectCount,
            count(*) FILTER (WHERE archived_at IS NOT NULL) AS archivedProjectCount
          FROM projects
        `).get();
				lastCounts = {
					projectCount: Number(counts.projectCount),
					archivedProjectCount: Number(counts.archivedProjectCount)
				};
			}
			return Object.freeze({
				state: closed ? "closed" : "ready",
				databasePath,
				lockPath,
				instanceId,
				openedAt,
				schemaVersion: migration.currentVersion,
				migrationsAppliedThisOpen: migration.applied.length,
				migrationBackupPath: migration.backupPath,
				journalMode: "wal",
				foreignKeys: true,
				singleWriter: true,
				...lastCounts
			});
		},
		recordImportScan(input) {
			ensureOpen();
			const scan = validateImportScan(input);
			const recordedAt = requireTimestamp(now(), "now()");
			const startedAt = scan.startedAt ?? recordedAt;
			const completedAt = scan.completedAt ?? recordedAt;
			if (Date.parse(completedAt) < Date.parse(startedAt)) throw new StorageValidationError("scan.completedAt cannot precede scan.startedAt.");
			const persisted = executeWrite(database, () => {
				let sourceRoot = database.prepare(`
          SELECT source_root_id AS sourceRootId, kind
          FROM project_source_roots WHERE path_key = ?
        `).get(scan.sourcePath.pathKey);
				if (sourceRoot) {
					const kind = sourceRoot.kind === "source_root" || scan.mode === "source_root" ? "source_root" : "single_project";
					database.prepare(`
            UPDATE project_source_roots
            SET kind = ?, display_path = ?, scan_preferences_json = ?, is_enabled = ?,
              revision = revision + 1, updated_at = ?
            WHERE source_root_id = ?
          `).run(kind, scan.sourcePath.displayPath, scan.sourcePreferencesJson, scan.sourceEnabled ? 1 : 0, recordedAt, sourceRoot.sourceRootId);
				} else {
					sourceRoot = {
						sourceRootId: createBusinessId(idFactory, "src", "sourceRootId"),
						kind: scan.mode
					};
					database.prepare(`
            INSERT INTO project_source_roots(
              source_root_id, kind, display_path, normalized_path, path_key,
              scan_preferences_json, is_enabled, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `).run(sourceRoot.sourceRootId, scan.mode, scan.sourcePath.displayPath, scan.sourcePath.normalizedPath, scan.sourcePath.pathKey, scan.sourcePreferencesJson, scan.sourceEnabled ? 1 : 0, recordedAt, recordedAt);
				}
				const importJobId = createBusinessId(idFactory, "job", "importJobId");
				database.prepare(`
          INSERT INTO import_jobs(
            import_job_id, source_root_id, root_path_snapshot,
            root_normalized_path_snapshot, scan_preferences_snapshot_json,
            mode, status, scanner_version, started_at, completed_at, summary_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(importJobId, sourceRoot.sourceRootId, scan.rootPath.displayPath, scan.rootPath.normalizedPath, scan.scanPreferencesJson, scan.mode, scan.status, scan.scannerVersion, startedAt, completedAt, scan.summaryJson);
				const insertJobIssue = database.prepare(`
          INSERT INTO import_job_issues(
            import_job_issue_id, import_job_id, code, severity,
            details_json, status, resolved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
				for (const issue of scan.issues) insertJobIssue.run(createBusinessId(idFactory, "jis", "importJobIssueId"), importJobId, issue.code, issue.severity, issue.detailsJson, issue.status, issue.resolvedAt);
				const candidateIds = [];
				for (const candidate of scan.candidates) {
					const candidateId = createBusinessId(idFactory, "can", "candidateId");
					candidateIds.push(candidateId);
					let status = candidate.status;
					let statusBeforeIgnored = null;
					let matchedProjectId = null;
					const activeProject = database.prepare(`
            SELECT project_id AS projectId
            FROM workspace_locations
            WHERE path_key = ? AND is_active = 1
            LIMIT 1
          `).get(candidate.root.pathKey);
					if (activeProject) {
						status = "imported";
						matchedProjectId = activeProject.projectId;
					} else if (database.prepare(`
              SELECT status, status_before_ignored AS statusBeforeIgnored
              FROM import_candidates
              WHERE root_path_key = ?
              ORDER BY rowid DESC
              LIMIT 1
            `).get(candidate.root.pathKey)?.status === "ignored") {
						status = "ignored";
						statusBeforeIgnored = candidate.status;
					}
					database.prepare(`
            INSERT INTO import_candidates(
              candidate_id, import_job_id, source_root_id,
              root_display_path, root_normalized_path, root_path_key, detected_mode,
              manifest_project_id, suggested_name, suggested_summary, summary_source,
              confidence_json, status, status_before_ignored, matched_project_id,
              revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `).run(candidateId, importJobId, sourceRoot.sourceRootId, candidate.root.displayPath, candidate.root.normalizedPath, candidate.root.pathKey, candidate.detectedMode, candidate.manifestProjectId, candidate.suggestedName, candidate.suggestedSummary, candidate.summarySource, candidate.confidenceJson, status, statusBeforeIgnored, matchedProjectId, recordedAt, recordedAt);
					const insertDocument = database.prepare(`
            INSERT INTO import_candidate_documents(
              candidate_document_id, candidate_id, relative_path, suggested_role,
              sha256, title, preview, observed_at, evidence_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
					for (const document of candidate.documents) insertDocument.run(createBusinessId(idFactory, "doc", "candidateDocumentId"), candidateId, document.relativePath, document.suggestedRole, document.sha256, document.title, document.preview, document.observedAt ?? recordedAt, document.evidenceJson);
					const insertIssue = database.prepare(`
            INSERT INTO import_issues(
              import_issue_id, candidate_id, code, severity,
              details_json, status, resolved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
					for (const issue of candidate.issues) insertIssue.run(createBusinessId(idFactory, "iss", "importIssueId"), candidateId, issue.code, issue.severity, issue.detailsJson, issue.status, issue.resolvedAt);
				}
				return {
					sourceRootId: sourceRoot.sourceRootId,
					importJobId,
					candidateIds
				};
			});
			const job = selectImportJob(database, persisted.importJobId);
			return Object.freeze({
				sourceRoot: selectSourceRoot(database, persisted.sourceRootId),
				job,
				issues: job.issues,
				candidates: persisted.candidateIds.map((candidateId) => selectImportCandidate(database, candidateId))
			});
		},
		getSourceRoot(sourceRootId) {
			ensureOpen();
			requireString(sourceRootId, "sourceRootId");
			return selectSourceRoot(database, sourceRootId);
		},
		listSourceRoots({ isEnabled = null, limit = 100, afterSourceRootId = "" } = {}) {
			ensureOpen();
			if (isEnabled !== null && typeof isEnabled !== "boolean") throw new StorageValidationError("isEnabled must be boolean or null.");
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			if (afterSourceRootId !== "") requireString(afterSourceRootId, "afterSourceRootId");
			return database.prepare(`
        SELECT
          source_root_id AS sourceRootId, kind, display_path AS displayPath,
          normalized_path AS normalizedPath, scan_preferences_json AS scanPreferencesJson,
          is_enabled AS isEnabled, revision, created_at AS createdAt, updated_at AS updatedAt
        FROM project_source_roots
        WHERE source_root_id > ? AND (? IS NULL OR is_enabled = ?)
        ORDER BY source_root_id
        LIMIT ?
      `).all(afterSourceRootId, isEnabled === null ? null : isEnabled ? 1 : 0, isEnabled ? 1 : 0, limit).map((row) => Object.freeze(mapSourceRoot(row)));
		},
		getImportJob(importJobId) {
			ensureOpen();
			requireString(importJobId, "importJobId");
			return selectImportJob(database, importJobId);
		},
		listImportJobs({ sourceRootId = null, status = null, limit = 100, afterImportJobId = "" } = {}) {
			ensureOpen();
			if (sourceRootId !== null) requireString(sourceRootId, "sourceRootId");
			if (status !== null && ![
				"completed",
				"failed",
				"cancelled"
			].includes(status)) throw new StorageValidationError("Import job status is not supported.");
			requireInteger(limit, "limit", 1);
			if (limit > 100) throw new StorageValidationError("Import job detail limit cannot exceed 100.");
			if (afterImportJobId !== "") requireString(afterImportJobId, "afterImportJobId");
			return database.prepare(`
        SELECT import_job_id AS importJobId
        FROM import_jobs
        WHERE import_job_id > ?
          AND (? IS NULL OR source_root_id = ?)
          AND (? IS NULL OR status = ?)
        ORDER BY import_job_id
        LIMIT ?
      `).all(afterImportJobId, sourceRootId, sourceRootId, status, status, limit).map((row) => selectImportJob(database, row.importJobId));
		},
		getImportCandidate(candidateId) {
			ensureOpen();
			requireString(candidateId, "candidateId");
			return selectImportCandidate(database, candidateId);
		},
		listImportCandidates({ sourceRootId = null, importJobId = null, status = null, latestPerPath = false, limit = 100, afterCandidateId = "" } = {}) {
			ensureOpen();
			if (sourceRootId !== null) requireString(sourceRootId, "sourceRootId");
			if (importJobId !== null) requireString(importJobId, "importJobId");
			if (status !== null && ![
				"discovered",
				"conflict",
				"relocation_candidate",
				"ignored",
				"imported"
			].includes(status)) throw new StorageValidationError("Import candidate status is not supported.");
			if (typeof latestPerPath !== "boolean") throw new StorageValidationError("latestPerPath must be boolean.");
			requireInteger(limit, "limit", 1);
			if (limit > 100) throw new StorageValidationError("Candidate detail limit cannot exceed 100.");
			if (afterCandidateId !== "") requireString(afterCandidateId, "afterCandidateId");
			let beforeRowId = null;
			if (afterCandidateId !== "") {
				const cursor = database.prepare(`
          SELECT rowid AS rowId FROM import_candidates WHERE candidate_id = ?
        `).get(afterCandidateId);
				if (!cursor) throw new StorageValidationError("Import candidate pagination cursor was not found.", { reason: "candidate_cursor_not_found" });
				beforeRowId = Number(cursor.rowId);
			}
			return database.prepare(`
        SELECT c.candidate_id AS candidateId
        FROM import_candidates c
        WHERE (? IS NULL OR c.rowid < ?)
          AND (? IS NULL OR c.source_root_id = ?)
          AND (? IS NULL OR c.import_job_id = ?)
          AND (? IS NULL OR c.status = ?)
          AND (
            ? = 0
            OR NOT EXISTS (
              SELECT 1
              FROM import_candidates newer
              WHERE newer.root_path_key = c.root_path_key
                AND newer.rowid > c.rowid
            )
          )
        ORDER BY c.rowid DESC
        LIMIT ?
      `).all(beforeRowId, beforeRowId, sourceRootId, sourceRootId, importJobId, importJobId, status, status, latestPerPath ? 1 : 0, limit).map((row) => selectImportCandidate(database, row.candidateId));
		},
		setImportCandidateIgnored(candidateId, ignored, expectedRevision) {
			ensureOpen();
			if (typeof ignored !== "boolean") throw new StorageValidationError("ignored must be boolean.");
			return executeWrite(database, () => {
				const current = requireCandidateRevision$1(database, candidateId, expectedRevision);
				if (current.status === "imported") throw new StorageValidationError("An imported candidate cannot be ignored.", {
					reason: "candidate_already_imported",
					candidateId
				});
				if (ignored && current.status === "ignored" || !ignored && current.status !== "ignored") return selectImportCandidate(database, candidateId);
				const updatedAt = requireTimestamp(now(), "now()");
				if (ignored) database.prepare(`
            UPDATE import_candidates
            SET status_before_ignored = status, status = 'ignored',
              revision = revision + 1, updated_at = ?
            WHERE candidate_id = ? AND revision = ?
          `).run(updatedAt, candidateId, expectedRevision);
				else database.prepare(`
            UPDATE import_candidates
            SET status = status_before_ignored, status_before_ignored = NULL,
              revision = revision + 1, updated_at = ?
            WHERE candidate_id = ? AND revision = ?
          `).run(updatedAt, candidateId, expectedRevision);
				return selectImportCandidate(database, candidateId);
			});
		},
		setImportCandidateStatus(candidateId, status, expectedRevision) {
			ensureOpen();
			if (!CANDIDATE_STATES.has(status)) throw new StorageValidationError("Candidate status must be a non-terminal discovery status.");
			return executeWrite(database, () => {
				const current = requireCandidateRevision$1(database, candidateId, expectedRevision);
				if (current.status === "imported" || current.status === "ignored") throw new StorageValidationError("Use the dedicated import or ignore transition for this candidate.", {
					reason: "invalid_candidate_transition",
					candidateId
				});
				if (current.status === status) return selectImportCandidate(database, candidateId);
				database.prepare(`
          UPDATE import_candidates
          SET status = ?, revision = revision + 1, updated_at = ?
          WHERE candidate_id = ? AND revision = ?
        `).run(status, requireTimestamp(now(), "now()"), candidateId, expectedRevision);
				return selectImportCandidate(database, candidateId);
			});
		},
		issueImportCandidateRefs(candidateId, options) {
			ensureOpen();
			const context = validateReferenceContext(options);
			const ttlSeconds = options.ttlSeconds ?? 300;
			requireInteger(ttlSeconds, "options.ttlSeconds", 1);
			if (ttlSeconds > 3600) throw new StorageValidationError("Reference ttlSeconds cannot exceed 3600.");
			requireInteger(options.expectedRevision, "options.expectedRevision", 1);
			const issuedAt = requireTimestamp(now(), "now()");
			const expiresAt = new Date(Date.parse(issuedAt) + ttlSeconds * 1e3).toISOString();
			return executeWrite(database, () => {
				const current = requireCandidateRevision$1(database, candidateId, options.expectedRevision);
				if (!CANDIDATE_STATES.has(current.status)) throw new StorageValidationError("Only an active discovery candidate can receive lifecycle refs.", {
					reason: "candidate_not_issuable",
					candidateId
				});
				const candidate = database.prepare(`
          SELECT
            c.source_root_id AS sourceRootId,
            c.root_display_path AS displayPath, c.root_normalized_path AS normalizedPath,
            s.normalized_path AS sourceNormalizedPath, s.is_enabled AS sourceEnabled
          FROM import_candidates c
          JOIN project_source_roots s ON s.source_root_id = c.source_root_id
          WHERE c.candidate_id = ?
        `).get(candidateId);
				if (!Boolean(candidate.sourceEnabled)) throw new StorageValidationError("The source root is disabled.", { reason: "source_root_disabled" });
				if (!pathIsWithin$1(candidate.sourceNormalizedPath, candidate.normalizedPath)) throw new StorageValidationError("The candidate no longer belongs to its source root.", { reason: "candidate_outside_source_root" });
				const locationRef = createBusinessId(idFactory, "loc", "locationRef");
				const sourceRootRef = createBusinessId(idFactory, "srt", "sourceRootRef");
				database.prepare(`
          INSERT INTO intake_location_refs(
            location_ref, candidate_id, source_root_id, application_instance_id,
            scope, display_path, normalized_path, issued_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(locationRef, candidateId, candidate.sourceRootId, context.applicationInstanceId, context.scope, candidate.displayPath, candidate.normalizedPath, issuedAt, expiresAt);
				database.prepare(`
          INSERT INTO intake_source_root_refs(
            source_root_ref, candidate_id, source_root_id, application_instance_id,
            scope, issued_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(sourceRootRef, candidateId, candidate.sourceRootId, context.applicationInstanceId, context.scope, issuedAt, expiresAt);
				return Object.freeze({
					candidateRef: candidateId,
					locationRef,
					sourceRootRef,
					scope: context.scope,
					expiresAt
				});
			});
		},
		resolveLocationRef(locationRef, referenceContext) {
			ensureOpen();
			if (!BUSINESS_IDS.loc.test(requireString(locationRef, "locationRef"))) throw referenceResolutionError("reference_shape_invalid");
			const context = validateReferenceContext(referenceContext);
			const observedAt = requireTimestamp(now(), "now()");
			const row = validateResolvedReference(selectLocationRef(database, locationRef), context, observedAt);
			if (!pathIsWithin$1(row.sourceNormalizedPath, row.normalizedPath)) throw referenceResolutionError("location_outside_source_root");
			if (!sameFilesystemPath(row.normalizedPath, row.candidateNormalizedPath)) throw referenceResolutionError("candidate_location_mismatch");
			return Object.freeze({
				candidateId: row.candidateId,
				sourceRootId: row.sourceRootId,
				locationId: row.locationRef,
				kind: "primary",
				displayPath: row.displayPath,
				normalizedPath: row.normalizedPath,
				verifiedAt: row.issuedAt,
				expiresAt: row.expiresAt
			});
		},
		resolveSourceRootRef(sourceRootRef, referenceContext) {
			ensureOpen();
			if (!BUSINESS_IDS.srt.test(requireString(sourceRootRef, "sourceRootRef"))) throw referenceResolutionError("reference_shape_invalid");
			const context = validateReferenceContext(referenceContext);
			const row = validateResolvedReference(selectSourceRootRef(database, sourceRootRef), context, requireTimestamp(now(), "now()"));
			return Object.freeze({
				candidateId: row.candidateId,
				sourceRootId: row.sourceRootId,
				sourceRootRef: row.sourceRootRef,
				displayPath: row.sourceDisplayPath,
				normalizedPath: row.sourceNormalizedPath,
				verifiedAt: row.issuedAt,
				expiresAt: row.expiresAt
			});
		},
		resolveRegistrationRefs(candidateId, refs, referenceContext) {
			ensureOpen();
			requireString(candidateId, "candidateId");
			const pair = requireObject(refs, "refs");
			if (!BUSINESS_IDS.loc.test(requireString(pair.locationRef, "refs.locationRef")) || !BUSINESS_IDS.srt.test(requireString(pair.sourceRootRef, "refs.sourceRootRef"))) throw referenceResolutionError("reference_shape_invalid");
			const context = validateReferenceContext(referenceContext);
			const observedAt = requireTimestamp(now(), "now()");
			const location = validateResolvedReference(selectLocationRef(database, pair.locationRef), context, observedAt);
			const sourceRoot = validateResolvedReference(selectSourceRootRef(database, pair.sourceRootRef), context, observedAt);
			if (location.candidateId !== candidateId || sourceRoot.candidateId !== candidateId || location.sourceRootId !== sourceRoot.sourceRootId) throw referenceResolutionError("reference_pair_mismatch");
			if (!sameFilesystemPath(location.normalizedPath, location.candidateNormalizedPath)) throw referenceResolutionError("candidate_location_mismatch");
			if (!pathIsWithin$1(sourceRoot.sourceNormalizedPath, location.normalizedPath)) throw referenceResolutionError("location_outside_source_root");
			return Object.freeze({
				candidateId,
				sourceRoot: {
					sourceRootId: sourceRoot.sourceRootId,
					sourceRootRef: sourceRoot.sourceRootRef,
					displayPath: sourceRoot.sourceDisplayPath,
					normalizedPath: sourceRoot.sourceNormalizedPath,
					verifiedAt: sourceRoot.issuedAt
				},
				location: {
					locationId: location.locationRef,
					kind: "primary",
					displayPath: location.displayPath,
					normalizedPath: location.normalizedPath,
					verifiedAt: location.issuedAt
				},
				expiresAt: location.expiresAt < sourceRoot.expiresAt ? location.expiresAt : sourceRoot.expiresAt
			});
		},
		getProject(projectId) {
			ensureOpen();
			requireString(projectId, "projectId");
			const row = database.prepare(`
        SELECT
          project_id AS projectId, mode, name, origin_kind AS originKind,
          template_id AS templateId, template_version AS templateVersion,
          forked_from_project_id AS forkedFromProjectId, lifecycle, health,
          revision, created_at AS createdAt, updated_at AS updatedAt,
          archived_at AS archivedAt
        FROM projects WHERE project_id = ?
      `).get(projectId);
			if (!row) return null;
			const locations = database.prepare(`
        SELECT
          location_id AS locationId, project_id AS projectId, kind,
          display_path AS displayPath, normalized_path AS normalizedPath,
          is_active AS isActive, verified_at AS verifiedAt, revision,
          created_at AS createdAt, updated_at AS updatedAt
        FROM workspace_locations
        WHERE project_id = ?
        ORDER BY is_active DESC, kind, location_id
      `).all(projectId);
			const documentBindings = database.prepare(`
        SELECT
          role, relative_path AS relativePath, content_hash AS contentHash,
          is_required AS isRequired, source, confirmed_at AS confirmedAt, revision
        FROM project_document_bindings
        WHERE project_id = ?
        ORDER BY role, relative_path
      `).all(projectId).map(mapDocumentBinding);
			const manifestRow = database.prepare(`
        SELECT
          protocol_version AS protocolVersion, manifest_hash AS manifestHash,
          name, origin_json AS originJson,
          document_bindings_json AS documentBindingsJson,
          verified_at AS verifiedAt, revision
        FROM project_manifest_mirrors
        WHERE project_id = ?
      `).get(projectId);
			const project = mapProject(row, locations);
			project.documentBindings = documentBindings;
			project.manifestMirror = manifestRow ? {
				protocolVersion: manifestRow.protocolVersion,
				manifestHash: manifestRow.manifestHash,
				name: manifestRow.name,
				origin: parseJson(manifestRow.originJson),
				documentBindings: parseJson(manifestRow.documentBindingsJson),
				verifiedAt: manifestRow.verifiedAt,
				revision: Number(manifestRow.revision)
			} : null;
			return Object.freeze(project);
		},
		listProjects({ includeArchived = false, limit = 100, afterProjectId = "" } = {}) {
			ensureOpen();
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			return database.prepare(`
        SELECT
          p.project_id AS projectId, p.mode, p.name, p.origin_kind AS originKind,
          p.template_id AS templateId, p.template_version AS templateVersion,
          p.forked_from_project_id AS forkedFromProjectId, p.lifecycle, p.health,
          p.revision, p.created_at AS createdAt, p.updated_at AS updatedAt,
          p.archived_at AS archivedAt,
          l.location_id AS activeLocationId, l.display_path AS activeDisplayPath,
          l.normalized_path AS activeNormalizedPath
        FROM projects p
        LEFT JOIN workspace_locations l
          ON l.project_id = p.project_id AND l.kind = 'primary' AND l.is_active = 1
        WHERE p.project_id > ? AND (? = 1 OR p.archived_at IS NULL)
        ORDER BY p.project_id
        LIMIT ?
      `).all(afterProjectId, includeArchived ? 1 : 0, limit).map((row) => Object.freeze({
				...mapProject(row),
				activeLocation: row.activeLocationId ? {
					locationId: row.activeLocationId,
					displayPath: row.activeDisplayPath,
					normalizedPath: row.activeNormalizedPath
				} : null
			}));
		},
		getCommandReceipt(commandId) {
			ensureOpen();
			requireString(commandId, "commandId");
			const row = findReceiptByCommandId(database, commandId);
			return row ? Object.freeze(mapReceipt(row)) : null;
		},
		replayCommandReceipt(command) {
			ensureOpen();
			validateCommand(command);
			const identity = commandIdentity(command);
			return replayOrThrow(findExistingReceipt(database, identity), identity);
		},
		listEvents({ afterSequence = 0, projectId = null, limit = 100 } = {}) {
			ensureOpen();
			requireInteger(afterSequence, "afterSequence");
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			if (projectId !== null) requireString(projectId, "projectId");
			return database.prepare(`
        SELECT
          event_id AS eventId, global_sequence AS sequence, project_id AS projectId,
          aggregate_type AS aggregateType, aggregate_id AS aggregateId,
          before_revision AS beforeRevision, aggregate_revision AS afterRevision,
          event_type AS eventType, schema_version AS schemaVersion,
          payload_json AS payloadJson, actor_ref AS actorRef,
          provenance_json AS provenanceJson, command_id AS commandId,
          correlation_id AS correlationId, causation_id AS causationId,
          occurred_at AS occurredAt, recorded_at AS recordedAt
        FROM domain_events
        WHERE global_sequence > ? AND (? IS NULL OR project_id = ?)
        ORDER BY global_sequence
        LIMIT ?
      `).all(afterSequence, projectId, projectId, limit).map((row) => Object.freeze(mapEvent(row)));
		},
		listOutbox({ status = null, limit = 100 } = {}) {
			ensureOpen();
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			if (status !== null && ![
				"pending",
				"dispatching",
				"delivered",
				"failed"
			].includes(status)) throw new StorageValidationError("Unsupported outbox status.");
			return database.prepare(`
        SELECT
          outbox_id AS outboxId, event_id AS eventId, destination, message_key AS messageKey,
          schema_version AS schemaVersion, payload_json AS payloadJson, status,
          attempt_count AS attemptCount, next_attempt_at AS nextAttemptAt,
          delivered_at AS deliveredAt, last_error AS lastError,
          created_at AS createdAt, updated_at AS updatedAt
        FROM outbox_messages
        WHERE (? IS NULL OR status = ?)
        ORDER BY created_at, outbox_id
        LIMIT ?
      `).all(status, status, limit).map((row) => {
				const { payloadJson, ...fields } = row;
				return Object.freeze({
					...fields,
					attemptCount: Number(row.attemptCount),
					payload: parseJson(payloadJson)
				});
			});
		},
		transitionOutboxMessage(outboxId, expectedStatus, next) {
			ensureOpen();
			requireString(outboxId, "outboxId");
			if (!BUSINESS_IDS.out.test(outboxId)) throw new StorageValidationError("outboxId must be an out_ UUIDv7.");
			if (!["pending", "dispatching"].includes(expectedStatus)) throw new StorageValidationError("Unsupported expected outbox status.");
			requireObject(next, "next");
			const status = requireString(next.status, "next.status");
			if (![
				"pending",
				"dispatching",
				"delivered",
				"failed"
			].includes(status)) throw new StorageValidationError("Unsupported outbox status.");
			const attemptCount = requireInteger(next.attemptCount, "next.attemptCount", 1);
			const deliveredAt = next.deliveredAt === void 0 || next.deliveredAt === null ? null : requireTimestamp(next.deliveredAt, "next.deliveredAt");
			const nextAttemptAt = next.nextAttemptAt === void 0 || next.nextAttemptAt === null ? null : requireTimestamp(next.nextAttemptAt, "next.nextAttemptAt");
			const lastError = next.lastError === void 0 || next.lastError === null ? null : requireBoundedString(next.lastError, "next.lastError", 1e3);
			const updatedAt = requireTimestamp(now(), "now()");
			return executeWrite(database, () => {
				const existing = database.prepare("SELECT status FROM outbox_messages WHERE outbox_id = ?").get(outboxId);
				if (!existing) throw new StorageValidationError("The outbox message does not exist.", { reason: "outbox_not_found" });
				if (existing.status !== expectedStatus) return null;
				database.prepare(`
          UPDATE outbox_messages
          SET status = ?, attempt_count = ?, next_attempt_at = ?, delivered_at = ?,
            last_error = ?, updated_at = ?
          WHERE outbox_id = ? AND status = ?
        `).run(status, attemptCount, nextAttemptAt, deliveredAt, lastError, updatedAt, outboxId, expectedStatus);
				const row = database.prepare(`
          SELECT
            outbox_id AS outboxId, event_id AS eventId, destination, message_key AS messageKey,
            schema_version AS schemaVersion, payload_json AS payloadJson, status,
            attempt_count AS attemptCount, next_attempt_at AS nextAttemptAt,
            delivered_at AS deliveredAt, last_error AS lastError,
            created_at AS createdAt, updated_at AS updatedAt
          FROM outbox_messages WHERE outbox_id = ?
        `).get(outboxId);
				const { payloadJson, ...fields } = row;
				return Object.freeze({
					...fields,
					attemptCount: Number(row.attemptCount),
					payload: parseJson(payloadJson)
				});
			});
		},
		recordRejectedCommand(command, rejectedResult) {
			ensureOpen();
			validateCommand(command);
			requireObject(rejectedResult, "rejectedResult");
			if (rejectedResult.status !== "rejected" || rejectedResult.commandId !== command.commandId || rejectedResult.correlationId !== command.correlationId || rejectedResult.kind !== command.kind) throw new StorageValidationError("Rejected result identity does not match its full command.");
			requireString(rejectedResult.recordedAt, "rejectedResult.recordedAt");
			requireObject(rejectedResult.error, "rejectedResult.error");
			requireString(rejectedResult.error.code, "rejectedResult.error.code");
			canonicalJson(rejectedResult);
			const identity = commandIdentity(command);
			return executeWrite(database, () => {
				const replay = replayOrThrow(findExistingReceipt(database, identity), identity);
				if (replay) return replay;
				insertReceipt(database, command, identity, "rejected", rejectedResult.recordedAt, rejectedResult, rejectedResult.error);
				return Object.freeze({ ...rejectedResult });
			});
		},
		registerProject(command, trusted) {
			ensureOpen();
			validateCommand(command);
			if (!SUPPORTED_REGISTER_KINDS.has(command.kind)) throw new StorageValidationError("registerProject only accepts registerLegacy/registerManaged.");
			requireObject(trusted, "trusted");
			const mode = command.kind === "project.registerLegacy" ? "linked_legacy" : "managed";
			const expectedLocationRef = command.payload.locationRef;
			validateLocation(trusted.location, expectedLocationRef);
			const locationPathKey = projectPathKey(trusted.location.normalizedPath);
			let candidateBinding = null;
			if (trusted.candidateId !== void 0 || trusted.candidateRevision !== void 0) {
				const candidateId = requireString(trusted.candidateId, "trusted.candidateId");
				if (!BUSINESS_IDS.can.test(candidateId)) throw new StorageValidationError("trusted.candidateId must be a can_ UUIDv7.");
				candidateBinding = {
					candidateId,
					candidateRevision: requireInteger(trusted.candidateRevision, "trusted.candidateRevision", 1)
				};
			}
			const eventId = trusted.eventId ?? idFactory("evt");
			const outboxId = trusted.outboxId ?? idFactory("out");
			if (!EVENT_ID$1.test(requireString(eventId, "trusted.eventId"))) throw new StorageValidationError("trusted.eventId must be an evt_ UUIDv7.");
			requireString(outboxId, "trusted.outboxId");
			const name = command.kind === "project.registerLegacy" ? requireString(command.payload.name, "command.payload.name") : requireString(trusted.manifestName, "trusted.manifestName");
			const origin = command.kind === "project.registerLegacy" ? { kind: "imported" } : trusted.origin ?? { kind: "imported" };
			requireObject(origin, "trusted.origin");
			requireString(origin.kind, "trusted.origin.kind");
			const documentBindings = command.kind === "project.registerLegacy" ? validateDocumentBindings(command.payload.documentBindings, {
				source: "user_confirmed",
				requireContentHash: true
			}) : validateDocumentBindings(trusted.manifestDocumentBindings, {
				source: "manifest",
				requireContentHash: false
			});
			if (command.kind === "project.registerManaged") {
				if (!CONTENT_HASH$1.test(requireString(trusted.manifestHash, "trusted.manifestHash")) || trusted.manifestHash !== command.payload.manifestHash) throw new StorageValidationError("Trusted manifest hash does not match the validated registerManaged command.");
			}
			const identity = commandIdentity(command);
			return executeWrite(database, () => {
				const replay = replayOrThrow(findExistingReceipt(database, identity), identity);
				if (replay) return replay;
				const current = database.prepare("SELECT revision FROM projects WHERE project_id = ?").get(command.target.projectId);
				if (current || command.expectedRevision !== 0) return rejectAndRecord(command, identity, "REVISION_CONFLICT", "Project creation expected revision 0, but the project already exists or the expectation is invalid.", Number(current?.revision ?? 0));
				if (candidateBinding) {
					const candidate = database.prepare(`
            SELECT
              root_path_key AS rootPathKey, status,
              matched_project_id AS matchedProjectId, revision
            FROM import_candidates
            WHERE candidate_id = ?
          `).get(candidateBinding.candidateId);
					if (!candidate || Number(candidate.revision) !== candidateBinding.candidateRevision || !CANDIDATE_STATES.has(candidate.status) || candidate.matchedProjectId !== null) return rejectAndRecord(command, identity, "REVISION_CONFLICT", "The import candidate changed before project registration.", 0);
					if (candidate.rootPathKey !== locationPathKey) return rejectAndRecord(command, identity, "REFERENCE_UNRESOLVED", "The import candidate no longer matches the resolved workspace location.", 0);
				}
				if (database.prepare(`
          SELECT location_id AS locationId
          FROM workspace_locations
          WHERE location_id = ?
            OR (path_key = ? AND is_active = 1)
          LIMIT 1
        `).get(trusted.location.locationId, locationPathKey)) return rejectAndRecord(command, identity, "LOCATION_CONFLICT", "The confirmed workspace location is already registered.", 0);
				const recordedAt = now();
				const verifiedAt = trusted.location.verifiedAt ?? recordedAt;
				database.prepare(`
          INSERT INTO projects(
            project_id, mode, name, origin_kind, template_id, template_version,
            forked_from_project_id, lifecycle, health, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'unknown', 1, ?, ?)
        `).run(command.target.projectId, mode, name, origin.kind, origin.templateId ?? null, origin.templateVersion ?? null, origin.forkedFromProjectId ?? null, recordedAt, recordedAt);
				if (candidateBinding) {
					if (!database.prepare(`
            UPDATE import_candidates
            SET status = 'imported', status_before_ignored = NULL,
              matched_project_id = ?, revision = revision + 1, updated_at = ?
            WHERE candidate_id = ? AND revision = ?
              AND status IN ('discovered', 'conflict', 'relocation_candidate')
              AND matched_project_id IS NULL
            RETURNING revision
          `).get(command.target.projectId, recordedAt, candidateBinding.candidateId, candidateBinding.candidateRevision)) throw new StorageValidationError("Import candidate update unexpectedly affected no rows.");
				}
				insertDocumentBindings(database, command.target.projectId, documentBindings, recordedAt);
				if (command.kind === "project.registerManaged") database.prepare(`
            INSERT INTO project_manifest_mirrors(
              project_id, protocol_version, manifest_hash, name, origin_json,
              document_bindings_json, verified_at, revision
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
          `).run(command.target.projectId, PROTOCOL_VERSION$1, trusted.manifestHash, name, canonicalJson(origin), canonicalJson(documentBindings), verifiedAt);
				database.prepare(`
          INSERT INTO workspace_locations(
            location_id, project_id, kind, display_path, normalized_path, path_key,
            is_active, verified_at, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
        `).run(trusted.location.locationId, command.target.projectId, trusted.location.kind ?? "primary", trusted.location.displayPath, trusted.location.normalizedPath, locationPathKey, verifiedAt, recordedAt, recordedAt);
				const sequence = nextSequence(database);
				const fileSync = command.kind === "project.registerLegacy" ? { status: "not_required" } : {
					status: "verified_existing",
					manifestHash: command.payload.manifestHash
				};
				const data = command.kind === "project.registerLegacy" ? {
					projectMode: mode,
					name,
					locationRef: command.payload.locationRef,
					sourceRootRef: command.payload.sourceRootRef,
					documentBindings: command.payload.documentBindings,
					fileSync
				} : {
					projectMode: mode,
					locationRef: command.payload.locationRef,
					sourceRootRef: command.payload.sourceRootRef,
					manifestHash: command.payload.manifestHash,
					fileSync
				};
				const event = buildNormalizedEvent({
					command,
					eventId,
					eventType: eventTypeForRegister(command.kind),
					sequence,
					beforeRevision: 0,
					afterRevision: 1,
					recordedAt,
					data
				});
				const result = {
					protocolVersion: PROTOCOL_VERSION$1,
					schemaVersion: RESULT_SCHEMA_VERSION,
					commandId: command.commandId,
					correlationId: command.correlationId,
					kind: command.kind,
					status: "accepted",
					recordedAt,
					projectId: command.target.projectId,
					projectMode: mode,
					aggregateRevision: 1,
					eventId,
					outcome: outcomeForRegister(command.kind),
					fileSync
				};
				insertReceipt(database, command, identity, "accepted", recordedAt, result, null);
				insertEvent(database, event, command);
				insertOutbox(database, outboxId, event, recordedAt);
				return Object.freeze(result);
			});
		},
		rebindProject(command, trusted) {
			ensureOpen();
			validateCommand(command, "project.rebindLocation");
			requireObject(trusted, "trusted");
			validateLocation(trusted.newLocation, command.payload.newLocationRef);
			const newLocationPathKey = projectPathKey(trusted.newLocation.normalizedPath);
			let candidateBinding = null;
			if (trusted.candidateId !== void 0 || trusted.candidateRevision !== void 0) {
				const candidateId = requireString(trusted.candidateId, "trusted.candidateId");
				if (!BUSINESS_IDS.can.test(candidateId)) throw new StorageValidationError("trusted.candidateId must be a can_ UUIDv7.");
				candidateBinding = {
					candidateId,
					candidateRevision: requireInteger(trusted.candidateRevision, "trusted.candidateRevision", 1)
				};
			}
			const eventId = trusted.eventId ?? idFactory("evt");
			const outboxId = trusted.outboxId ?? idFactory("out");
			const historyId = trusted.historyId ?? idFactory("pth");
			if (!EVENT_ID$1.test(requireString(eventId, "trusted.eventId"))) throw new StorageValidationError("trusted.eventId must be an evt_ UUIDv7.");
			requireString(outboxId, "trusted.outboxId");
			requireString(historyId, "trusted.historyId");
			const identity = commandIdentity(command);
			return executeWrite(database, () => {
				const replay = replayOrThrow(findExistingReceipt(database, identity), identity);
				if (replay) return replay;
				const project = database.prepare(`
          SELECT mode, revision FROM projects WHERE project_id = ?
        `).get(command.target.projectId);
				if (!project) return rejectAndRecord(command, identity, "REFERENCE_UNRESOLVED", "The project does not exist.", 0);
				if (Number(project.revision) !== command.expectedRevision) return rejectAndRecord(command, identity, "REVISION_CONFLICT", "The project revision changed before the location could be rebound.", Number(project.revision));
				if (project.mode !== command.payload.expectedMode) return rejectAndRecord(command, identity, "MODE_CONFLICT", "The project mode no longer matches the confirmed rebind command.", Number(project.revision));
				if (candidateBinding) {
					const candidate = database.prepare(`
            SELECT
              root_path_key AS rootPathKey, status,
              matched_project_id AS matchedProjectId, revision
            FROM import_candidates
            WHERE candidate_id = ?
          `).get(candidateBinding.candidateId);
					if (!candidate || Number(candidate.revision) !== candidateBinding.candidateRevision || candidate.status !== "relocation_candidate" || candidate.matchedProjectId !== null) return rejectAndRecord(command, identity, "REVISION_CONFLICT", "The relocation candidate changed before project rebind.", Number(project.revision));
					if (candidate.rootPathKey !== newLocationPathKey) return rejectAndRecord(command, identity, "REFERENCE_UNRESOLVED", "The relocation candidate no longer matches the resolved workspace location.", Number(project.revision));
				}
				const currentLocation = database.prepare(`
          SELECT
            location_id AS locationId, display_path AS displayPath,
            normalized_path AS normalizedPath, revision
          FROM workspace_locations
          WHERE project_id = ? AND location_id = ? AND is_active = 1
        `).get(command.target.projectId, command.payload.currentLocationRef);
				if (!currentLocation) return rejectAndRecord(command, identity, "REFERENCE_UNRESOLVED", "The active workspace location no longer matches the command.", Number(project.revision));
				if (Number(currentLocation.revision) !== command.payload.currentLocationRevision) return rejectAndRecord(command, identity, "REVISION_CONFLICT", "The workspace location revision changed before rebind.", Number(project.revision));
				if (database.prepare(`
          SELECT location_id AS locationId
          FROM workspace_locations
          WHERE location_id = ?
            OR (path_key = ? AND is_active = 1 AND location_id <> ?)
            OR (project_id = ? AND kind = ? AND is_active = 1 AND location_id <> ?)
          LIMIT 1
        `).get(trusted.newLocation.locationId, newLocationPathKey, currentLocation.locationId, command.target.projectId, trusted.newLocation.kind ?? "primary", currentLocation.locationId)) return rejectAndRecord(command, identity, "LOCATION_CONFLICT", "The new workspace location is already active for another registration.", Number(project.revision));
				const recordedAt = now();
				const verifiedAt = trusted.newLocation.verifiedAt ?? recordedAt;
				database.prepare(`
          UPDATE workspace_locations
          SET is_active = 0, revision = revision + 1, updated_at = ?
          WHERE location_id = ? AND project_id = ? AND revision = ? AND is_active = 1
        `).run(recordedAt, currentLocation.locationId, command.target.projectId, command.payload.currentLocationRevision);
				database.prepare(`
          INSERT INTO workspace_locations(
            location_id, project_id, kind, display_path, normalized_path, path_key,
            is_active, verified_at, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
        `).run(trusted.newLocation.locationId, command.target.projectId, trusted.newLocation.kind ?? "primary", trusted.newLocation.displayPath, trusted.newLocation.normalizedPath, newLocationPathKey, verifiedAt, recordedAt, recordedAt);
				database.prepare(`
          INSERT INTO project_path_history(
            history_id, project_id, old_path, new_path, reason, changed_by, changed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(historyId, command.target.projectId, currentLocation.displayPath, trusted.newLocation.displayPath, command.payload.reason, canonicalJson(command.actor), recordedAt);
				const updated = database.prepare(`
          UPDATE projects
          SET revision = revision + 1, updated_at = ?
          WHERE project_id = ? AND revision = ?
          RETURNING revision
        `).get(recordedAt, command.target.projectId, command.expectedRevision);
				if (!updated) throw new StorageValidationError("Project revision update unexpectedly affected no rows.");
				if (candidateBinding) {
					if (!database.prepare(`
            UPDATE import_candidates
            SET status = 'imported', status_before_ignored = NULL,
              matched_project_id = ?, revision = revision + 1, updated_at = ?
            WHERE candidate_id = ? AND revision = ?
              AND status = 'relocation_candidate'
              AND matched_project_id IS NULL
            RETURNING revision
          `).get(command.target.projectId, recordedAt, candidateBinding.candidateId, candidateBinding.candidateRevision)) throw new StorageValidationError("Relocation candidate update unexpectedly affected no rows.");
				}
				const afterRevision = Number(updated.revision);
				const sequence = nextSequence(database);
				const fileSync = { status: "not_required" };
				const data = {
					projectMode: project.mode,
					previousLocationRef: command.payload.currentLocationRef,
					newLocationRef: command.payload.newLocationRef,
					sourceRootRef: command.payload.sourceRootRef,
					reason: command.payload.reason,
					identityEvidence: command.payload.identityEvidence,
					fileSync
				};
				const event = buildNormalizedEvent({
					command,
					eventId,
					eventType: "project.location.rebound",
					sequence,
					beforeRevision: command.expectedRevision,
					afterRevision,
					recordedAt,
					data
				});
				const result = {
					protocolVersion: PROTOCOL_VERSION$1,
					schemaVersion: RESULT_SCHEMA_VERSION,
					commandId: command.commandId,
					correlationId: command.correlationId,
					kind: command.kind,
					status: "accepted",
					recordedAt,
					projectId: command.target.projectId,
					projectMode: project.mode,
					aggregateRevision: afterRevision,
					eventId,
					outcome: "location_rebound",
					fileSync
				};
				insertReceipt(database, command, identity, "accepted", recordedAt, result, null);
				insertEvent(database, event, command);
				insertOutbox(database, outboxId, event, recordedAt);
				return Object.freeze(result);
			});
		},
		resolveUpgradePlanRefs(planId, refs, referenceContext) {
			ensureOpen();
			if (!BUSINESS_IDS.pln.test(requireString(planId, "planId"))) throw referenceResolutionError("plan_shape_invalid");
			requireObject(refs, "refs");
			if (!BUSINESS_IDS.loc.test(requireString(refs.locationRef, "refs.locationRef"))) throw referenceResolutionError("reference_shape_invalid");
			const context = validateReferenceContext(referenceContext);
			const observedAt = requireTimestamp(now(), "now()");
			const plan = selectFileSyncPlan(database, planId);
			if (plan === null) throw referenceResolutionError("plan_not_found");
			if (plan.kind !== "upgrade_managed") throw referenceResolutionError("plan_kind_mismatch");
			const sourceRootRow = database.prepare(`
        SELECT
          plan_ref AS planRef, ref_kind AS refKind, plan_id AS planId,
          application_instance_id AS applicationInstanceId, scope,
          display_path AS displayPath, normalized_path AS normalizedPath,
          issued_at AS issuedAt, expires_at AS expiresAt, revoked_at AS revokedAt
        FROM file_sync_plan_refs
        WHERE plan_id = ? AND ref_kind = 'source_root'
        ORDER BY issued_at DESC, plan_ref DESC
        LIMIT 1
      `).get(planId);
			if (!sourceRootRow) throw referenceResolutionError("reference_not_found");
			if (sourceRootRow.applicationInstanceId !== context.applicationInstanceId) throw referenceResolutionError("application_instance_mismatch");
			if (sourceRootRow.scope !== context.scope) throw referenceResolutionError("scope_mismatch");
			if (sourceRootRow.revokedAt !== null) throw referenceResolutionError("reference_revoked");
			if (Date.parse(observedAt) >= Date.parse(sourceRootRow.expiresAt)) throw referenceResolutionError("reference_expired");
			if (sourceRootRow.planId !== planId || sourceRootRow.refKind !== "source_root") throw referenceResolutionError("reference_plan_mismatch");
			const locationRow = database.prepare(`
        SELECT
          location_id AS locationId, project_id AS projectId,
          display_path AS displayPath, normalized_path AS normalizedPath,
          is_active AS isActive, verified_at AS verifiedAt, revision
        FROM workspace_locations
        WHERE location_id = ?
      `).get(refs.locationRef);
			if (!locationRow || Number(locationRow.isActive) !== 1) throw referenceResolutionError("reference_not_found");
			if (locationRow.projectId !== plan.projectId) throw referenceResolutionError("reference_plan_mismatch");
			if (!sameFilesystemPath(locationRow.normalizedPath, plan.targetNormalizedPath)) throw referenceResolutionError("plan_target_mismatch");
			if (!pathIsWithin$1(sourceRootRow.normalizedPath, locationRow.normalizedPath) || sameFilesystemPath(sourceRootRow.normalizedPath, locationRow.normalizedPath)) throw referenceResolutionError("location_outside_source_root");
			return Object.freeze({
				planId,
				location: {
					locationId: locationRow.locationId,
					kind: "primary",
					displayPath: locationRow.displayPath,
					normalizedPath: locationRow.normalizedPath,
					verifiedAt: locationRow.verifiedAt,
					revision: Number(locationRow.revision)
				},
				sourceRoot: {
					sourceRootId: sourceRootRow.planRef,
					displayPath: sourceRootRow.displayPath,
					normalizedPath: sourceRootRow.normalizedPath,
					expiresAt: sourceRootRow.expiresAt
				}
			});
		},
		registerUpgradeManaged(command, trusted) {
			ensureOpen();
			validateCommand(command, "project.upgradeManaged");
			requireObject(trusted, "trusted");
			const planId = requireString(trusted.planId, "trusted.planId");
			if (!BUSINESS_IDS.pln.test(planId)) throw new StorageValidationError("trusted.planId must be a pln_ UUIDv7.");
			validateLocation(trusted.location, command.payload.locationRef);
			const eventId = trusted.eventId ?? idFactory("evt");
			const outboxId = trusted.outboxId ?? idFactory("out");
			if (!EVENT_ID$1.test(requireString(eventId, "trusted.eventId"))) throw new StorageValidationError("trusted.eventId must be an evt_ UUIDv7.");
			requireString(outboxId, "trusted.outboxId");
			const manifestName = requireString(trusted.manifestName, "trusted.manifestName");
			if (!CONTENT_HASH$1.test(requireString(trusted.manifestHash, "trusted.manifestHash"))) throw new StorageValidationError("trusted.manifestHash must use the sha256: line format.");
			const identity = commandIdentity(command);
			return executeWrite(database, () => {
				const replay = replayOrThrow(findExistingReceipt(database, identity), identity);
				if (replay) return replay;
				const project = database.prepare(`
          SELECT mode, name, revision FROM projects WHERE project_id = ?
        `).get(command.target.projectId);
				if (!project) return rejectAndRecord(command, identity, "REFERENCE_UNRESOLVED", "The project does not exist.", 0);
				if (project.mode !== "linked_legacy") return rejectAndRecord(command, identity, "MODE_CONFLICT", "Only a linked legacy project can be upgraded.", Number(project.revision));
				if (Number(project.revision) !== command.expectedRevision) return rejectAndRecord(command, identity, "REVISION_CONFLICT", "The project revision changed before the upgrade.", Number(project.revision));
				const location = database.prepare(`
          SELECT location_id AS locationId, revision, normalized_path AS normalizedPath
          FROM workspace_locations
          WHERE project_id = ? AND location_id = ? AND is_active = 1
        `).get(command.target.projectId, command.payload.locationRef);
				if (!location) return rejectAndRecord(command, identity, "REFERENCE_UNRESOLVED", "The active workspace location no longer matches the command.", Number(project.revision));
				if (Number(location.revision) !== command.payload.locationRevision) return rejectAndRecord(command, identity, "REVISION_CONFLICT", "The workspace location revision changed before the upgrade.", Number(project.revision));
				if (!sameFilesystemPath(location.normalizedPath, trusted.location.normalizedPath)) return rejectAndRecord(command, identity, "REFERENCE_UNRESOLVED", "The resolved location no longer matches the active workspace.", Number(project.revision));
				const plan = selectFileSyncPlan(database, planId);
				if (plan === null) return rejectAndRecord(command, identity, "REFERENCE_UNRESOLVED", "The write plan no longer exists.", Number(project.revision));
				if (plan.commandId !== command.commandId || plan.projectId !== command.target.projectId || plan.kind !== "upgrade_managed") return rejectAndRecord(command, identity, "REFERENCE_UNRESOLVED", "The write plan does not belong to this command.", Number(project.revision));
				if (plan.state !== "files_committed") return rejectAndRecord(command, identity, "FILE_SYNC_FAILED", "The project manifest was not committed before acceptance.", Number(project.revision));
				if (plan.planHash !== command.payload.writePlan.planHash || plan.manifestHash !== command.payload.writePlan.manifestHash || plan.manifestHash !== trusted.manifestHash) return rejectAndRecord(command, identity, "WRITE_PLAN_STALE", "The write plan hashes no longer match the committed plan.", Number(project.revision));
				if (computeLegacyFingerprint(database, command.target.projectId) !== command.payload.legacyFingerprintHash) return rejectAndRecord(command, identity, "WRITE_PLAN_STALE", "The legacy document fingerprint no longer matches the command.", Number(project.revision));
				if (manifestName !== project.name) return rejectAndRecord(command, identity, "WRITE_PLAN_STALE", "The manifest name no longer matches the project.", Number(project.revision));
				const recordedAt = now();
				const afterRevision = Number(project.revision) + 1;
				const name = project.name;
				database.prepare(`
          UPDATE projects
          SET mode = 'managed', origin_kind = 'imported',
            template_id = NULL, template_version = NULL,
            revision = revision + 1, updated_at = ?
          WHERE project_id = ? AND revision = ?
        `).run(recordedAt, command.target.projectId, command.expectedRevision);
				const documentBindings = database.prepare(`
          SELECT role, relative_path AS relativePath, content_hash AS contentHash,
            is_required AS required
          FROM project_document_bindings
          WHERE project_id = ?
          ORDER BY role, relative_path
        `).all(command.target.projectId).map((row) => ({
					role: row.role,
					relativePath: row.relativePath,
					contentHash: row.contentHash,
					required: Number(row.required) === 1,
					source: "manifest"
				}));
				database.prepare(`
          INSERT INTO project_manifest_mirrors(
            project_id, protocol_version, manifest_hash, name, origin_json,
            document_bindings_json, verified_at, revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(command.target.projectId, PROTOCOL_VERSION$1, trusted.manifestHash, name, canonicalJson({ kind: "imported" }), canonicalJson(documentBindings), recordedAt);
				const planAccepted = database.prepare(`
          UPDATE file_sync_plans
          SET state = 'accepted', updated_at = ?, completed_at = ?
          WHERE plan_id = ? AND state = 'files_committed'
        `).run(recordedAt, recordedAt, planId);
				if (Number(planAccepted.changes) !== 1) throw new StorageValidationError("The file sync plan changed before acceptance.");
				const sequence = nextSequence(database);
				const fileSync = {
					status: "committed",
					planId,
					planHash: plan.planHash,
					manifestHash: plan.manifestHash
				};
				const data = {
					previousMode: "linked_legacy",
					projectMode: "managed",
					locationRef: command.payload.locationRef,
					manifestHash: trusted.manifestHash,
					fileSync
				};
				const event = buildNormalizedEvent({
					command,
					eventId,
					eventType: "project.managed.upgraded",
					sequence,
					beforeRevision: Number(project.revision),
					afterRevision,
					recordedAt,
					data
				});
				const result = {
					protocolVersion: PROTOCOL_VERSION$1,
					schemaVersion: RESULT_SCHEMA_VERSION,
					commandId: command.commandId,
					correlationId: command.correlationId,
					kind: command.kind,
					status: "accepted",
					recordedAt,
					projectId: command.target.projectId,
					projectMode: "managed",
					aggregateRevision: afterRevision,
					eventId,
					outcome: "managed_upgraded",
					fileSync
				};
				insertReceipt(database, command, identity, "accepted", recordedAt, result, null);
				insertEvent(database, event, command);
				insertOutbox(database, outboxId, event, recordedAt);
				return Object.freeze(result);
			});
		},
		registerCreatedProject(command, trusted) {
			ensureOpen();
			validateCommand(command, "project.createFromTemplate");
			requireObject(trusted, "trusted");
			const planId = requireString(trusted.planId, "trusted.planId");
			if (!BUSINESS_IDS.pln.test(planId)) throw new StorageValidationError("trusted.planId must be a pln_ UUIDv7.");
			validateLocation(trusted.location, command.payload.targetLocationRef);
			const locationPathKey = projectPathKey(trusted.location.normalizedPath);
			const eventId = trusted.eventId ?? idFactory("evt");
			const outboxId = trusted.outboxId ?? idFactory("out");
			if (!EVENT_ID$1.test(requireString(eventId, "trusted.eventId"))) throw new StorageValidationError("trusted.eventId must be an evt_ UUIDv7.");
			requireString(outboxId, "trusted.outboxId");
			const name = requireString(trusted.manifestName, "trusted.manifestName");
			const origin = trusted.origin ?? {
				kind: "template",
				templateId: command.payload.template.templateId,
				templateVersion: command.payload.template.templateVersion
			};
			requireObject(origin, "trusted.origin");
			if (origin.kind !== "template" || !TEMPLATE_ID_PATTERN.test(requireString(origin.templateId, "trusted.origin.templateId")) || !TEMPLATE_VERSION_PATTERN.test(requireString(origin.templateVersion, "trusted.origin.templateVersion"))) throw new StorageValidationError("A created project requires a template origin with id and version.");
			const documentBindings = validateDocumentBindings(trusted.manifestDocumentBindings, {
				source: "manifest",
				requireContentHash: false
			});
			if (!CONTENT_HASH$1.test(requireString(trusted.manifestHash, "trusted.manifestHash"))) throw new StorageValidationError("trusted.manifestHash must use the sha256: line format.");
			const identity = commandIdentity(command);
			return executeWrite(database, () => {
				const replay = replayOrThrow(findExistingReceipt(database, identity), identity);
				if (replay) return replay;
				const current = database.prepare("SELECT revision FROM projects WHERE project_id = ?").get(command.target.projectId);
				if (current || command.expectedRevision !== 0) return rejectAndRecord(command, identity, "REVISION_CONFLICT", "Project creation expected revision 0, but the project already exists or the expectation is invalid.", Number(current?.revision ?? 0));
				const plan = selectFileSyncPlan(database, planId);
				if (plan === null) return rejectAndRecord(command, identity, "REFERENCE_UNRESOLVED", "The write plan no longer exists.", 0);
				if (plan.commandId !== command.commandId || plan.projectId !== command.target.projectId) return rejectAndRecord(command, identity, "REFERENCE_UNRESOLVED", "The write plan does not belong to this command.", 0);
				if (plan.state !== "files_committed") return rejectAndRecord(command, identity, "FILE_SYNC_FAILED", "The project files were not committed before acceptance.", 0);
				if (plan.planHash !== command.payload.writePlan.planHash || plan.manifestHash !== command.payload.writePlan.manifestHash || plan.manifestHash !== trusted.manifestHash) return rejectAndRecord(command, identity, "WRITE_PLAN_STALE", "The write plan hashes no longer match the committed plan.", 0);
				if (database.prepare(`
          SELECT location_id AS locationId
          FROM workspace_locations
          WHERE location_id = ?
            OR (path_key = ? AND is_active = 1)
          LIMIT 1
        `).get(trusted.location.locationId, locationPathKey)) return rejectAndRecord(command, identity, "LOCATION_CONFLICT", "The created workspace location is already registered.", 0);
				const recordedAt = now();
				const verifiedAt = trusted.location.verifiedAt ?? recordedAt;
				database.prepare(`
          INSERT INTO projects(
            project_id, mode, name, origin_kind, template_id, template_version,
            forked_from_project_id, lifecycle, health, revision, created_at, updated_at
          ) VALUES (?, 'managed', ?, 'template', ?, ?, NULL, 'active', 'unknown', 1, ?, ?)
        `).run(command.target.projectId, name, origin.templateId, origin.templateVersion, recordedAt, recordedAt);
				insertDocumentBindings(database, command.target.projectId, documentBindings, recordedAt);
				database.prepare(`
          INSERT INTO project_manifest_mirrors(
            project_id, protocol_version, manifest_hash, name, origin_json,
            document_bindings_json, verified_at, revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(command.target.projectId, PROTOCOL_VERSION$1, trusted.manifestHash, name, canonicalJson(origin), canonicalJson(documentBindings), verifiedAt);
				database.prepare(`
          INSERT INTO workspace_locations(
            location_id, project_id, kind, display_path, normalized_path, path_key,
            is_active, verified_at, revision, created_at, updated_at
          ) VALUES (?, ?, 'primary', ?, ?, ?, 1, ?, 1, ?, ?)
        `).run(trusted.location.locationId, command.target.projectId, trusted.location.displayPath, trusted.location.normalizedPath, locationPathKey, verifiedAt, recordedAt, recordedAt);
				const sequence = nextSequence(database);
				const fileSync = {
					status: "committed",
					planId,
					planHash: plan.planHash,
					manifestHash: plan.manifestHash
				};
				const event = buildNormalizedEvent({
					command,
					eventId,
					eventType: "project.managed.created",
					sequence,
					beforeRevision: 0,
					afterRevision: 1,
					recordedAt,
					data: {
						projectMode: "managed",
						name,
						templateId: origin.templateId,
						templateVersion: origin.templateVersion,
						locationRef: command.payload.targetLocationRef,
						sourceRootRef: command.payload.sourceRootRef,
						manifestHash: trusted.manifestHash,
						fileSync
					}
				});
				const result = {
					protocolVersion: PROTOCOL_VERSION$1,
					schemaVersion: RESULT_SCHEMA_VERSION,
					commandId: command.commandId,
					correlationId: command.correlationId,
					kind: command.kind,
					status: "accepted",
					recordedAt,
					projectId: command.target.projectId,
					projectMode: "managed",
					aggregateRevision: 1,
					eventId,
					outcome: "managed_created",
					fileSync
				};
				const planAccepted = database.prepare(`
          UPDATE file_sync_plans
          SET state = 'accepted', updated_at = ?, completed_at = ?
          WHERE plan_id = ? AND state = 'files_committed'
        `).run(recordedAt, recordedAt, planId);
				if (Number(planAccepted.changes) !== 1) throw new StorageValidationError("The file sync plan changed before acceptance.");
				insertReceipt(database, command, identity, "accepted", recordedAt, result, null);
				insertEvent(database, event, command);
				insertOutbox(database, outboxId, event, recordedAt);
				return Object.freeze(result);
			});
		},
		createFileSyncPlan(input) {
			ensureOpen();
			const plan = validateFileSyncPlanInput(input);
			const recordedAt = requireTimestamp(now(), "now()");
			return executeWrite(database, () => {
				if (database.prepare(`
          SELECT 1 AS present FROM file_sync_plans WHERE plan_id = ?
        `).get(plan.planId)) throw new StorageValidationError("A file sync plan with this planId already exists.", {
					reason: "plan_id_conflict",
					planId: plan.planId
				});
				database.prepare(`
          INSERT INTO file_sync_plans(
            plan_id, command_id, kind, project_id, sync_policy,
            target_display_path, target_normalized_path, staging_display_path,
            plan_hash, manifest_hash, state, operations_json,
            render_params_json, root_preexisted_empty, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?)
        `).run(plan.planId, plan.commandId, plan.kind, plan.projectId, plan.syncPolicy, plan.targetDisplayPath, plan.targetNormalizedPath, plan.stagingDisplayPath, plan.planHash, plan.manifestHash, JSON.stringify(plan.operations), plan.renderParams === null ? null : JSON.stringify(plan.renderParams), plan.rootPreexistedEmpty ? 1 : 0, recordedAt, recordedAt);
				return selectFileSyncPlan(database, plan.planId);
			});
		},
		getFileSyncPlan(planId) {
			ensureOpen();
			if (!BUSINESS_IDS.pln.test(requireString(planId, "planId"))) throw new StorageValidationError("planId must be a pln_ UUIDv7.");
			return selectFileSyncPlan(database, planId);
		},
		listFileSyncPlansForRecovery() {
			ensureOpen();
			return database.prepare(`
        SELECT
          plan_id, command_id, kind, project_id, sync_policy,
          target_display_path, target_normalized_path, staging_display_path,
          plan_hash, manifest_hash, state, operations_json, created_paths_json,
          render_params_json, root_preexisted_empty, error_code,
          created_at, updated_at, completed_at
        FROM file_sync_plans
        WHERE state IN ('staging', 'staged', 'files_committed')
        ORDER BY created_at, plan_id
      `).all().map(rowToFileSyncPlan);
		},
		setFileSyncPlanState(planId, expectedState, updates) {
			ensureOpen();
			if (!BUSINESS_IDS.pln.test(requireString(planId, "planId"))) throw new StorageValidationError("planId must be a pln_ UUIDv7.");
			if (!FILE_SYNC_STATES.has(expectedState)) throw new StorageValidationError("The expected file sync plan state is unsupported.");
			requireObject(updates, "updates");
			const nextState = requireString(updates.state, "updates.state");
			if (!FILE_SYNC_TRANSITIONS[expectedState]?.has(nextState)) throw new StorageValidationError("The file sync plan cannot move between these states.", {
				reason: "transition_invalid",
				planId,
				expectedState,
				nextState
			});
			if (updates.createdPaths !== void 0 && (!Array.isArray(updates.createdPaths) || updates.createdPaths.length > 500)) throw new StorageValidationError("updates.createdPaths must be an array of at most 500 relative paths.");
			const createdPaths = [...new Set((updates.createdPaths ?? []).map((raw, index) => {
				const relativePath = requireString(raw, `updates.createdPaths[${index}]`);
				if (!RELATIVE_PATH$1.test(relativePath)) throw new StorageValidationError(`updates.createdPaths[${index}] is invalid.`);
				return relativePath;
			}))];
			const errorCode = updates.errorCode === void 0 ? null : requireString(updates.errorCode, "updates.errorCode").slice(0, 100);
			return executeWrite(database, () => {
				const current = selectFileSyncPlan(database, planId);
				if (current === null) throw new StorageValidationError("The file sync plan does not exist.", {
					reason: "plan_not_found",
					planId
				});
				if (current.state !== expectedState) throw new StorageValidationError("The file sync plan state changed.", {
					reason: "state_conflict",
					planId,
					expectedState,
					actualState: current.state
				});
				const recordedAt = requireTimestamp(now(), "now()");
				const terminal = FILE_SYNC_TERMINAL_STATES.has(nextState);
				database.prepare(`
          UPDATE file_sync_plans
          SET state = ?, created_paths_json = ?, error_code = ?, updated_at = ?,
              completed_at = ?
          WHERE plan_id = ? AND state = ?
        `).run(nextState, JSON.stringify(createdPaths), errorCode, recordedAt, terminal ? recordedAt : null, planId, expectedState);
				return selectFileSyncPlan(database, planId);
			});
		},
		issueFileSyncPlanRefs(planId, options) {
			ensureOpen();
			if (!BUSINESS_IDS.pln.test(requireString(planId, "planId"))) throw new StorageValidationError("planId must be a pln_ UUIDv7.");
			requireObject(options, "options");
			const context = validateReferenceContext(options);
			const ttlSeconds = options.ttlSeconds ?? 300;
			requireInteger(ttlSeconds, "options.ttlSeconds", 1);
			if (ttlSeconds > 3600) throw new StorageValidationError("Reference ttlSeconds cannot exceed 3600.");
			const targetDisplayPath = validateWorkspacePath(options.targetDisplayPath, "options.targetDisplayPath");
			const targetNormalizedPath = validateWorkspacePath(options.targetNormalizedPath ?? targetDisplayPath, "options.targetNormalizedPath");
			const locationDisplayPath = validateWorkspacePath(options.locationDisplayPath ?? targetDisplayPath, "options.locationDisplayPath");
			const defaultLocationNormalizedPath = sameFilesystemPath(locationDisplayPath, targetDisplayPath) ? targetNormalizedPath : sameFilesystemPath(locationDisplayPath, win32.join(targetDisplayPath, "workspace")) ? win32.join(targetNormalizedPath, "workspace") : locationDisplayPath;
			const locationNormalizedPath = validateWorkspacePath(options.locationNormalizedPath ?? defaultLocationNormalizedPath, "options.locationNormalizedPath");
			const parentDisplayPath = validateWorkspacePath(options.parentDisplayPath, "options.parentDisplayPath");
			const parentNormalizedPath = validateWorkspacePath(options.parentNormalizedPath ?? parentDisplayPath, "options.parentNormalizedPath");
			if (!pathIsWithin$1(parentNormalizedPath, targetNormalizedPath) || sameFilesystemPath(parentNormalizedPath, targetNormalizedPath)) throw new StorageValidationError("The create target must be a strict child of the parent directory.", { reason: "target_outside_parent" });
			const projectHomeWorkspacePath = win32.join(targetNormalizedPath, "workspace");
			if (!sameFilesystemPath(locationNormalizedPath, targetNormalizedPath) && !sameFilesystemPath(locationNormalizedPath, projectHomeWorkspacePath)) throw new StorageValidationError("The primary location must be the plan target or its fixed workspace child.", { reason: "location_outside_target" });
			const issuedAt = requireTimestamp(now(), "now()");
			const expiresAt = new Date(Date.parse(issuedAt) + ttlSeconds * 1e3).toISOString();
			return executeWrite(database, () => {
				const plan = selectFileSyncPlan(database, planId);
				if (plan === null) throw new StorageValidationError("The file sync plan does not exist.", {
					reason: "plan_not_found",
					planId
				});
				if (plan.kind !== "create_from_template" && plan.kind !== "upgrade_managed") throw new StorageValidationError("Only create/upgrade plans can receive plan refs.", { reason: "plan_kind_mismatch" });
				if (plan.state !== "planned" && plan.state !== "rolled_back") throw new StorageValidationError("The plan is not in an issuable state.", {
					reason: "plan_not_issuable",
					state: plan.state
				});
				if (!sameFilesystemPath(plan.targetNormalizedPath, targetNormalizedPath)) throw new StorageValidationError("The ref target no longer matches the plan.", { reason: "plan_target_mismatch" });
				const locationRef = plan.kind === "create_from_template" ? createBusinessId(idFactory, "loc", "locationRef") : null;
				const sourceRootRef = createBusinessId(idFactory, "srt", "sourceRootRef");
				if (locationRef !== null) database.prepare(`
            INSERT INTO file_sync_plan_refs(
              plan_ref, ref_kind, plan_id, application_instance_id, scope,
              display_path, normalized_path, issued_at, expires_at
            ) VALUES (?, 'location', ?, ?, ?, ?, ?, ?, ?)
          `).run(locationRef, planId, context.applicationInstanceId, context.scope, locationDisplayPath, locationNormalizedPath, issuedAt, expiresAt);
				database.prepare(`
          INSERT INTO file_sync_plan_refs(
            plan_ref, ref_kind, plan_id, application_instance_id, scope,
            display_path, normalized_path, issued_at, expires_at
          ) VALUES (?, 'source_root', ?, ?, ?, ?, ?, ?, ?)
        `).run(sourceRootRef, planId, context.applicationInstanceId, context.scope, parentDisplayPath, parentNormalizedPath, issuedAt, expiresAt);
				return Object.freeze({
					planId,
					locationRef,
					sourceRootRef,
					scope: context.scope,
					expiresAt
				});
			});
		},
		resolveFileSyncPlanRefs(planId, refs, referenceContext) {
			ensureOpen();
			if (!BUSINESS_IDS.pln.test(requireString(planId, "planId"))) throw referenceResolutionError("plan_shape_invalid");
			requireObject(refs, "refs");
			if (!BUSINESS_IDS.loc.test(requireString(refs.locationRef, "refs.locationRef")) || !BUSINESS_IDS.srt.test(requireString(refs.sourceRootRef, "refs.sourceRootRef"))) throw referenceResolutionError("reference_shape_invalid");
			const context = validateReferenceContext(referenceContext);
			const observedAt = requireTimestamp(now(), "now()");
			const plan = selectFileSyncPlan(database, planId);
			if (plan === null) throw referenceResolutionError("plan_not_found");
			if (plan.kind !== "create_from_template") throw referenceResolutionError("plan_kind_mismatch");
			const validateRow = (row, expectedKind) => {
				if (!row) throw referenceResolutionError("reference_not_found");
				if (row.applicationInstanceId !== context.applicationInstanceId) throw referenceResolutionError("application_instance_mismatch");
				if (row.scope !== context.scope) throw referenceResolutionError("scope_mismatch");
				if (row.revokedAt !== null) throw referenceResolutionError("reference_revoked");
				if (Date.parse(observedAt) >= Date.parse(row.expiresAt)) throw referenceResolutionError("reference_expired");
				if (row.planId !== planId || row.refKind !== expectedKind) throw referenceResolutionError("reference_plan_mismatch");
				return row;
			};
			const locationRow = validateRow(selectPlanRef(database, refs.locationRef), "location");
			const sourceRootRow = validateRow(selectPlanRef(database, refs.sourceRootRef), "source_root");
			if (!pathIsWithin$1(sourceRootRow.normalizedPath, locationRow.normalizedPath) || sameFilesystemPath(sourceRootRow.normalizedPath, locationRow.normalizedPath)) throw referenceResolutionError("location_outside_source_root");
			const projectHomeWorkspacePath = win32.join(plan.targetNormalizedPath, "workspace");
			if (!sameFilesystemPath(plan.targetNormalizedPath, locationRow.normalizedPath) && !sameFilesystemPath(projectHomeWorkspacePath, locationRow.normalizedPath)) throw referenceResolutionError("plan_target_mismatch");
			return Object.freeze({
				planId,
				location: {
					locationId: locationRow.planRef,
					kind: "primary",
					displayPath: locationRow.displayPath,
					normalizedPath: locationRow.normalizedPath,
					verifiedAt: locationRow.issuedAt,
					expiresAt: locationRow.expiresAt
				},
				sourceRoot: {
					sourceRootId: sourceRootRow.planRef,
					displayPath: sourceRootRow.displayPath,
					normalizedPath: sourceRootRow.normalizedPath,
					expiresAt: sourceRootRow.expiresAt
				}
			});
		},
		recordDocumentIndex(input) {
			ensureOpen();
			const index = validateDocumentIndexInput(input);
			const recordedAt = requireTimestamp(now(), "now()");
			executeWrite(database, () => {
				if (!database.prepare("SELECT mode FROM projects WHERE project_id = ?").get(index.projectId)) throw new StorageValidationError("The project does not exist.", {
					reason: "project_not_found",
					projectId: index.projectId
				});
				for (const proposal of index.rebindProposals) for (const candidatePath of proposal.candidateRelativePaths) if (database.prepare(`
              SELECT 1 AS present FROM project_document_bindings
              WHERE project_id = ? AND relative_path = ?
              LIMIT 1
            `).get(index.projectId, candidatePath)) throw new StorageValidationError("A rebind candidate is already a bound document path.", {
					reason: "binding_conflict",
					candidatePath
				});
				const upsertState = database.prepare(`
          INSERT INTO project_document_states(
            project_id, role, relative_path, binding_source, state, content_hash,
            byte_size, parse_issues_json, revision, first_seen_at,
            last_verified_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, role, relative_path) DO UPDATE SET
            binding_source = excluded.binding_source,
            state = excluded.state,
            content_hash = excluded.content_hash,
            byte_size = excluded.byte_size,
            parse_issues_json = excluded.parse_issues_json,
            revision = excluded.revision,
            last_verified_at = excluded.last_verified_at,
            updated_at = excluded.updated_at
        `);
				for (const state of index.documentStates) {
					const prior = database.prepare(`
            SELECT revision, content_hash AS contentHash, state, first_seen_at AS firstSeenAt
            FROM project_document_states
            WHERE project_id = ? AND role = ? AND relative_path = ?
          `).get(index.projectId, state.role, state.relativePath);
					const changed = prior === void 0 || prior.contentHash !== state.contentHash || prior.state !== state.state;
					upsertState.run(index.projectId, state.role, state.relativePath, state.bindingSource, state.state, state.contentHash, state.byteSize, JSON.stringify(state.parseIssues), prior === void 0 ? 1 : Number(prior.revision) + (changed ? 1 : 0), prior === void 0 ? recordedAt : prior.firstSeenAt, recordedAt, recordedAt);
				}
				const incomingKeys = new Set(index.rebindProposals.map((proposal) => `${proposal.role}\u0000${proposal.missingRelativePath}`));
				const existingRows = selectRebindProposalRows(database, index.projectId);
				for (const existing of existingRows) {
					const key = `${existing.role}\u0000${existing.missingRelativePath}`;
					if (!incomingKeys.has(key)) {
						if (existing.status === "proposed") database.prepare(`
                UPDATE project_document_rebind_proposals
                SET status = 'superseded', resolved_at = ?, updated_at = ?,
                  revision = revision + 1
                WHERE proposal_id = ?
              `).run(recordedAt, recordedAt, existing.proposalId);
						continue;
					}
					if (existing.status !== "proposed") {
						if (existing.status === "superseded") database.prepare(`
                DELETE FROM project_document_rebind_proposals WHERE proposal_id = ?
              `).run(existing.proposalId);
					}
				}
				for (const proposal of index.rebindProposals) {
					const key = `${proposal.role}\u0000${proposal.missingRelativePath}`;
					const existing = existingRows.find((row) => `${row.role}\u0000${row.missingRelativePath}` === key);
					if (existing !== void 0 && existing.status !== "proposed" && existing.status !== "superseded") continue;
					const candidatesJson = JSON.stringify(proposal.candidateRelativePaths);
					const unambiguous = proposal.candidateRelativePaths.length === 1;
					if (existing !== void 0 && existing.status === "proposed") {
						if (JSON.stringify(existing.candidateRelativePaths) !== candidatesJson) database.prepare(`
                UPDATE project_document_rebind_proposals
                SET candidate_relative_paths_json = ?, candidate_count = ?,
                  unambiguous = ?, revision = revision + 1, updated_at = ?
                WHERE proposal_id = ?
              `).run(candidatesJson, proposal.candidateRelativePaths.length, unambiguous ? 1 : 0, recordedAt, existing.proposalId);
						continue;
					}
					database.prepare(`
            INSERT INTO project_document_rebind_proposals(
              proposal_id, project_id, role, missing_relative_path, content_hash,
              candidate_relative_paths_json, candidate_count, unambiguous,
              status, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', 1, ?, ?)
          `).run(createBusinessId(idFactory, "rbd", "proposalId"), index.projectId, proposal.role, proposal.missingRelativePath, proposal.contentHash, candidatesJson, proposal.candidateRelativePaths.length, unambiguous ? 1 : 0, recordedAt, recordedAt);
				}
				return null;
			});
			return this.getProjectDocumentIndex(index.projectId);
		},
		getProjectDocumentIndex(projectId) {
			ensureOpen();
			requireString(projectId, "projectId");
			if (!BUSINESS_IDS.prj.test(projectId)) throw new StorageValidationError("projectId must be a prj_ UUIDv7.");
			const project = database.prepare(`
        SELECT project_id AS projectId, mode, name, revision
        FROM projects WHERE project_id = ?
      `).get(projectId);
			if (!project) throw new StorageValidationError("The project does not exist.", {
				reason: "project_not_found",
				projectId
			});
			const location = database.prepare(`
        SELECT display_path AS displayPath
        FROM workspace_locations
        WHERE project_id = ? AND is_active = 1
        ORDER BY kind = 'primary' DESC, location_id
        LIMIT 1
      `).get(projectId);
			const documents = selectDocumentStateRows(database, projectId).map(rowToDocumentState);
			const proposals = selectRebindProposalRows(database, projectId).map((row) => {
				const proposal = rowToRebindProposal(row);
				proposal.applicable = project.mode === "linked_legacy" && proposal.status === "proposed";
				return Object.freeze(proposal);
			});
			return Object.freeze({
				projectId,
				mode: project.mode,
				name: project.name,
				revision: Number(project.revision),
				locationDisplayPath: location === void 0 ? null : location.displayPath,
				documents: Object.freeze(documents),
				proposals: Object.freeze(proposals)
			});
		},
		resolveDocumentRebindProposal(projectId, proposalId, options) {
			ensureOpen();
			requireString(projectId, "projectId");
			requireString(proposalId, "proposalId");
			if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.rbd.test(proposalId)) throw new StorageValidationError("projectId/proposalId must use their prefixed UUIDv7 shapes.");
			requireObject(options, "options");
			const expectedRevision = requireInteger(options.expectedRevision, "options.expectedRevision", 1);
			const decision = requireString(options.decision, "options.decision");
			if (!["accept", "reject"].includes(decision)) throw new StorageValidationError("options.decision must be accept or reject.");
			const candidateRelativePath = options.candidateRelativePath === void 0 ? null : requireString(options.candidateRelativePath, "options.candidateRelativePath");
			if (candidateRelativePath !== null && !RELATIVE_PATH$1.test(candidateRelativePath)) throw new StorageValidationError("options.candidateRelativePath is invalid.");
			const recordedAt = requireTimestamp(now(), "now()");
			return executeWrite(database, () => {
				const project = database.prepare(`
          SELECT mode, revision FROM projects WHERE project_id = ?
        `).get(projectId);
				if (!project) throw new StorageValidationError("The project does not exist.", {
					reason: "project_not_found",
					projectId
				});
				const row = database.prepare(`
          SELECT
            proposal_id AS proposalId, project_id AS projectId, role,
            missing_relative_path AS missingRelativePath, content_hash AS contentHash,
            candidate_relative_paths_json AS candidateRelativePathsJson,
            candidate_count AS candidateCount, unambiguous,
            status, resolved_relative_path AS resolvedRelativePath,
            revision, created_at AS createdAt, updated_at AS updatedAt,
            resolved_at AS resolvedAt
          FROM project_document_rebind_proposals
          WHERE proposal_id = ? AND project_id = ?
        `).get(proposalId, projectId);
				if (!row) throw new StorageValidationError("The rebind proposal does not exist.", {
					reason: "proposal_not_found",
					proposalId
				});
				if (row.status !== "proposed") throw new StorageValidationError("The rebind proposal is no longer open.", {
					reason: "proposal_not_proposed",
					proposalId,
					status: row.status
				});
				if (Number(row.revision) !== expectedRevision) throw new StorageValidationError("The rebind proposal changed before resolution.", {
					reason: "proposal_changed",
					proposalId,
					expectedRevision,
					actualRevision: Number(row.revision)
				});
				if (decision === "reject") {
					database.prepare(`
            UPDATE project_document_rebind_proposals
            SET status = 'rejected', resolved_at = ?, updated_at = ?,
              revision = revision + 1
            WHERE proposal_id = ?
          `).run(recordedAt, recordedAt, proposalId);
					return {
						proposal: this.getProjectDocumentIndex(projectId).proposals.find((proposal) => proposal.proposalId === proposalId),
						projectRevision: Number(project.revision)
					};
				}
				if (project.mode !== "linked_legacy") throw new StorageValidationError("Managed projects keep the manifest as the authoritative binding source; update the manifest instead of rebinding in the index.", {
					reason: "managed_manifest_authoritative",
					projectId,
					mode: project.mode
				});
				const candidates = parseJson(row.candidateRelativePathsJson);
				let chosenPath = null;
				if (Number(row.unambiguous) === 1) {
					chosenPath = candidates[0];
					if (candidateRelativePath !== null && candidateRelativePath !== chosenPath) throw new StorageValidationError("The requested candidate does not match the unambiguous proposal.", {
						reason: "proposal_candidate_mismatch",
						proposalId
					});
				} else {
					if (candidateRelativePath === null) throw new StorageValidationError("Ambiguous rebind proposals require an explicit candidate path.", {
						reason: "proposal_candidate_required",
						proposalId,
						candidateCount: candidates.length
					});
					if (!candidates.includes(candidateRelativePath)) throw new StorageValidationError("The requested candidate is not part of the proposal.", {
						reason: "proposal_candidate_invalid",
						proposalId
					});
					chosenPath = candidateRelativePath;
				}
				const oldBinding = database.prepare(`
          SELECT is_required AS isRequired, source
          FROM project_document_bindings
          WHERE project_id = ? AND role = ? AND relative_path = ?
        `).get(projectId, row.role, row.missingRelativePath);
				if (!oldBinding) throw new StorageValidationError("The missing binding no longer exists.", {
					reason: "binding_not_found",
					projectId
				});
				if (database.prepare(`
          SELECT 1 AS present FROM project_document_bindings
          WHERE project_id = ? AND role = ? AND relative_path = ?
          LIMIT 1
        `).get(projectId, row.role, chosenPath)) throw new StorageValidationError("The rebind target is already bound.", {
					reason: "binding_conflict",
					projectId,
					chosenPath
				});
				database.prepare(`
          DELETE FROM project_document_bindings
          WHERE project_id = ? AND role = ? AND relative_path = ?
        `).run(projectId, row.role, row.missingRelativePath);
				database.prepare(`
          INSERT INTO project_document_bindings(
            project_id, role, relative_path, content_hash, is_required,
            source, confirmed_at, revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(projectId, row.role, chosenPath, row.contentHash, Number(oldBinding.isRequired), oldBinding.source, recordedAt);
				database.prepare(`
          UPDATE project_document_rebind_proposals
          SET status = 'accepted', resolved_relative_path = ?, resolved_at = ?,
            updated_at = ?, revision = revision + 1
          WHERE proposal_id = ?
        `).run(chosenPath, recordedAt, recordedAt, proposalId);
				const updated = database.prepare(`
          UPDATE projects
          SET revision = revision + 1, updated_at = ?
          WHERE project_id = ?
          RETURNING revision
        `).get(recordedAt, projectId);
				return {
					proposal: this.getProjectDocumentIndex(projectId).proposals.find((proposal) => proposal.proposalId === proposalId),
					projectRevision: Number(updated.revision)
				};
			});
		},
		handshakeHostInstance(input) {
			ensureOpen();
			requireObject(input, "input");
			const instanceId = requireString(input.instanceId, "input.instanceId");
			if (!INSTANCE_ID_PATTERN$1.test(instanceId)) throw new StorageValidationError("input.instanceId is invalid.");
			const appVersion = requireBoundedString(input.appVersion, "input.appVersion", 64);
			if (!Array.isArray(input.protocolVersions) || input.protocolVersions.length < 1 || input.protocolVersions.length > 50 || input.protocolVersions.some((version) => typeof version !== "string" || version.length < 1 || version.length > 127)) throw new StorageValidationError("input.protocolVersions must be an array of 1..50 strings.");
			if (!Array.isArray(input.capabilities) || input.capabilities.length > 100 || input.capabilities.some((capability) => typeof capability !== "string" || capability.length < 1 || capability.length > 127)) throw new StorageValidationError("input.capabilities must be an array of at most 100 strings.");
			const recordedAt = requireTimestamp(now(), "now()");
			executeWrite(database, () => {
				if (database.prepare("SELECT revision, started_at AS startedAt FROM host_instances WHERE instance_id = ?").get(instanceId)) database.prepare(`
            UPDATE host_instances
            SET app_version = ?, protocol_versions_json = ?, capabilities_json = ?,
              heartbeat_at = ?, revision = revision + 1, updated_at = ?
            WHERE instance_id = ?
          `).run(appVersion, JSON.stringify(input.protocolVersions), JSON.stringify(input.capabilities), recordedAt, recordedAt, instanceId);
				else database.prepare(`
            INSERT INTO host_instances(
              instance_id, app_version, protocol_versions_json, capabilities_json,
              heartbeat_at, started_at, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
          `).run(instanceId, appVersion, JSON.stringify(input.protocolVersions), JSON.stringify(input.capabilities), recordedAt, recordedAt, recordedAt, recordedAt);
			});
			const row = database.prepare(`
        SELECT instance_id AS instanceId, app_version AS appVersion,
          protocol_versions_json AS protocolVersionsJson,
          capabilities_json AS capabilitiesJson,
          heartbeat_at AS heartbeatAt, started_at AS startedAt,
          revision, created_at AS createdAt, updated_at AS updatedAt
        FROM host_instances WHERE instance_id = ?
      `).get(instanceId);
			return Object.freeze({
				instanceId: row.instanceId,
				appVersion: row.appVersion,
				protocolVersions: parseJson(row.protocolVersionsJson),
				capabilities: parseJson(row.capabilitiesJson),
				heartbeatAt: row.heartbeatAt,
				startedAt: row.startedAt,
				revision: Number(row.revision),
				createdAt: row.createdAt,
				updatedAt: row.updatedAt
			});
		},
		createWorkItem(projectId, input) {
			ensureOpen();
			requireString(projectId, "projectId");
			if (!BUSINESS_IDS.prj.test(projectId)) throw new StorageValidationError("projectId must be a prj_ UUIDv7.");
			requireObject(input, "input");
			const title = requireBoundedString(input.title, "input.title", 500);
			const instruction = input.instruction === void 0 ? null : requireBoundedString(input.instruction, "input.instruction", 2e4);
			const acceptance = validateTextList(input.acceptance ?? ["已完成并通过验收"], "input.acceptance");
			const executionStatus = input.executionStatus ?? "draft";
			if (![
				"draft",
				"ready",
				"running",
				"paused",
				"blocked",
				"completed",
				"cancelled"
			].includes(executionStatus)) throw new StorageValidationError("input.executionStatus is not supported.");
			const reviewStatus = input.reviewStatus ?? "not_requested";
			if (![
				"not_requested",
				"pending",
				"changes_requested",
				"approved",
				"rejected"
			].includes(reviewStatus)) throw new StorageValidationError("input.reviewStatus is not supported.");
			const priority = input.priority === void 0 ? 50 : requireInteger(input.priority, "input.priority", 0);
			if (priority > 100) throw new StorageValidationError("input.priority cannot exceed 100.");
			const recordedAt = requireTimestamp(now(), "now()");
			const workItemId = createBusinessId(idFactory, "wrk", "workItemId");
			executeWrite(database, () => {
				if (!database.prepare("SELECT 1 AS present FROM projects WHERE project_id = ?").get(projectId)) throw new StorageValidationError("The project does not exist.", { reason: "project_not_found" });
				database.prepare(`
          INSERT INTO work_items(
            work_item_id, project_id, title, instruction, acceptance_json,
            execution_status, review_status, priority, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(workItemId, projectId, title, instruction, JSON.stringify(acceptance), executionStatus, reviewStatus, priority, recordedAt, recordedAt);
				recordConsoleEvent({
					projectId,
					aggregateType: "work_item",
					aggregateId: workItemId,
					beforeRevision: 0,
					afterRevision: 1,
					eventType: "workitem.created",
					data: {
						title,
						executionStatus,
						reviewStatus,
						priority
					},
					recordedAt
				});
			});
			return this.getWorkItem(workItemId);
		},
		createRun(projectId, workItemId, input) {
			ensureOpen();
			requireString(projectId, "projectId");
			requireString(workItemId, "workItemId");
			if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.wrk.test(workItemId)) throw new StorageValidationError("projectId/workItemId must use their prefixed UUIDv7 shapes.");
			requireObject(input ?? {}, "input");
			input = input ?? {};
			const recordedAt = requireTimestamp(now(), "now()");
			const runId = createBusinessId(idFactory, "run", "runId");
			executeWrite(database, () => {
				const workItem = database.prepare(`
          SELECT instruction, acceptance_json AS acceptanceJson FROM work_items
          WHERE work_item_id = ? AND project_id = ?
        `).get(workItemId, projectId);
				if (!workItem) throw new StorageValidationError("The work item does not exist in this project.", { reason: "work_item_not_found" });
				const attemptNo = input.attemptNo === void 0 ? Number(database.prepare("SELECT COALESCE(MAX(attempt_no), 0) AS maximum FROM runs WHERE work_item_id = ?").get(workItemId).maximum) + 1 : requireInteger(input.attemptNo, "input.attemptNo", 1);
				const instructionSnapshot = input.instructionSnapshot ?? workItem.instruction ?? "";
				const acceptanceSnapshot = input.acceptanceSnapshot ?? parseJson(workItem.acceptanceJson);
				database.prepare(`
          INSERT INTO runs(
            run_id, project_id, work_item_id, attempt_no, status,
            instruction_snapshot_json, acceptance_snapshot_json,
            revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'queued', ?, ?, 1, ?, ?)
        `).run(runId, projectId, workItemId, attemptNo, JSON.stringify(instructionSnapshot), JSON.stringify(acceptanceSnapshot), recordedAt, recordedAt);
				recordConsoleEvent({
					projectId,
					aggregateType: "run",
					aggregateId: runId,
					beforeRevision: 0,
					afterRevision: 1,
					eventType: "run.created",
					data: {
						workItemId,
						attemptNo,
						status: "queued"
					},
					recordedAt
				});
			});
			return this.getRun(runId);
		},
		bindAgentThread(projectId, runId, input) {
			ensureOpen();
			requireString(projectId, "projectId");
			requireString(runId, "runId");
			if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.run.test(runId)) throw new StorageValidationError("projectId/runId must use their prefixed UUIDv7 shapes.");
			requireObject(input, "input");
			const harnessInstanceRef = requireBoundedString(input.harnessInstanceRef, "input.harnessInstanceRef", 127);
			const sessionId = requireBoundedString(input.sessionId, "input.sessionId", 200);
			const threadId = requireString(input.threadId, "input.threadId");
			if (!THREAD_ID_PATTERN.test(threadId)) throw new StorageValidationError("input.threadId is invalid.");
			const recordedAt = requireTimestamp(now(), "now()");
			const bindingId = createBusinessId(idFactory, "atb", "bindingId");
			executeWrite(database, () => {
				if (!database.prepare("SELECT 1 AS present FROM runs WHERE run_id = ? AND project_id = ?").get(runId, projectId)) throw new StorageValidationError("The run does not exist in this project.", { reason: "run_not_found" });
				if (!database.prepare("SELECT 1 AS present FROM host_instances WHERE instance_id = ?").get(harnessInstanceRef)) throw new StorageValidationError("The Harness instance has not completed a capability handshake.", { reason: "instance_not_handshaken" });
				if (database.prepare("SELECT 1 AS present FROM agent_thread_bindings WHERE run_id = ? AND thread_id = ?").get(runId, threadId)) throw new StorageValidationError("The thread is already bound to this run.", { reason: "thread_binding_conflict" });
				database.prepare(`
          INSERT INTO agent_thread_bindings(
            binding_id, project_id, run_id, harness_instance_ref, session_id, thread_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(bindingId, projectId, runId, harnessInstanceRef, sessionId, threadId, recordedAt);
			});
			const row = database.prepare(`
        SELECT binding_id AS bindingId, project_id AS projectId, run_id AS runId,
          harness_instance_ref AS harnessInstanceRef, session_id AS sessionId,
          thread_id AS threadId, created_at AS createdAt
        FROM agent_thread_bindings WHERE binding_id = ?
      `).get(bindingId);
			return Object.freeze({
				bindingId: row.bindingId,
				projectId: row.projectId,
				runId: row.runId,
				harnessInstanceRef: row.harnessInstanceRef,
				sessionId: row.sessionId,
				threadId: row.threadId,
				createdAt: row.createdAt
			});
		},
		applyExternalUpdate(command) {
			ensureOpen();
			const envelope = validateExternalUpdateCommand$1(command);
			const identity = commandIdentity(command);
			return executeWrite(database, () => {
				const replay = replayOrThrow(findExistingReceipt(database, identity), identity);
				if (replay) return replay;
				const instance = database.prepare("SELECT app_version AS appVersion FROM host_instances WHERE instance_id = ?").get(envelope.provenance.applicationInstanceId);
				if (!instance) return rejectExternalUpdate(command, identity, "CAPABILITY_NOT_NEGOTIATED", "The producer has not completed a capability handshake with this Host.");
				if (instance.appVersion !== envelope.provenance.applicationVersion) return rejectExternalUpdate(command, identity, "CAPABILITY_NOT_NEGOTIATED", "The producer applicationVersion does not match the handshake record.");
				const target = envelope.target;
				let currentRevision = null;
				if (target.aggregateType === "work_item") {
					const row = database.prepare(`
            SELECT revision FROM work_items WHERE work_item_id = ? AND project_id = ?
          `).get(target.aggregateId, target.projectId);
					if (!row) return rejectExternalUpdate(command, identity, "REFERENCE_UNRESOLVED", "The target work item does not exist in this project.");
					currentRevision = Number(row.revision);
				} else {
					const row = database.prepare(`
            SELECT revision FROM runs
            WHERE run_id = ? AND project_id = ? AND work_item_id = ?
          `).get(target.aggregateId, target.projectId, target.workItemId);
					if (!row) return rejectExternalUpdate(command, identity, "REFERENCE_UNRESOLVED", "The target run does not exist for this work item and project.");
					currentRevision = Number(row.revision);
				}
				if (currentRevision !== envelope.expectedRevision) return rejectExternalUpdate(command, identity, "REVISION_CONFLICT", "The target aggregate revision changed before this update.", currentRevision);
				if (!database.prepare(`
          SELECT 1 AS present FROM agent_thread_bindings
          WHERE run_id = ? AND thread_id = ?
        `).get(target.runId, target.threadId)) return rejectExternalUpdate(command, identity, "REFERENCE_UNRESOLVED", "The session thread is not bound to the target run.");
				const recordedAt = now();
				const afterRevision = currentRevision + 1;
				const nextStatus = envelope.kind === "blocker.raise" ? "blocked" : envelope.kind === "completion.declare" ? target.aggregateType === "run" ? "completed" : "needs_review" : null;
				if (target.aggregateType === "work_item") if (nextStatus === null) database.prepare(`
              UPDATE work_items SET updated_at = ?, revision = revision + 1
              WHERE work_item_id = ? AND project_id = ?
            `).run(recordedAt, target.aggregateId, target.projectId);
				else if (envelope.kind === "completion.declare") database.prepare(`
              UPDATE work_items
              SET execution_status = 'completed', review_status = 'pending',
                updated_at = ?, revision = revision + 1
              WHERE work_item_id = ? AND project_id = ?
            `).run(recordedAt, target.aggregateId, target.projectId);
				else database.prepare(`
              UPDATE work_items
              SET execution_status = 'blocked', updated_at = ?, revision = revision + 1
              WHERE work_item_id = ? AND project_id = ?
            `).run(recordedAt, target.aggregateId, target.projectId);
				else if (nextStatus === null) database.prepare(`
            UPDATE runs SET updated_at = ?, revision = revision + 1
            WHERE run_id = ? AND project_id = ?
          `).run(recordedAt, target.aggregateId, target.projectId);
				else database.prepare(`
            UPDATE runs SET status = ?, updated_at = ?, revision = revision + 1
            WHERE run_id = ? AND project_id = ?
          `).run(nextStatus, recordedAt, target.aggregateId, target.projectId);
				const kindColumn = {
					"progress.report": "progress",
					"blocker.raise": "blocker",
					"completion.declare": "completion_declared"
				}[envelope.kind];
				database.prepare(`
          INSERT INTO progress_updates(
            progress_update_id, project_id, work_item_id, run_id, kind,
            summary, needs_json, acceptance_claims_json, evidence_json,
            completion_percent, details, thread_id, command_id,
            aggregate_type, aggregate_id, aggregate_revision,
            generated_by_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(createBusinessId(idFactory, "upd", "progressUpdateId"), target.projectId, target.workItemId, target.runId, kindColumn, envelope.payload.summary, kindColumn === "blocker" ? JSON.stringify(envelope.payload.needs) : "[]", kindColumn === "completion_declared" ? JSON.stringify(envelope.payload.acceptanceClaims) : "[]", JSON.stringify(envelope.payload.evidence ?? []), envelope.payload.completionPercent ?? null, envelope.payload.details ?? null, target.threadId, envelope.commandId, target.aggregateType, target.aggregateId, afterRevision, JSON.stringify({
					applicationId: envelope.actor.applicationId,
					applicationVersion: envelope.provenance.applicationVersion,
					applicationInstanceId: envelope.provenance.applicationInstanceId,
					rendererVersion: "project-control-host/v1alpha1"
				}), recordedAt);
				const sequence = nextSequence(database);
				const eventId = idFactory("evt");
				const outboxId = idFactory("out");
				const event = {
					protocolVersion: PROTOCOL_VERSION$1,
					schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION$1,
					eventId,
					eventType: EXTERNAL_EVENT_TYPES$1[envelope.kind],
					occurredAt: envelope.occurredAt,
					recordedAt,
					sequence,
					actor: envelope.actor,
					target: envelope.target,
					beforeRevision: currentRevision,
					afterRevision,
					causation: {
						commandId: envelope.commandId,
						idempotencyKey: envelope.idempotencyKey,
						correlationId: envelope.correlationId
					},
					provenance: envelope.provenance,
					data: envelope.payload
				};
				const result = {
					protocolVersion: PROTOCOL_VERSION$1,
					schemaVersion: EXTERNAL_RESULT_SCHEMA_VERSION,
					commandId: envelope.commandId,
					correlationId: envelope.correlationId,
					kind: envelope.kind,
					status: "accepted",
					recordedAt,
					aggregateType: target.aggregateType,
					aggregateId: target.aggregateId,
					aggregateRevision: afterRevision,
					eventId
				};
				insertReceipt(database, command, identity, "accepted", recordedAt, result, null);
				insertEvent(database, event, command, target.aggregateType, target.aggregateId);
				insertOutbox(database, outboxId, event, recordedAt);
				return Object.freeze(result);
			});
		},
		getWorkItem(workItemId) {
			ensureOpen();
			requireString(workItemId, "workItemId");
			if (!BUSINESS_IDS.wrk.test(workItemId)) throw new StorageValidationError("workItemId must be a wrk_ UUIDv7.");
			return selectWorkItem(database, workItemId);
		},
		listWorkItems({ projectId = null, limit = 100, afterWorkItemId = "" } = {}) {
			ensureOpen();
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			if (projectId !== null) requireString(projectId, "projectId");
			if (afterWorkItemId !== "") requireString(afterWorkItemId, "afterWorkItemId");
			return database.prepare(`
        SELECT work_item_id AS workItemId FROM work_items
        WHERE work_item_id > ? AND (? IS NULL OR project_id = ?)
        ORDER BY work_item_id LIMIT ?
      `).all(afterWorkItemId, projectId, projectId, limit).map((row) => selectWorkItem(database, row.workItemId));
		},
		getRun(runId) {
			ensureOpen();
			requireString(runId, "runId");
			if (!BUSINESS_IDS.run.test(runId)) throw new StorageValidationError("runId must be a run_ UUIDv7.");
			return selectRun(database, runId);
		},
		listRuns({ projectId = null, workItemId = null, limit = 100, afterRunId = "" } = {}) {
			ensureOpen();
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			if (projectId !== null) requireString(projectId, "projectId");
			if (workItemId !== null) requireString(workItemId, "workItemId");
			if (afterRunId !== "") requireString(afterRunId, "afterRunId");
			return database.prepare(`
        SELECT run_id AS runId FROM runs
        WHERE run_id > ?
          AND (? IS NULL OR project_id = ?)
          AND (? IS NULL OR work_item_id = ?)
        ORDER BY run_id LIMIT ?
      `).all(afterRunId, projectId, projectId, workItemId, workItemId, limit).map((row) => selectRun(database, row.runId));
		},
		listProgressUpdates({ projectId = null, workItemId = null, runId = null, limit = 100, afterProgressUpdateId = "" } = {}) {
			ensureOpen();
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			if (projectId !== null) requireString(projectId, "projectId");
			if (workItemId !== null) requireString(workItemId, "workItemId");
			if (runId !== null) requireString(runId, "runId");
			if (afterProgressUpdateId !== "") requireString(afterProgressUpdateId, "afterProgressUpdateId");
			return database.prepare(`
        SELECT ${PROGRESS_UPDATE_COLUMNS}
        FROM progress_updates
        WHERE progress_update_id > ?
          AND (? IS NULL OR project_id = ?)
          AND (? IS NULL OR work_item_id = ?)
          AND (? IS NULL OR run_id = ?)
        ORDER BY progress_update_id LIMIT ?
      `).all(afterProgressUpdateId, projectId, projectId, workItemId, workItemId, runId, runId, limit).map((row) => Object.freeze(mapProgressUpdateRow(row)));
		},
		getProgressUpdateByCommandId(commandId) {
			ensureOpen();
			requireString(commandId, "commandId");
			const row = database.prepare(`
        SELECT ${PROGRESS_UPDATE_COLUMNS}
        FROM progress_updates WHERE command_id = ?
        ORDER BY created_at, progress_update_id LIMIT 1
      `).get(commandId);
			return row ? Object.freeze(mapProgressUpdateRow(row)) : null;
		},
		recordQuarantineItem(input) {
			ensureOpen();
			requireObject(input, "input");
			const quarantineId = createBusinessId(idFactory, "qtn", "quarantineId");
			const recordedAt = requireTimestamp(now(), "now()");
			const projectId = input.projectId === void 0 || input.projectId === null ? null : requireString(input.projectId, "input.projectId");
			if (projectId !== null && !BUSINESS_IDS.prj.test(projectId)) throw new StorageValidationError("input.projectId must be a prj_ UUIDv7.");
			const details = input.details ?? {};
			requireObject(details, "input.details");
			executeWrite(database, () => {
				database.prepare(`
          INSERT INTO quarantine_items(
            quarantine_id, project_id, source_kind, source_ref, reason_code,
            payload_ref, status, details_json, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 1, ?, ?)
        `).run(quarantineId, projectId, requireBoundedString(input.sourceKind, "input.sourceKind", 100), requireBoundedString(input.sourceRef, "input.sourceRef", 512), requireBoundedString(input.reasonCode, "input.reasonCode", 100), input.payloadRef === void 0 ? null : requireBoundedString(input.payloadRef, "input.payloadRef", 512), JSON.stringify(details), recordedAt, recordedAt);
			});
			return selectQuarantineItem(database, quarantineId);
		},
		listQuarantineItems({ projectId = null, status = null, limit = 100, afterQuarantineId = "" } = {}) {
			ensureOpen();
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			if (projectId !== null) requireString(projectId, "projectId");
			if (status !== null && ![
				"open",
				"resolved",
				"ignored"
			].includes(status)) throw new StorageValidationError("status must be open, resolved or ignored.");
			if (afterQuarantineId !== "") requireString(afterQuarantineId, "afterQuarantineId");
			return database.prepare(`
        SELECT quarantine_id AS quarantineId FROM quarantine_items
        WHERE quarantine_id > ?
          AND (? IS NULL OR project_id = ?)
          AND (? IS NULL OR status = ?)
        ORDER BY quarantine_id LIMIT ?
      `).all(afterQuarantineId, projectId, projectId, status, status, limit).map((row) => selectQuarantineItem(database, row.quarantineId));
		},
		resolveQuarantineItem(quarantineId, options) {
			ensureOpen();
			requireString(quarantineId, "quarantineId");
			if (!BUSINESS_IDS.qtn.test(quarantineId)) throw new StorageValidationError("quarantineId must be a qtn_ UUIDv7.");
			requireObject(options, "options");
			const expectedRevision = requireInteger(options.expectedRevision, "options.expectedRevision", 1);
			const decision = requireString(options.decision, "options.decision");
			if (!["resolved", "ignored"].includes(decision)) throw new StorageValidationError("options.decision must be resolved or ignored.");
			const recordedAt = requireTimestamp(now(), "now()");
			executeWrite(database, () => {
				const current = database.prepare("SELECT revision, status FROM quarantine_items WHERE quarantine_id = ?").get(quarantineId);
				if (!current) throw new StorageValidationError("The quarantine item does not exist.", { reason: "quarantine_not_found" });
				if (Number(current.revision) !== expectedRevision) throw new StorageValidationError("The quarantine item changed before resolution.", { reason: "quarantine_changed" });
				if (current.status !== "open") throw new StorageValidationError("The quarantine item is no longer open.", { reason: "quarantine_not_open" });
				database.prepare(`
          UPDATE quarantine_items
          SET status = ?, resolved_at = ?, updated_at = ?, revision = revision + 1
          WHERE quarantine_id = ? AND revision = ?
        `).run(decision, recordedAt, recordedAt, quarantineId, expectedRevision);
			});
			return selectQuarantineItem(database, quarantineId);
		},
		listReviews({ projectId = null, limit = 100 } = {}) {
			ensureOpen();
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			if (projectId !== null) requireString(projectId, "projectId");
			return database.prepare(`
        SELECT ${REVIEW_COLUMNS}
        FROM reviews
        WHERE (? IS NULL OR project_id = ?)
        ORDER BY review_id LIMIT ?
      `).all(projectId, projectId, limit).map((row) => Object.freeze(mapReviewRow(row)));
		},
		getReview(reviewId) {
			ensureOpen();
			requireString(reviewId, "reviewId");
			if (!BUSINESS_IDS.rev.test(reviewId)) throw new StorageValidationError("reviewId must be a rev_ UUIDv7.");
			return selectReview(database, reviewId);
		},
		listThreadBindings({ projectId = null, limit = 100, afterBindingId = "" } = {}) {
			ensureOpen();
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			if (projectId !== null) requireString(projectId, "projectId");
			if (afterBindingId !== "") requireString(afterBindingId, "afterBindingId");
			return database.prepare(`
        SELECT
          binding_id AS bindingId, project_id AS projectId, run_id AS runId,
          harness_instance_ref AS harnessInstanceRef, session_id AS sessionId,
          thread_id AS threadId, created_at AS createdAt
        FROM agent_thread_bindings
        WHERE binding_id > ? AND (? IS NULL OR project_id = ?)
        ORDER BY created_at, binding_id LIMIT ?
      `).all(afterBindingId, projectId, projectId, limit).map((row) => Object.freeze({
				bindingId: row.bindingId,
				projectId: row.projectId,
				runId: row.runId,
				harnessInstanceRef: row.harnessInstanceRef,
				sessionId: row.sessionId,
				threadId: row.threadId,
				createdAt: row.createdAt
			}));
		},
		listReviewActions(reviewId, { afterReviewActionId = "", limit = 100 } = {}) {
			ensureOpen();
			requireString(reviewId, "reviewId");
			if (!BUSINESS_IDS.rev.test(reviewId)) throw new StorageValidationError("reviewId must be a rev_ UUIDv7.");
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			if (afterReviewActionId !== "") requireString(afterReviewActionId, "afterReviewActionId");
			return database.prepare(`
        SELECT
          review_action_id AS reviewActionId, review_id AS reviewId,
          action, actor_ref AS actorRef, comment, created_at AS createdAt
        FROM review_actions
        WHERE review_id = ? AND review_action_id > ?
        ORDER BY created_at, review_action_id LIMIT ?
      `).all(reviewId, afterReviewActionId, limit).map((row) => Object.freeze(mapReviewActionRow(row)));
		},
		listDecisions({ projectId = null, limit = 100 } = {}) {
			ensureOpen();
			requireInteger(limit, "limit", 1);
			if (limit > 500) throw new StorageValidationError("limit cannot exceed 500.");
			if (projectId !== null) requireString(projectId, "projectId");
			return database.prepare(`
        SELECT
          decision_id AS decisionId, project_id AS projectId, work_item_id AS workItemId,
          title, context, options_json AS optionsJson, status, rationale,
          proposed_by_json AS proposedByJson, decided_by_json AS decidedByJson,
          revision, created_at AS createdAt, updated_at AS updatedAt, decided_at AS decidedAt
        FROM decisions
        WHERE (? IS NULL OR project_id = ?)
        ORDER BY decision_id LIMIT ?
      `).all(projectId, projectId, limit).map((row) => Object.freeze({
				decisionId: row.decisionId,
				projectId: row.projectId,
				workItemId: row.workItemId,
				title: row.title,
				context: row.context,
				options: parseJson(row.optionsJson),
				status: row.status,
				rationale: row.rationale,
				proposedBy: parseJson(row.proposedByJson),
				decidedBy: row.decidedByJson === null ? null : parseJson(row.decidedByJson),
				revision: Number(row.revision),
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
				decidedAt: row.decidedAt
			}));
		},
		setWorkItemStatus(projectId, workItemId, input) {
			ensureOpen();
			requireString(projectId, "projectId");
			requireString(workItemId, "workItemId");
			if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.wrk.test(workItemId)) throw new StorageValidationError("projectId/workItemId must use their prefixed UUIDv7 shapes.");
			requireObject(input, "input");
			const expectedRevision = requireInteger(input.expectedRevision, "input.expectedRevision", 1);
			const status = requireString(input.status, "input.status");
			if (!WORK_ITEM_STATUSES.has(status)) throw new StorageValidationError("input.status is not supported.");
			const transitions = {
				draft: new Set(["ready", "cancelled"]),
				ready: new Set(["running", "cancelled"]),
				running: new Set(["paused", "cancelled"]),
				paused: new Set([
					"ready",
					"running",
					"cancelled"
				]),
				blocked: new Set(["ready", "cancelled"])
			};
			const recordedAt = requireTimestamp(now(), "now()");
			return executeWrite(database, () => {
				const row = database.prepare(`
          SELECT execution_status AS executionStatus, revision
          FROM work_items WHERE work_item_id = ? AND project_id = ?
        `).get(workItemId, projectId);
				if (!row) throw new StorageValidationError("The work item does not exist in this project.", { reason: "work_item_not_found" });
				if (Number(row.revision) !== expectedRevision) throw new StorageValidationError("The work item changed before this update.", { reason: "revision_conflict" });
				const allowed = transitions[row.executionStatus];
				if (allowed === void 0 || !allowed.has(status)) throw new StorageValidationError("The work item status transition is not allowed.", { reason: "transition_not_allowed" });
				database.prepare(`
          UPDATE work_items SET execution_status = ?, updated_at = ?, revision = revision + 1
          WHERE work_item_id = ? AND project_id = ?
        `).run(status, recordedAt, workItemId, projectId);
				recordConsoleEvent({
					projectId,
					aggregateType: "work_item",
					aggregateId: workItemId,
					beforeRevision: expectedRevision,
					afterRevision: expectedRevision + 1,
					eventType: "workitem.status_changed",
					data: {
						from: row.executionStatus,
						to: status
					},
					recordedAt
				});
				return this.getWorkItem(workItemId);
			});
		},
		startRun(projectId, runId, input) {
			ensureOpen();
			requireString(projectId, "projectId");
			requireString(runId, "runId");
			if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.run.test(runId)) throw new StorageValidationError("projectId/runId must use their prefixed UUIDv7 shapes.");
			requireObject(input, "input");
			const expectedRevision = requireInteger(input.expectedRevision, "input.expectedRevision", 1);
			const recordedAt = requireTimestamp(now(), "now()");
			return executeWrite(database, () => {
				const run = database.prepare(`
          SELECT work_item_id AS workItemId, status, revision
          FROM runs WHERE run_id = ? AND project_id = ?
        `).get(runId, projectId);
				if (!run) throw new StorageValidationError("The run does not exist in this project.", { reason: "run_not_found" });
				if (Number(run.revision) !== expectedRevision) throw new StorageValidationError("The run changed before this update.", { reason: "revision_conflict" });
				if (run.status !== "queued") throw new StorageValidationError("Only queued runs can be started.", { reason: "transition_not_allowed" });
				database.prepare(`
          UPDATE runs SET status = 'running', started_at = ?, updated_at = ?, revision = revision + 1
          WHERE run_id = ? AND project_id = ?
        `).run(recordedAt, recordedAt, runId, projectId);
				const workItem = database.prepare(`
          SELECT execution_status AS executionStatus, revision
          FROM work_items WHERE work_item_id = ? AND project_id = ?
        `).get(run.workItemId, projectId);
				if (!workItem) throw new StorageValidationError("The run work item does not exist.", { reason: "work_item_not_found" });
				if (workItem.executionStatus !== "running" && workItem.executionStatus !== "completed" && workItem.executionStatus !== "cancelled") database.prepare(`
            UPDATE work_items SET execution_status = 'running', updated_at = ?, revision = revision + 1
            WHERE work_item_id = ? AND project_id = ?
          `).run(recordedAt, run.workItemId, projectId);
				recordConsoleEvent({
					projectId,
					aggregateType: "run",
					aggregateId: runId,
					beforeRevision: expectedRevision,
					afterRevision: expectedRevision + 1,
					eventType: "run.started",
					data: { workItemId: run.workItemId },
					recordedAt
				});
				return this.getRun(runId);
			});
		},
		requestReview(projectId, workItemId, input) {
			ensureOpen();
			requireString(projectId, "projectId");
			requireString(workItemId, "workItemId");
			if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.wrk.test(workItemId)) throw new StorageValidationError("projectId/workItemId must use their prefixed UUIDv7 shapes.");
			requireObject(input, "input");
			const expectedRevision = requireInteger(input.expectedRevision, "input.expectedRevision", 1);
			const risk = input.risk === void 0 || input.risk === null ? "unrated" : requireString(input.risk, "input.risk");
			if (!REVIEW_RISKS.has(risk)) throw new StorageValidationError("input.risk is not supported.");
			const recordedAt = requireTimestamp(now(), "now()");
			const reviewId = createBusinessId(idFactory, "rev", "reviewId");
			return executeWrite(database, () => {
				const row = database.prepare(`
          SELECT review_status AS reviewStatus, revision
          FROM work_items WHERE work_item_id = ? AND project_id = ?
        `).get(workItemId, projectId);
				if (!row) throw new StorageValidationError("The work item does not exist in this project.", { reason: "work_item_not_found" });
				if (Number(row.revision) !== expectedRevision) throw new StorageValidationError("The work item changed before this request.", { reason: "revision_conflict" });
				if (![
					"not_requested",
					"changes_requested",
					"rejected"
				].includes(row.reviewStatus)) throw new StorageValidationError("The work item review state does not allow a new request.", { reason: "review_state_conflict" });
				if (database.prepare(`
          SELECT 1 AS present FROM reviews
          WHERE work_item_id = ? AND status IN ('requested', 'in_review')
        `).get(workItemId)) throw new StorageValidationError("The work item already has an open review.", { reason: "review_open" });
				database.prepare(`
          UPDATE work_items SET review_status = 'pending', updated_at = ?, revision = revision + 1
          WHERE work_item_id = ? AND project_id = ?
        `).run(recordedAt, workItemId, projectId);
				database.prepare(`
          INSERT INTO reviews(
            review_id, project_id, work_item_id, reviewed_work_item_revision,
            artifact_refs_json, status, risk, requested_by_json, decided_by_json,
            revision, created_at, updated_at, decided_at
          ) VALUES (?, ?, ?, ?, '[]', 'requested', ?, ?, NULL, 1, ?, ?, NULL)
        `).run(reviewId, projectId, workItemId, expectedRevision + 1, risk, canonicalJson(CONSOLE_ACTOR), recordedAt, recordedAt);
				recordConsoleEvent({
					projectId,
					aggregateType: "work_item",
					aggregateId: workItemId,
					beforeRevision: expectedRevision,
					afterRevision: expectedRevision + 1,
					eventType: "review.requested",
					data: {
						reviewId,
						risk,
						reviewedWorkItemRevision: expectedRevision + 1
					},
					recordedAt
				});
				return this.getReview(reviewId);
			});
		},
		decideReview(projectId, reviewId, input) {
			ensureOpen();
			requireString(projectId, "projectId");
			requireString(reviewId, "reviewId");
			if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.rev.test(reviewId)) throw new StorageValidationError("projectId/reviewId must use their prefixed UUIDv7 shapes.");
			requireObject(input, "input");
			const expectedRevision = requireInteger(input.expectedRevision, "input.expectedRevision", 1);
			const decision = requireString(input.decision, "input.decision");
			if (![
				"approve",
				"reject",
				"request_changes"
			].includes(decision)) throw new StorageValidationError("input.decision is not supported.");
			const rationale = input.rationale === void 0 || input.rationale === null ? null : requireBoundedString(input.rationale, "input.rationale", 4e3);
			const recordedAt = requireTimestamp(now(), "now()");
			const reviewActionId = createBusinessId(idFactory, "rva", "reviewActionId");
			return executeWrite(database, () => {
				const review = database.prepare(`
          SELECT work_item_id AS workItemId, status, revision
          FROM reviews WHERE review_id = ? AND project_id = ?
        `).get(reviewId, projectId);
				if (!review) throw new StorageValidationError("The review does not exist in this project.", { reason: "review_not_found" });
				if (Number(review.revision) !== expectedRevision) throw new StorageValidationError("The review changed before this decision.", { reason: "revision_conflict" });
				if (!["requested", "in_review"].includes(review.status)) throw new StorageValidationError("The review is no longer open.", { reason: "review_not_open" });
				const workItem = database.prepare(`
          SELECT review_status AS reviewStatus, revision
          FROM work_items WHERE work_item_id = ? AND project_id = ?
        `).get(review.workItemId, projectId);
				if (!workItem) throw new StorageValidationError("The review work item does not exist.", { reason: "work_item_not_found" });
				const action = decision === "approve" ? "approve" : decision === "reject" ? "reject" : "request_changes";
				const eventType = decision === "approve" ? "review.approved" : decision === "reject" ? "review.rejected" : "review.changes_requested";
				const reviewStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes_requested";
				const reviewRowStatus = decision === "approve" ? "approved" : "rejected";
				database.prepare(`
          UPDATE reviews
          SET status = ?, decided_by_json = ?, decided_at = ?, updated_at = ?, revision = revision + 1
          WHERE review_id = ? AND project_id = ?
        `).run(reviewRowStatus, canonicalJson(CONSOLE_ACTOR), recordedAt, recordedAt, reviewId, projectId);
				database.prepare(`
          UPDATE work_items SET review_status = ?, updated_at = ?, revision = revision + 1
          WHERE work_item_id = ? AND project_id = ?
        `).run(reviewStatus, recordedAt, review.workItemId, projectId);
				database.prepare(`
          INSERT INTO review_actions(review_action_id, review_id, action, actor_ref, comment, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(reviewActionId, reviewId, action, canonicalJson(CONSOLE_ACTOR), rationale, recordedAt);
				recordConsoleEvent({
					projectId,
					aggregateType: "work_item",
					aggregateId: review.workItemId,
					beforeRevision: Number(workItem.revision),
					afterRevision: Number(workItem.revision) + 1,
					eventType,
					data: {
						reviewId,
						decision,
						rationale
					},
					recordedAt
				});
				return this.getReview(reviewId);
			});
		},
		commentReview(projectId, reviewId, input) {
			ensureOpen();
			requireString(projectId, "projectId");
			requireString(reviewId, "reviewId");
			if (!BUSINESS_IDS.prj.test(projectId) || !BUSINESS_IDS.rev.test(reviewId)) throw new StorageValidationError("projectId/reviewId must use their prefixed UUIDv7 shapes.");
			requireObject(input, "input");
			const comment = requireBoundedString(input.comment, "input.comment", 4e3);
			const recordedAt = requireTimestamp(now(), "now()");
			const reviewActionId = createBusinessId(idFactory, "rva", "reviewActionId");
			return executeWrite(database, () => {
				if (!database.prepare("SELECT 1 AS present FROM reviews WHERE review_id = ? AND project_id = ?").get(reviewId, projectId)) throw new StorageValidationError("The review does not exist in this project.", { reason: "review_not_found" });
				database.prepare(`
          INSERT INTO review_actions(review_action_id, review_id, action, actor_ref, comment, created_at)
          VALUES (?, ?, 'comment', ?, ?, ?)
        `).run(reviewActionId, reviewId, canonicalJson(CONSOLE_ACTOR), comment, recordedAt);
				const row = database.prepare(`
          SELECT
            review_action_id AS reviewActionId, review_id AS reviewId,
            action, actor_ref AS actorRef, comment, created_at AS createdAt
          FROM review_actions WHERE review_action_id = ?
        `).get(reviewActionId);
				return Object.freeze(mapReviewActionRow(row));
			});
		},
		close() {
			if (closed) return;
			let failure = null;
			try {
				storage.status();
			} catch (error) {
				failure = error;
			} finally {
				closed = true;
				try {
					database.close();
				} catch (error) {
					failure ??= error;
				}
				try {
					writerLock.release();
				} catch (error) {
					failure ??= error;
				}
			}
			if (failure) throw failure;
		}
	};
	return Object.freeze(storage);
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/code.js
var require_code$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.regexpCode = exports.getEsmExportName = exports.getProperty = exports.safeStringify = exports.stringify = exports.strConcat = exports.addCodeArg = exports.str = exports._ = exports.nil = exports._Code = exports.Name = exports.IDENTIFIER = exports._CodeOrName = void 0;
	var _CodeOrName = class {};
	exports._CodeOrName = _CodeOrName;
	exports.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
	var Name = class extends _CodeOrName {
		constructor(s) {
			super();
			if (!exports.IDENTIFIER.test(s)) throw new Error("CodeGen: name must be a valid identifier");
			this.str = s;
		}
		toString() {
			return this.str;
		}
		emptyStr() {
			return false;
		}
		get names() {
			return { [this.str]: 1 };
		}
	};
	exports.Name = Name;
	var _Code = class extends _CodeOrName {
		constructor(code) {
			super();
			this._items = typeof code === "string" ? [code] : code;
		}
		toString() {
			return this.str;
		}
		emptyStr() {
			if (this._items.length > 1) return false;
			const item = this._items[0];
			return item === "" || item === "\"\"";
		}
		get str() {
			var _a;
			return (_a = this._str) !== null && _a !== void 0 ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
		}
		get names() {
			var _a;
			return (_a = this._names) !== null && _a !== void 0 ? _a : this._names = this._items.reduce((names, c) => {
				if (c instanceof Name) names[c.str] = (names[c.str] || 0) + 1;
				return names;
			}, {});
		}
	};
	exports._Code = _Code;
	exports.nil = new _Code("");
	function _(strs, ...args) {
		const code = [strs[0]];
		let i = 0;
		while (i < args.length) {
			addCodeArg(code, args[i]);
			code.push(strs[++i]);
		}
		return new _Code(code);
	}
	exports._ = _;
	const plus = new _Code("+");
	function str(strs, ...args) {
		const expr = [safeStringify(strs[0])];
		let i = 0;
		while (i < args.length) {
			expr.push(plus);
			addCodeArg(expr, args[i]);
			expr.push(plus, safeStringify(strs[++i]));
		}
		optimize(expr);
		return new _Code(expr);
	}
	exports.str = str;
	function addCodeArg(code, arg) {
		if (arg instanceof _Code) code.push(...arg._items);
		else if (arg instanceof Name) code.push(arg);
		else code.push(interpolate(arg));
	}
	exports.addCodeArg = addCodeArg;
	function optimize(expr) {
		let i = 1;
		while (i < expr.length - 1) {
			if (expr[i] === plus) {
				const res = mergeExprItems(expr[i - 1], expr[i + 1]);
				if (res !== void 0) {
					expr.splice(i - 1, 3, res);
					continue;
				}
				expr[i++] = "+";
			}
			i++;
		}
	}
	function mergeExprItems(a, b) {
		if (b === "\"\"") return a;
		if (a === "\"\"") return b;
		if (typeof a == "string") {
			if (b instanceof Name || a[a.length - 1] !== "\"") return;
			if (typeof b != "string") return `${a.slice(0, -1)}${b}"`;
			if (b[0] === "\"") return a.slice(0, -1) + b.slice(1);
			return;
		}
		if (typeof b == "string" && b[0] === "\"" && !(a instanceof Name)) return `"${a}${b.slice(1)}`;
	}
	function strConcat(c1, c2) {
		return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
	}
	exports.strConcat = strConcat;
	function interpolate(x) {
		return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
	}
	function stringify(x) {
		return new _Code(safeStringify(x));
	}
	exports.stringify = stringify;
	function safeStringify(x) {
		return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
	}
	exports.safeStringify = safeStringify;
	function getProperty(key) {
		return typeof key == "string" && exports.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
	}
	exports.getProperty = getProperty;
	function getEsmExportName(key) {
		if (typeof key == "string" && exports.IDENTIFIER.test(key)) return new _Code(`${key}`);
		throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
	}
	exports.getEsmExportName = getEsmExportName;
	function regexpCode(rx) {
		return new _Code(rx.toString());
	}
	exports.regexpCode = regexpCode;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.ValueScope = exports.ValueScopeName = exports.Scope = exports.varKinds = exports.UsedValueState = void 0;
	const code_1 = require_code$1();
	var ValueError = class extends Error {
		constructor(name) {
			super(`CodeGen: "code" for ${name} not defined`);
			this.value = name.value;
		}
	};
	var UsedValueState;
	(function(UsedValueState) {
		UsedValueState[UsedValueState["Started"] = 0] = "Started";
		UsedValueState[UsedValueState["Completed"] = 1] = "Completed";
	})(UsedValueState || (exports.UsedValueState = UsedValueState = {}));
	exports.varKinds = {
		const: new code_1.Name("const"),
		let: new code_1.Name("let"),
		var: new code_1.Name("var")
	};
	var Scope = class {
		constructor({ prefixes, parent } = {}) {
			this._names = {};
			this._prefixes = prefixes;
			this._parent = parent;
		}
		toName(nameOrPrefix) {
			return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
		}
		name(prefix) {
			return new code_1.Name(this._newName(prefix));
		}
		_newName(prefix) {
			const ng = this._names[prefix] || this._nameGroup(prefix);
			return `${prefix}${ng.index++}`;
		}
		_nameGroup(prefix) {
			var _a, _b;
			if (((_b = (_a = this._parent) === null || _a === void 0 ? void 0 : _a._prefixes) === null || _b === void 0 ? void 0 : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
			return this._names[prefix] = {
				prefix,
				index: 0
			};
		}
	};
	exports.Scope = Scope;
	var ValueScopeName = class extends code_1.Name {
		constructor(prefix, nameStr) {
			super(nameStr);
			this.prefix = prefix;
		}
		setValue(value, { property, itemIndex }) {
			this.value = value;
			this.scopePath = (0, code_1._)`.${new code_1.Name(property)}[${itemIndex}]`;
		}
	};
	exports.ValueScopeName = ValueScopeName;
	const line = (0, code_1._)`\n`;
	var ValueScope = class extends Scope {
		constructor(opts) {
			super(opts);
			this._values = {};
			this._scope = opts.scope;
			this.opts = {
				...opts,
				_n: opts.lines ? line : code_1.nil
			};
		}
		get() {
			return this._scope;
		}
		name(prefix) {
			return new ValueScopeName(prefix, this._newName(prefix));
		}
		value(nameOrPrefix, value) {
			var _a;
			if (value.ref === void 0) throw new Error("CodeGen: ref must be passed in value");
			const name = this.toName(nameOrPrefix);
			const { prefix } = name;
			const valueKey = (_a = value.key) !== null && _a !== void 0 ? _a : value.ref;
			let vs = this._values[prefix];
			if (vs) {
				const _name = vs.get(valueKey);
				if (_name) return _name;
			} else vs = this._values[prefix] = /* @__PURE__ */ new Map();
			vs.set(valueKey, name);
			const s = this._scope[prefix] || (this._scope[prefix] = []);
			const itemIndex = s.length;
			s[itemIndex] = value.ref;
			name.setValue(value, {
				property: prefix,
				itemIndex
			});
			return name;
		}
		getValue(prefix, keyOrRef) {
			const vs = this._values[prefix];
			if (!vs) return;
			return vs.get(keyOrRef);
		}
		scopeRefs(scopeName, values = this._values) {
			return this._reduceValues(values, (name) => {
				if (name.scopePath === void 0) throw new Error(`CodeGen: name "${name}" has no value`);
				return (0, code_1._)`${scopeName}${name.scopePath}`;
			});
		}
		scopeCode(values = this._values, usedValues, getCode) {
			return this._reduceValues(values, (name) => {
				if (name.value === void 0) throw new Error(`CodeGen: name "${name}" has no value`);
				return name.value.code;
			}, usedValues, getCode);
		}
		_reduceValues(values, valueCode, usedValues = {}, getCode) {
			let code = code_1.nil;
			for (const prefix in values) {
				const vs = values[prefix];
				if (!vs) continue;
				const nameSet = usedValues[prefix] = usedValues[prefix] || /* @__PURE__ */ new Map();
				vs.forEach((name) => {
					if (nameSet.has(name)) return;
					nameSet.set(name, UsedValueState.Started);
					let c = valueCode(name);
					if (c) {
						const def = this.opts.es5 ? exports.varKinds.var : exports.varKinds.const;
						code = (0, code_1._)`${code}${def} ${name} = ${c};${this.opts._n}`;
					} else if (c = getCode === null || getCode === void 0 ? void 0 : getCode(name)) code = (0, code_1._)`${code}${c}${this.opts._n}`;
					else throw new ValueError(name);
					nameSet.set(name, UsedValueState.Completed);
				});
			}
			return code;
		}
	};
	exports.ValueScope = ValueScope;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.or = exports.and = exports.not = exports.CodeGen = exports.operators = exports.varKinds = exports.ValueScopeName = exports.ValueScope = exports.Scope = exports.Name = exports.regexpCode = exports.stringify = exports.getProperty = exports.nil = exports.strConcat = exports.str = exports._ = void 0;
	const code_1 = require_code$1();
	const scope_1 = require_scope();
	var code_2 = require_code$1();
	Object.defineProperty(exports, "_", {
		enumerable: true,
		get: function() {
			return code_2._;
		}
	});
	Object.defineProperty(exports, "str", {
		enumerable: true,
		get: function() {
			return code_2.str;
		}
	});
	Object.defineProperty(exports, "strConcat", {
		enumerable: true,
		get: function() {
			return code_2.strConcat;
		}
	});
	Object.defineProperty(exports, "nil", {
		enumerable: true,
		get: function() {
			return code_2.nil;
		}
	});
	Object.defineProperty(exports, "getProperty", {
		enumerable: true,
		get: function() {
			return code_2.getProperty;
		}
	});
	Object.defineProperty(exports, "stringify", {
		enumerable: true,
		get: function() {
			return code_2.stringify;
		}
	});
	Object.defineProperty(exports, "regexpCode", {
		enumerable: true,
		get: function() {
			return code_2.regexpCode;
		}
	});
	Object.defineProperty(exports, "Name", {
		enumerable: true,
		get: function() {
			return code_2.Name;
		}
	});
	var scope_2 = require_scope();
	Object.defineProperty(exports, "Scope", {
		enumerable: true,
		get: function() {
			return scope_2.Scope;
		}
	});
	Object.defineProperty(exports, "ValueScope", {
		enumerable: true,
		get: function() {
			return scope_2.ValueScope;
		}
	});
	Object.defineProperty(exports, "ValueScopeName", {
		enumerable: true,
		get: function() {
			return scope_2.ValueScopeName;
		}
	});
	Object.defineProperty(exports, "varKinds", {
		enumerable: true,
		get: function() {
			return scope_2.varKinds;
		}
	});
	exports.operators = {
		GT: new code_1._Code(">"),
		GTE: new code_1._Code(">="),
		LT: new code_1._Code("<"),
		LTE: new code_1._Code("<="),
		EQ: new code_1._Code("==="),
		NEQ: new code_1._Code("!=="),
		NOT: new code_1._Code("!"),
		OR: new code_1._Code("||"),
		AND: new code_1._Code("&&"),
		ADD: new code_1._Code("+")
	};
	var Node = class {
		optimizeNodes() {
			return this;
		}
		optimizeNames(_names, _constants) {
			return this;
		}
	};
	var Def = class extends Node {
		constructor(varKind, name, rhs) {
			super();
			this.varKind = varKind;
			this.name = name;
			this.rhs = rhs;
		}
		render({ es5, _n }) {
			const varKind = es5 ? scope_1.varKinds.var : this.varKind;
			const rhs = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
			return `${varKind} ${this.name}${rhs};` + _n;
		}
		optimizeNames(names, constants) {
			if (!names[this.name.str]) return;
			if (this.rhs) this.rhs = optimizeExpr(this.rhs, names, constants);
			return this;
		}
		get names() {
			return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
		}
	};
	var Assign = class extends Node {
		constructor(lhs, rhs, sideEffects) {
			super();
			this.lhs = lhs;
			this.rhs = rhs;
			this.sideEffects = sideEffects;
		}
		render({ _n }) {
			return `${this.lhs} = ${this.rhs};` + _n;
		}
		optimizeNames(names, constants) {
			if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects) return;
			this.rhs = optimizeExpr(this.rhs, names, constants);
			return this;
		}
		get names() {
			return addExprNames(this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names }, this.rhs);
		}
	};
	var AssignOp = class extends Assign {
		constructor(lhs, op, rhs, sideEffects) {
			super(lhs, rhs, sideEffects);
			this.op = op;
		}
		render({ _n }) {
			return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
		}
	};
	var Label = class extends Node {
		constructor(label) {
			super();
			this.label = label;
			this.names = {};
		}
		render({ _n }) {
			return `${this.label}:` + _n;
		}
	};
	var Break = class extends Node {
		constructor(label) {
			super();
			this.label = label;
			this.names = {};
		}
		render({ _n }) {
			return `break${this.label ? ` ${this.label}` : ""};` + _n;
		}
	};
	var Throw = class extends Node {
		constructor(error) {
			super();
			this.error = error;
		}
		render({ _n }) {
			return `throw ${this.error};` + _n;
		}
		get names() {
			return this.error.names;
		}
	};
	var AnyCode = class extends Node {
		constructor(code) {
			super();
			this.code = code;
		}
		render({ _n }) {
			return `${this.code};` + _n;
		}
		optimizeNodes() {
			return `${this.code}` ? this : void 0;
		}
		optimizeNames(names, constants) {
			this.code = optimizeExpr(this.code, names, constants);
			return this;
		}
		get names() {
			return this.code instanceof code_1._CodeOrName ? this.code.names : {};
		}
	};
	var ParentNode = class extends Node {
		constructor(nodes = []) {
			super();
			this.nodes = nodes;
		}
		render(opts) {
			return this.nodes.reduce((code, n) => code + n.render(opts), "");
		}
		optimizeNodes() {
			const { nodes } = this;
			let i = nodes.length;
			while (i--) {
				const n = nodes[i].optimizeNodes();
				if (Array.isArray(n)) nodes.splice(i, 1, ...n);
				else if (n) nodes[i] = n;
				else nodes.splice(i, 1);
			}
			return nodes.length > 0 ? this : void 0;
		}
		optimizeNames(names, constants) {
			const { nodes } = this;
			let i = nodes.length;
			while (i--) {
				const n = nodes[i];
				if (n.optimizeNames(names, constants)) continue;
				subtractNames(names, n.names);
				nodes.splice(i, 1);
			}
			return nodes.length > 0 ? this : void 0;
		}
		get names() {
			return this.nodes.reduce((names, n) => addNames(names, n.names), {});
		}
	};
	var BlockNode = class extends ParentNode {
		render(opts) {
			return "{" + opts._n + super.render(opts) + "}" + opts._n;
		}
	};
	var Root = class extends ParentNode {};
	var Else = class extends BlockNode {};
	Else.kind = "else";
	var If = class If extends BlockNode {
		constructor(condition, nodes) {
			super(nodes);
			this.condition = condition;
		}
		render(opts) {
			let code = `if(${this.condition})` + super.render(opts);
			if (this.else) code += "else " + this.else.render(opts);
			return code;
		}
		optimizeNodes() {
			super.optimizeNodes();
			const cond = this.condition;
			if (cond === true) return this.nodes;
			let e = this.else;
			if (e) {
				const ns = e.optimizeNodes();
				e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
			}
			if (e) {
				if (cond === false) return e instanceof If ? e : e.nodes;
				if (this.nodes.length) return this;
				return new If(not(cond), e instanceof If ? [e] : e.nodes);
			}
			if (cond === false || !this.nodes.length) return void 0;
			return this;
		}
		optimizeNames(names, constants) {
			var _a;
			this.else = (_a = this.else) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants);
			if (!(super.optimizeNames(names, constants) || this.else)) return;
			this.condition = optimizeExpr(this.condition, names, constants);
			return this;
		}
		get names() {
			const names = super.names;
			addExprNames(names, this.condition);
			if (this.else) addNames(names, this.else.names);
			return names;
		}
	};
	If.kind = "if";
	var For = class extends BlockNode {};
	For.kind = "for";
	var ForLoop = class extends For {
		constructor(iteration) {
			super();
			this.iteration = iteration;
		}
		render(opts) {
			return `for(${this.iteration})` + super.render(opts);
		}
		optimizeNames(names, constants) {
			if (!super.optimizeNames(names, constants)) return;
			this.iteration = optimizeExpr(this.iteration, names, constants);
			return this;
		}
		get names() {
			return addNames(super.names, this.iteration.names);
		}
	};
	var ForRange = class extends For {
		constructor(varKind, name, from, to) {
			super();
			this.varKind = varKind;
			this.name = name;
			this.from = from;
			this.to = to;
		}
		render(opts) {
			const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
			const { name, from, to } = this;
			return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
		}
		get names() {
			return addExprNames(addExprNames(super.names, this.from), this.to);
		}
	};
	var ForIter = class extends For {
		constructor(loop, varKind, name, iterable) {
			super();
			this.loop = loop;
			this.varKind = varKind;
			this.name = name;
			this.iterable = iterable;
		}
		render(opts) {
			return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
		}
		optimizeNames(names, constants) {
			if (!super.optimizeNames(names, constants)) return;
			this.iterable = optimizeExpr(this.iterable, names, constants);
			return this;
		}
		get names() {
			return addNames(super.names, this.iterable.names);
		}
	};
	var Func = class extends BlockNode {
		constructor(name, args, async) {
			super();
			this.name = name;
			this.args = args;
			this.async = async;
		}
		render(opts) {
			return `${this.async ? "async " : ""}function ${this.name}(${this.args})` + super.render(opts);
		}
	};
	Func.kind = "func";
	var Return = class extends ParentNode {
		render(opts) {
			return "return " + super.render(opts);
		}
	};
	Return.kind = "return";
	var Try = class extends BlockNode {
		render(opts) {
			let code = "try" + super.render(opts);
			if (this.catch) code += this.catch.render(opts);
			if (this.finally) code += this.finally.render(opts);
			return code;
		}
		optimizeNodes() {
			var _a, _b;
			super.optimizeNodes();
			(_a = this.catch) === null || _a === void 0 || _a.optimizeNodes();
			(_b = this.finally) === null || _b === void 0 || _b.optimizeNodes();
			return this;
		}
		optimizeNames(names, constants) {
			var _a, _b;
			super.optimizeNames(names, constants);
			(_a = this.catch) === null || _a === void 0 || _a.optimizeNames(names, constants);
			(_b = this.finally) === null || _b === void 0 || _b.optimizeNames(names, constants);
			return this;
		}
		get names() {
			const names = super.names;
			if (this.catch) addNames(names, this.catch.names);
			if (this.finally) addNames(names, this.finally.names);
			return names;
		}
	};
	var Catch = class extends BlockNode {
		constructor(error) {
			super();
			this.error = error;
		}
		render(opts) {
			return `catch(${this.error})` + super.render(opts);
		}
	};
	Catch.kind = "catch";
	var Finally = class extends BlockNode {
		render(opts) {
			return "finally" + super.render(opts);
		}
	};
	Finally.kind = "finally";
	var CodeGen = class {
		constructor(extScope, opts = {}) {
			this._values = {};
			this._blockStarts = [];
			this._constants = {};
			this.opts = {
				...opts,
				_n: opts.lines ? "\n" : ""
			};
			this._extScope = extScope;
			this._scope = new scope_1.Scope({ parent: extScope });
			this._nodes = [new Root()];
		}
		toString() {
			return this._root.render(this.opts);
		}
		name(prefix) {
			return this._scope.name(prefix);
		}
		scopeName(prefix) {
			return this._extScope.name(prefix);
		}
		scopeValue(prefixOrName, value) {
			const name = this._extScope.value(prefixOrName, value);
			(this._values[name.prefix] || (this._values[name.prefix] = /* @__PURE__ */ new Set())).add(name);
			return name;
		}
		getScopeValue(prefix, keyOrRef) {
			return this._extScope.getValue(prefix, keyOrRef);
		}
		scopeRefs(scopeName) {
			return this._extScope.scopeRefs(scopeName, this._values);
		}
		scopeCode() {
			return this._extScope.scopeCode(this._values);
		}
		_def(varKind, nameOrPrefix, rhs, constant) {
			const name = this._scope.toName(nameOrPrefix);
			if (rhs !== void 0 && constant) this._constants[name.str] = rhs;
			this._leafNode(new Def(varKind, name, rhs));
			return name;
		}
		const(nameOrPrefix, rhs, _constant) {
			return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
		}
		let(nameOrPrefix, rhs, _constant) {
			return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
		}
		var(nameOrPrefix, rhs, _constant) {
			return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
		}
		assign(lhs, rhs, sideEffects) {
			return this._leafNode(new Assign(lhs, rhs, sideEffects));
		}
		add(lhs, rhs) {
			return this._leafNode(new AssignOp(lhs, exports.operators.ADD, rhs));
		}
		code(c) {
			if (typeof c == "function") c();
			else if (c !== code_1.nil) this._leafNode(new AnyCode(c));
			return this;
		}
		object(...keyValues) {
			const code = ["{"];
			for (const [key, value] of keyValues) {
				if (code.length > 1) code.push(",");
				code.push(key);
				if (key !== value || this.opts.es5) {
					code.push(":");
					(0, code_1.addCodeArg)(code, value);
				}
			}
			code.push("}");
			return new code_1._Code(code);
		}
		if(condition, thenBody, elseBody) {
			this._blockNode(new If(condition));
			if (thenBody && elseBody) this.code(thenBody).else().code(elseBody).endIf();
			else if (thenBody) this.code(thenBody).endIf();
			else if (elseBody) throw new Error("CodeGen: \"else\" body without \"then\" body");
			return this;
		}
		elseIf(condition) {
			return this._elseNode(new If(condition));
		}
		else() {
			return this._elseNode(new Else());
		}
		endIf() {
			return this._endBlockNode(If, Else);
		}
		_for(node, forBody) {
			this._blockNode(node);
			if (forBody) this.code(forBody).endFor();
			return this;
		}
		for(iteration, forBody) {
			return this._for(new ForLoop(iteration), forBody);
		}
		forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
			const name = this._scope.toName(nameOrPrefix);
			return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
		}
		forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
			const name = this._scope.toName(nameOrPrefix);
			if (this.opts.es5) {
				const arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
				return this.forRange("_i", 0, (0, code_1._)`${arr}.length`, (i) => {
					this.var(name, (0, code_1._)`${arr}[${i}]`);
					forBody(name);
				});
			}
			return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
		}
		forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
			if (this.opts.ownProperties) return this.forOf(nameOrPrefix, (0, code_1._)`Object.keys(${obj})`, forBody);
			const name = this._scope.toName(nameOrPrefix);
			return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
		}
		endFor() {
			return this._endBlockNode(For);
		}
		label(label) {
			return this._leafNode(new Label(label));
		}
		break(label) {
			return this._leafNode(new Break(label));
		}
		return(value) {
			const node = new Return();
			this._blockNode(node);
			this.code(value);
			if (node.nodes.length !== 1) throw new Error("CodeGen: \"return\" should have one node");
			return this._endBlockNode(Return);
		}
		try(tryBody, catchCode, finallyCode) {
			if (!catchCode && !finallyCode) throw new Error("CodeGen: \"try\" without \"catch\" and \"finally\"");
			const node = new Try();
			this._blockNode(node);
			this.code(tryBody);
			if (catchCode) {
				const error = this.name("e");
				this._currNode = node.catch = new Catch(error);
				catchCode(error);
			}
			if (finallyCode) {
				this._currNode = node.finally = new Finally();
				this.code(finallyCode);
			}
			return this._endBlockNode(Catch, Finally);
		}
		throw(error) {
			return this._leafNode(new Throw(error));
		}
		block(body, nodeCount) {
			this._blockStarts.push(this._nodes.length);
			if (body) this.code(body).endBlock(nodeCount);
			return this;
		}
		endBlock(nodeCount) {
			const len = this._blockStarts.pop();
			if (len === void 0) throw new Error("CodeGen: not in self-balancing block");
			const toClose = this._nodes.length - len;
			if (toClose < 0 || nodeCount !== void 0 && toClose !== nodeCount) throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
			this._nodes.length = len;
			return this;
		}
		func(name, args = code_1.nil, async, funcBody) {
			this._blockNode(new Func(name, args, async));
			if (funcBody) this.code(funcBody).endFunc();
			return this;
		}
		endFunc() {
			return this._endBlockNode(Func);
		}
		optimize(n = 1) {
			while (n-- > 0) {
				this._root.optimizeNodes();
				this._root.optimizeNames(this._root.names, this._constants);
			}
		}
		_leafNode(node) {
			this._currNode.nodes.push(node);
			return this;
		}
		_blockNode(node) {
			this._currNode.nodes.push(node);
			this._nodes.push(node);
		}
		_endBlockNode(N1, N2) {
			const n = this._currNode;
			if (n instanceof N1 || N2 && n instanceof N2) {
				this._nodes.pop();
				return this;
			}
			throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
		}
		_elseNode(node) {
			const n = this._currNode;
			if (!(n instanceof If)) throw new Error("CodeGen: \"else\" without \"if\"");
			this._currNode = n.else = node;
			return this;
		}
		get _root() {
			return this._nodes[0];
		}
		get _currNode() {
			const ns = this._nodes;
			return ns[ns.length - 1];
		}
		set _currNode(node) {
			const ns = this._nodes;
			ns[ns.length - 1] = node;
		}
	};
	exports.CodeGen = CodeGen;
	function addNames(names, from) {
		for (const n in from) names[n] = (names[n] || 0) + (from[n] || 0);
		return names;
	}
	function addExprNames(names, from) {
		return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
	}
	function optimizeExpr(expr, names, constants) {
		if (expr instanceof code_1.Name) return replaceName(expr);
		if (!canOptimize(expr)) return expr;
		return new code_1._Code(expr._items.reduce((items, c) => {
			if (c instanceof code_1.Name) c = replaceName(c);
			if (c instanceof code_1._Code) items.push(...c._items);
			else items.push(c);
			return items;
		}, []));
		function replaceName(n) {
			const c = constants[n.str];
			if (c === void 0 || names[n.str] !== 1) return n;
			delete names[n.str];
			return c;
		}
		function canOptimize(e) {
			return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants[c.str] !== void 0);
		}
	}
	function subtractNames(names, from) {
		for (const n in from) names[n] = (names[n] || 0) - (from[n] || 0);
	}
	function not(x) {
		return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._)`!${par(x)}`;
	}
	exports.not = not;
	const andCode = mappend(exports.operators.AND);
	function and(...args) {
		return args.reduce(andCode);
	}
	exports.and = and;
	const orCode = mappend(exports.operators.OR);
	function or(...args) {
		return args.reduce(orCode);
	}
	exports.or = or;
	function mappend(op) {
		return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._)`${par(x)} ${op} ${par(y)}`;
	}
	function par(x) {
		return x instanceof code_1.Name ? x : (0, code_1._)`(${x})`;
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/util.js
var require_util = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.checkStrictMode = exports.getErrorPath = exports.Type = exports.useFunc = exports.setEvaluated = exports.evaluatedPropsToName = exports.mergeEvaluated = exports.eachItem = exports.unescapeJsonPointer = exports.escapeJsonPointer = exports.escapeFragment = exports.unescapeFragment = exports.schemaRefOrVal = exports.schemaHasRulesButRef = exports.schemaHasRules = exports.checkUnknownRules = exports.alwaysValidSchema = exports.toHash = void 0;
	const codegen_1 = require_codegen();
	const code_1 = require_code$1();
	function toHash(arr) {
		const hash = {};
		for (const item of arr) hash[item] = true;
		return hash;
	}
	exports.toHash = toHash;
	function alwaysValidSchema(it, schema) {
		if (typeof schema == "boolean") return schema;
		if (Object.keys(schema).length === 0) return true;
		checkUnknownRules(it, schema);
		return !schemaHasRules(schema, it.self.RULES.all);
	}
	exports.alwaysValidSchema = alwaysValidSchema;
	function checkUnknownRules(it, schema = it.schema) {
		const { opts, self } = it;
		if (!opts.strictSchema) return;
		if (typeof schema === "boolean") return;
		const rules = self.RULES.keywords;
		for (const key in schema) if (!rules[key]) checkStrictMode(it, `unknown keyword: "${key}"`);
	}
	exports.checkUnknownRules = checkUnknownRules;
	function schemaHasRules(schema, rules) {
		if (typeof schema == "boolean") return !schema;
		for (const key in schema) if (rules[key]) return true;
		return false;
	}
	exports.schemaHasRules = schemaHasRules;
	function schemaHasRulesButRef(schema, RULES) {
		if (typeof schema == "boolean") return !schema;
		for (const key in schema) if (key !== "$ref" && RULES.all[key]) return true;
		return false;
	}
	exports.schemaHasRulesButRef = schemaHasRulesButRef;
	function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
		if (!$data) {
			if (typeof schema == "number" || typeof schema == "boolean") return schema;
			if (typeof schema == "string") return (0, codegen_1._)`${schema}`;
		}
		return (0, codegen_1._)`${topSchemaRef}${schemaPath}${(0, codegen_1.getProperty)(keyword)}`;
	}
	exports.schemaRefOrVal = schemaRefOrVal;
	function unescapeFragment(str) {
		return unescapeJsonPointer(decodeURIComponent(str));
	}
	exports.unescapeFragment = unescapeFragment;
	function escapeFragment(str) {
		return encodeURIComponent(escapeJsonPointer(str));
	}
	exports.escapeFragment = escapeFragment;
	function escapeJsonPointer(str) {
		if (typeof str == "number") return `${str}`;
		return str.replace(/~/g, "~0").replace(/\//g, "~1");
	}
	exports.escapeJsonPointer = escapeJsonPointer;
	function unescapeJsonPointer(str) {
		return str.replace(/~1/g, "/").replace(/~0/g, "~");
	}
	exports.unescapeJsonPointer = unescapeJsonPointer;
	function eachItem(xs, f) {
		if (Array.isArray(xs)) for (const x of xs) f(x);
		else f(xs);
	}
	exports.eachItem = eachItem;
	function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName }) {
		return (gen, from, to, toName) => {
			const res = to === void 0 ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues(from, to);
			return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
		};
	}
	exports.mergeEvaluated = {
		props: makeMergeEvaluated({
			mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => {
				gen.if((0, codegen_1._)`${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1._)`${to} || {}`).code((0, codegen_1._)`Object.assign(${to}, ${from})`));
			}),
			mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => {
				if (from === true) gen.assign(to, true);
				else {
					gen.assign(to, (0, codegen_1._)`${to} || {}`);
					setEvaluated(gen, to, from);
				}
			}),
			mergeValues: (from, to) => from === true ? true : {
				...from,
				...to
			},
			resultToName: evaluatedPropsToName
		}),
		items: makeMergeEvaluated({
			mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1._)`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
			mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1._)`${to} > ${from} ? ${to} : ${from}`)),
			mergeValues: (from, to) => from === true ? true : Math.max(from, to),
			resultToName: (gen, items) => gen.var("items", items)
		})
	};
	function evaluatedPropsToName(gen, ps) {
		if (ps === true) return gen.var("props", true);
		const props = gen.var("props", (0, codegen_1._)`{}`);
		if (ps !== void 0) setEvaluated(gen, props, ps);
		return props;
	}
	exports.evaluatedPropsToName = evaluatedPropsToName;
	function setEvaluated(gen, props, ps) {
		Object.keys(ps).forEach((p) => gen.assign((0, codegen_1._)`${props}${(0, codegen_1.getProperty)(p)}`, true));
	}
	exports.setEvaluated = setEvaluated;
	const snippets = {};
	function useFunc(gen, f) {
		return gen.scopeValue("func", {
			ref: f,
			code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
		});
	}
	exports.useFunc = useFunc;
	var Type;
	(function(Type) {
		Type[Type["Num"] = 0] = "Num";
		Type[Type["Str"] = 1] = "Str";
	})(Type || (exports.Type = Type = {}));
	function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
		if (dataProp instanceof codegen_1.Name) {
			const isNumber = dataPropType === Type.Num;
			return jsPropertySyntax ? isNumber ? (0, codegen_1._)`"[" + ${dataProp} + "]"` : (0, codegen_1._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1._)`"/" + ${dataProp}` : (0, codegen_1._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
		}
		return jsPropertySyntax ? (0, codegen_1.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
	}
	exports.getErrorPath = getErrorPath;
	function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
		if (!mode) return;
		msg = `strict mode: ${msg}`;
		if (mode === true) throw new Error(msg);
		it.self.logger.warn(msg);
	}
	exports.checkStrictMode = checkStrictMode;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/names.js
var require_names = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	exports.default = {
		data: new codegen_1.Name("data"),
		valCxt: new codegen_1.Name("valCxt"),
		instancePath: new codegen_1.Name("instancePath"),
		parentData: new codegen_1.Name("parentData"),
		parentDataProperty: new codegen_1.Name("parentDataProperty"),
		rootData: new codegen_1.Name("rootData"),
		dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
		vErrors: new codegen_1.Name("vErrors"),
		errors: new codegen_1.Name("errors"),
		this: new codegen_1.Name("this"),
		self: new codegen_1.Name("self"),
		scope: new codegen_1.Name("scope"),
		json: new codegen_1.Name("json"),
		jsonPos: new codegen_1.Name("jsonPos"),
		jsonLen: new codegen_1.Name("jsonLen"),
		jsonPart: new codegen_1.Name("jsonPart")
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/errors.js
var require_errors = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.extendErrors = exports.resetErrorsCount = exports.reportExtraError = exports.reportError = exports.keyword$DataError = exports.keywordError = void 0;
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const names_1 = require_names();
	exports.keywordError = { message: ({ keyword }) => (0, codegen_1.str)`must pass "${keyword}" keyword validation` };
	exports.keyword$DataError = { message: ({ keyword, schemaType }) => schemaType ? (0, codegen_1.str)`"${keyword}" keyword must be ${schemaType} ($data)` : (0, codegen_1.str)`"${keyword}" keyword is invalid ($data)` };
	function reportError(cxt, error = exports.keywordError, errorPaths, overrideAllErrors) {
		const { it } = cxt;
		const { gen, compositeRule, allErrors } = it;
		const errObj = errorObjectCode(cxt, error, errorPaths);
		if (overrideAllErrors !== null && overrideAllErrors !== void 0 ? overrideAllErrors : compositeRule || allErrors) addError(gen, errObj);
		else returnErrors(it, (0, codegen_1._)`[${errObj}]`);
	}
	exports.reportError = reportError;
	function reportExtraError(cxt, error = exports.keywordError, errorPaths) {
		const { it } = cxt;
		const { gen, compositeRule, allErrors } = it;
		addError(gen, errorObjectCode(cxt, error, errorPaths));
		if (!(compositeRule || allErrors)) returnErrors(it, names_1.default.vErrors);
	}
	exports.reportExtraError = reportExtraError;
	function resetErrorsCount(gen, errsCount) {
		gen.assign(names_1.default.errors, errsCount);
		gen.if((0, codegen_1._)`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._)`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
	}
	exports.resetErrorsCount = resetErrorsCount;
	function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
		/* istanbul ignore if */
		if (errsCount === void 0) throw new Error("ajv implementation error");
		const err = gen.name("err");
		gen.forRange("i", errsCount, names_1.default.errors, (i) => {
			gen.const(err, (0, codegen_1._)`${names_1.default.vErrors}[${i}]`);
			gen.if((0, codegen_1._)`${err}.instancePath === undefined`, () => gen.assign((0, codegen_1._)`${err}.instancePath`, (0, codegen_1.strConcat)(names_1.default.instancePath, it.errorPath)));
			gen.assign((0, codegen_1._)`${err}.schemaPath`, (0, codegen_1.str)`${it.errSchemaPath}/${keyword}`);
			if (it.opts.verbose) {
				gen.assign((0, codegen_1._)`${err}.schema`, schemaValue);
				gen.assign((0, codegen_1._)`${err}.data`, data);
			}
		});
	}
	exports.extendErrors = extendErrors;
	function addError(gen, errObj) {
		const err = gen.const("err", errObj);
		gen.if((0, codegen_1._)`${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, (0, codegen_1._)`[${err}]`), (0, codegen_1._)`${names_1.default.vErrors}.push(${err})`);
		gen.code((0, codegen_1._)`${names_1.default.errors}++`);
	}
	function returnErrors(it, errs) {
		const { gen, validateName, schemaEnv } = it;
		if (schemaEnv.$async) gen.throw((0, codegen_1._)`new ${it.ValidationError}(${errs})`);
		else {
			gen.assign((0, codegen_1._)`${validateName}.errors`, errs);
			gen.return(false);
		}
	}
	const E = {
		keyword: new codegen_1.Name("keyword"),
		schemaPath: new codegen_1.Name("schemaPath"),
		params: new codegen_1.Name("params"),
		propertyName: new codegen_1.Name("propertyName"),
		message: new codegen_1.Name("message"),
		schema: new codegen_1.Name("schema"),
		parentSchema: new codegen_1.Name("parentSchema")
	};
	function errorObjectCode(cxt, error, errorPaths) {
		const { createErrors } = cxt.it;
		if (createErrors === false) return (0, codegen_1._)`{}`;
		return errorObject(cxt, error, errorPaths);
	}
	function errorObject(cxt, error, errorPaths = {}) {
		const { gen, it } = cxt;
		const keyValues = [errorInstancePath(it, errorPaths), errorSchemaPath(cxt, errorPaths)];
		extraErrorProps(cxt, error, keyValues);
		return gen.object(...keyValues);
	}
	function errorInstancePath({ errorPath }, { instancePath }) {
		const instPath = instancePath ? (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(instancePath, util_1.Type.Str)}` : errorPath;
		return [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, instPath)];
	}
	function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
		let schPath = parentSchema ? errSchemaPath : (0, codegen_1.str)`${errSchemaPath}/${keyword}`;
		if (schemaPath) schPath = (0, codegen_1.str)`${schPath}${(0, util_1.getErrorPath)(schemaPath, util_1.Type.Str)}`;
		return [E.schemaPath, schPath];
	}
	function extraErrorProps(cxt, { params, message }, keyValues) {
		const { keyword, data, schemaValue, it } = cxt;
		const { opts, propertyName, topSchemaRef, schemaPath } = it;
		keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || (0, codegen_1._)`{}`]);
		if (opts.messages) keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
		if (opts.verbose) keyValues.push([E.schema, schemaValue], [E.parentSchema, (0, codegen_1._)`${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
		if (propertyName) keyValues.push([E.propertyName, propertyName]);
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.boolOrEmptySchema = exports.topBoolOrEmptySchema = void 0;
	const errors_1 = require_errors();
	const codegen_1 = require_codegen();
	const names_1 = require_names();
	const boolError = { message: "boolean schema is false" };
	function topBoolOrEmptySchema(it) {
		const { gen, schema, validateName } = it;
		if (schema === false) falseSchemaError(it, false);
		else if (typeof schema == "object" && schema.$async === true) gen.return(names_1.default.data);
		else {
			gen.assign((0, codegen_1._)`${validateName}.errors`, null);
			gen.return(true);
		}
	}
	exports.topBoolOrEmptySchema = topBoolOrEmptySchema;
	function boolOrEmptySchema(it, valid) {
		const { gen, schema } = it;
		if (schema === false) {
			gen.var(valid, false);
			falseSchemaError(it);
		} else gen.var(valid, true);
	}
	exports.boolOrEmptySchema = boolOrEmptySchema;
	function falseSchemaError(it, overrideAllErrors) {
		const { gen, data } = it;
		const cxt = {
			gen,
			keyword: "false schema",
			data,
			schema: false,
			schemaCode: false,
			schemaValue: false,
			params: {},
			it
		};
		(0, errors_1.reportError)(cxt, boolError, void 0, overrideAllErrors);
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/rules.js
var require_rules = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.getRules = exports.isJSONType = void 0;
	const jsonTypes = new Set([
		"string",
		"number",
		"integer",
		"boolean",
		"null",
		"object",
		"array"
	]);
	function isJSONType(x) {
		return typeof x == "string" && jsonTypes.has(x);
	}
	exports.isJSONType = isJSONType;
	function getRules() {
		const groups = {
			number: {
				type: "number",
				rules: []
			},
			string: {
				type: "string",
				rules: []
			},
			array: {
				type: "array",
				rules: []
			},
			object: {
				type: "object",
				rules: []
			}
		};
		return {
			types: {
				...groups,
				integer: true,
				boolean: true,
				null: true
			},
			rules: [
				{ rules: [] },
				groups.number,
				groups.string,
				groups.array,
				groups.object
			],
			post: { rules: [] },
			all: {},
			keywords: {}
		};
	}
	exports.getRules = getRules;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.shouldUseRule = exports.shouldUseGroup = exports.schemaHasRulesForType = void 0;
	function schemaHasRulesForType({ schema, self }, type) {
		const group = self.RULES.types[type];
		return group && group !== true && shouldUseGroup(schema, group);
	}
	exports.schemaHasRulesForType = schemaHasRulesForType;
	function shouldUseGroup(schema, group) {
		return group.rules.some((rule) => shouldUseRule(schema, rule));
	}
	exports.shouldUseGroup = shouldUseGroup;
	function shouldUseRule(schema, rule) {
		var _a;
		return schema[rule.keyword] !== void 0 || ((_a = rule.definition.implements) === null || _a === void 0 ? void 0 : _a.some((kwd) => schema[kwd] !== void 0));
	}
	exports.shouldUseRule = shouldUseRule;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.reportTypeError = exports.checkDataTypes = exports.checkDataType = exports.coerceAndCheckDataType = exports.getJSONTypes = exports.getSchemaTypes = exports.DataType = void 0;
	const rules_1 = require_rules();
	const applicability_1 = require_applicability();
	const errors_1 = require_errors();
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	var DataType;
	(function(DataType) {
		DataType[DataType["Correct"] = 0] = "Correct";
		DataType[DataType["Wrong"] = 1] = "Wrong";
	})(DataType || (exports.DataType = DataType = {}));
	function getSchemaTypes(schema) {
		const types = getJSONTypes(schema.type);
		if (types.includes("null")) {
			if (schema.nullable === false) throw new Error("type: null contradicts nullable: false");
		} else {
			if (!types.length && schema.nullable !== void 0) throw new Error("\"nullable\" cannot be used without \"type\"");
			if (schema.nullable === true) types.push("null");
		}
		return types;
	}
	exports.getSchemaTypes = getSchemaTypes;
	function getJSONTypes(ts) {
		const types = Array.isArray(ts) ? ts : ts ? [ts] : [];
		if (types.every(rules_1.isJSONType)) return types;
		throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
	}
	exports.getJSONTypes = getJSONTypes;
	function coerceAndCheckDataType(it, types) {
		const { gen, data, opts } = it;
		const coerceTo = coerceToTypes(types, opts.coerceTypes);
		const checkTypes = types.length > 0 && !(coerceTo.length === 0 && types.length === 1 && (0, applicability_1.schemaHasRulesForType)(it, types[0]));
		if (checkTypes) {
			const wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
			gen.if(wrongType, () => {
				if (coerceTo.length) coerceData(it, types, coerceTo);
				else reportTypeError(it);
			});
		}
		return checkTypes;
	}
	exports.coerceAndCheckDataType = coerceAndCheckDataType;
	const COERCIBLE = new Set([
		"string",
		"number",
		"integer",
		"boolean",
		"null"
	]);
	function coerceToTypes(types, coerceTypes) {
		return coerceTypes ? types.filter((t) => COERCIBLE.has(t) || coerceTypes === "array" && t === "array") : [];
	}
	function coerceData(it, types, coerceTo) {
		const { gen, data, opts } = it;
		const dataType = gen.let("dataType", (0, codegen_1._)`typeof ${data}`);
		const coerced = gen.let("coerced", (0, codegen_1._)`undefined`);
		if (opts.coerceTypes === "array") gen.if((0, codegen_1._)`${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, (0, codegen_1._)`${data}[0]`).assign(dataType, (0, codegen_1._)`typeof ${data}`).if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
		gen.if((0, codegen_1._)`${coerced} !== undefined`);
		for (const t of coerceTo) if (COERCIBLE.has(t) || t === "array" && opts.coerceTypes === "array") coerceSpecificType(t);
		gen.else();
		reportTypeError(it);
		gen.endIf();
		gen.if((0, codegen_1._)`${coerced} !== undefined`, () => {
			gen.assign(data, coerced);
			assignParentData(it, coerced);
		});
		function coerceSpecificType(t) {
			switch (t) {
				case "string":
					gen.elseIf((0, codegen_1._)`${dataType} == "number" || ${dataType} == "boolean"`).assign(coerced, (0, codegen_1._)`"" + ${data}`).elseIf((0, codegen_1._)`${data} === null`).assign(coerced, (0, codegen_1._)`""`);
					return;
				case "number":
					gen.elseIf((0, codegen_1._)`${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`).assign(coerced, (0, codegen_1._)`+${data}`);
					return;
				case "integer":
					gen.elseIf((0, codegen_1._)`${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, (0, codegen_1._)`+${data}`);
					return;
				case "boolean":
					gen.elseIf((0, codegen_1._)`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, false).elseIf((0, codegen_1._)`${data} === "true" || ${data} === 1`).assign(coerced, true);
					return;
				case "null":
					gen.elseIf((0, codegen_1._)`${data} === "" || ${data} === 0 || ${data} === false`);
					gen.assign(coerced, null);
					return;
				case "array": gen.elseIf((0, codegen_1._)`${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`).assign(coerced, (0, codegen_1._)`[${data}]`);
			}
		}
	}
	function assignParentData({ gen, parentData, parentDataProperty }, expr) {
		gen.if((0, codegen_1._)`${parentData} !== undefined`, () => gen.assign((0, codegen_1._)`${parentData}[${parentDataProperty}]`, expr));
	}
	function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
		const EQ = correct === DataType.Correct ? codegen_1.operators.EQ : codegen_1.operators.NEQ;
		let cond;
		switch (dataType) {
			case "null": return (0, codegen_1._)`${data} ${EQ} null`;
			case "array":
				cond = (0, codegen_1._)`Array.isArray(${data})`;
				break;
			case "object":
				cond = (0, codegen_1._)`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
				break;
			case "integer":
				cond = numCond((0, codegen_1._)`!(${data} % 1) && !isNaN(${data})`);
				break;
			case "number":
				cond = numCond();
				break;
			default: return (0, codegen_1._)`typeof ${data} ${EQ} ${dataType}`;
		}
		return correct === DataType.Correct ? cond : (0, codegen_1.not)(cond);
		function numCond(_cond = codegen_1.nil) {
			return (0, codegen_1.and)((0, codegen_1._)`typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1._)`isFinite(${data})` : codegen_1.nil);
		}
	}
	exports.checkDataType = checkDataType;
	function checkDataTypes(dataTypes, data, strictNums, correct) {
		if (dataTypes.length === 1) return checkDataType(dataTypes[0], data, strictNums, correct);
		let cond;
		const types = (0, util_1.toHash)(dataTypes);
		if (types.array && types.object) {
			const notObj = (0, codegen_1._)`typeof ${data} != "object"`;
			cond = types.null ? notObj : (0, codegen_1._)`!${data} || ${notObj}`;
			delete types.null;
			delete types.array;
			delete types.object;
		} else cond = codegen_1.nil;
		if (types.number) delete types.integer;
		for (const t in types) cond = (0, codegen_1.and)(cond, checkDataType(t, data, strictNums, correct));
		return cond;
	}
	exports.checkDataTypes = checkDataTypes;
	const typeError = {
		message: ({ schema }) => `must be ${schema}`,
		params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1._)`{type: ${schema}}` : (0, codegen_1._)`{type: ${schemaValue}}`
	};
	function reportTypeError(it) {
		const cxt = getTypeErrorContext(it);
		(0, errors_1.reportError)(cxt, typeError);
	}
	exports.reportTypeError = reportTypeError;
	function getTypeErrorContext(it) {
		const { gen, data, schema } = it;
		const schemaCode = (0, util_1.schemaRefOrVal)(it, schema, "type");
		return {
			gen,
			keyword: "type",
			data,
			schema: schema.type,
			schemaCode,
			schemaValue: schemaCode,
			parentSchema: schema,
			params: {},
			it
		};
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.assignDefaults = void 0;
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	function assignDefaults(it, ty) {
		const { properties, items } = it.schema;
		if (ty === "object" && properties) for (const key in properties) assignDefault(it, key, properties[key].default);
		else if (ty === "array" && Array.isArray(items)) items.forEach((sch, i) => assignDefault(it, i, sch.default));
	}
	exports.assignDefaults = assignDefaults;
	function assignDefault(it, prop, defaultValue) {
		const { gen, compositeRule, data, opts } = it;
		if (defaultValue === void 0) return;
		const childData = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(prop)}`;
		if (compositeRule) {
			(0, util_1.checkStrictMode)(it, `default is ignored for: ${childData}`);
			return;
		}
		let condition = (0, codegen_1._)`${childData} === undefined`;
		if (opts.useDefaults === "empty") condition = (0, codegen_1._)`${condition} || ${childData} === null || ${childData} === ""`;
		gen.if(condition, (0, codegen_1._)`${childData} = ${(0, codegen_1.stringify)(defaultValue)}`);
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/code.js
var require_code = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.validateUnion = exports.validateArray = exports.usePattern = exports.callValidateCode = exports.schemaProperties = exports.allSchemaProperties = exports.noPropertyInData = exports.propertyInData = exports.isOwnProperty = exports.hasPropFunc = exports.reportMissingProp = exports.checkMissingProp = exports.checkReportMissingProp = void 0;
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const names_1 = require_names();
	const util_2 = require_util();
	function checkReportMissingProp(cxt, prop) {
		const { gen, data, it } = cxt;
		gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
			cxt.setParams({ missingProperty: (0, codegen_1._)`${prop}` }, true);
			cxt.error();
		});
	}
	exports.checkReportMissingProp = checkReportMissingProp;
	function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
		return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._)`${missing} = ${prop}`)));
	}
	exports.checkMissingProp = checkMissingProp;
	function reportMissingProp(cxt, missing) {
		cxt.setParams({ missingProperty: missing }, true);
		cxt.error();
	}
	exports.reportMissingProp = reportMissingProp;
	function hasPropFunc(gen) {
		return gen.scopeValue("func", {
			ref: Object.prototype.hasOwnProperty,
			code: (0, codegen_1._)`Object.prototype.hasOwnProperty`
		});
	}
	exports.hasPropFunc = hasPropFunc;
	function isOwnProperty(gen, data, property) {
		return (0, codegen_1._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
	}
	exports.isOwnProperty = isOwnProperty;
	function propertyInData(gen, data, property, ownProperties) {
		const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
		return ownProperties ? (0, codegen_1._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
	}
	exports.propertyInData = propertyInData;
	function noPropertyInData(gen, data, property, ownProperties) {
		const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} === undefined`;
		return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
	}
	exports.noPropertyInData = noPropertyInData;
	function allSchemaProperties(schemaMap) {
		return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
	}
	exports.allSchemaProperties = allSchemaProperties;
	function schemaProperties(it, schemaMap) {
		return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
	}
	exports.schemaProperties = schemaProperties;
	function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
		const dataAndSchema = passSchema ? (0, codegen_1._)`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
		const valCxt = [
			[names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, errorPath)],
			[names_1.default.parentData, it.parentData],
			[names_1.default.parentDataProperty, it.parentDataProperty],
			[names_1.default.rootData, names_1.default.rootData]
		];
		if (it.opts.dynamicRef) valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
		const args = (0, codegen_1._)`${dataAndSchema}, ${gen.object(...valCxt)}`;
		return context !== codegen_1.nil ? (0, codegen_1._)`${func}.call(${context}, ${args})` : (0, codegen_1._)`${func}(${args})`;
	}
	exports.callValidateCode = callValidateCode;
	const newRegExp = (0, codegen_1._)`new RegExp`;
	function usePattern({ gen, it: { opts } }, pattern) {
		const u = opts.unicodeRegExp ? "u" : "";
		const { regExp } = opts.code;
		const rx = regExp(pattern, u);
		return gen.scopeValue("pattern", {
			key: rx.toString(),
			ref: rx,
			code: (0, codegen_1._)`${regExp.code === "new RegExp" ? newRegExp : (0, util_2.useFunc)(gen, regExp)}(${pattern}, ${u})`
		});
	}
	exports.usePattern = usePattern;
	function validateArray(cxt) {
		const { gen, data, keyword, it } = cxt;
		const valid = gen.name("valid");
		if (it.allErrors) {
			const validArr = gen.let("valid", true);
			validateItems(() => gen.assign(validArr, false));
			return validArr;
		}
		gen.var(valid, true);
		validateItems(() => gen.break());
		return valid;
		function validateItems(notValid) {
			const len = gen.const("len", (0, codegen_1._)`${data}.length`);
			gen.forRange("i", 0, len, (i) => {
				cxt.subschema({
					keyword,
					dataProp: i,
					dataPropType: util_1.Type.Num
				}, valid);
				gen.if((0, codegen_1.not)(valid), notValid);
			});
		}
	}
	exports.validateArray = validateArray;
	function validateUnion(cxt) {
		const { gen, schema, keyword, it } = cxt;
		/* istanbul ignore if */
		if (!Array.isArray(schema)) throw new Error("ajv implementation error");
		if (schema.some((sch) => (0, util_1.alwaysValidSchema)(it, sch)) && !it.opts.unevaluated) return;
		const valid = gen.let("valid", false);
		const schValid = gen.name("_valid");
		gen.block(() => schema.forEach((_sch, i) => {
			const schCxt = cxt.subschema({
				keyword,
				schemaProp: i,
				compositeRule: true
			}, schValid);
			gen.assign(valid, (0, codegen_1._)`${valid} || ${schValid}`);
			if (!cxt.mergeValidEvaluated(schCxt, schValid)) gen.if((0, codegen_1.not)(valid));
		}));
		cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
	}
	exports.validateUnion = validateUnion;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.validateKeywordUsage = exports.validSchemaType = exports.funcKeywordCode = exports.macroKeywordCode = void 0;
	const codegen_1 = require_codegen();
	const names_1 = require_names();
	const code_1 = require_code();
	const errors_1 = require_errors();
	function macroKeywordCode(cxt, def) {
		const { gen, keyword, schema, parentSchema, it } = cxt;
		const macroSchema = def.macro.call(it.self, schema, parentSchema, it);
		const schemaRef = useKeyword(gen, keyword, macroSchema);
		if (it.opts.validateSchema !== false) it.self.validateSchema(macroSchema, true);
		const valid = gen.name("valid");
		cxt.subschema({
			schema: macroSchema,
			schemaPath: codegen_1.nil,
			errSchemaPath: `${it.errSchemaPath}/${keyword}`,
			topSchemaRef: schemaRef,
			compositeRule: true
		}, valid);
		cxt.pass(valid, () => cxt.error(true));
	}
	exports.macroKeywordCode = macroKeywordCode;
	function funcKeywordCode(cxt, def) {
		var _a;
		const { gen, keyword, schema, parentSchema, $data, it } = cxt;
		checkAsyncKeyword(it, def);
		const validateRef = useKeyword(gen, keyword, !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate);
		const valid = gen.let("valid");
		cxt.block$data(valid, validateKeyword);
		cxt.ok((_a = def.valid) !== null && _a !== void 0 ? _a : valid);
		function validateKeyword() {
			if (def.errors === false) {
				assignValid();
				if (def.modifying) modifyData(cxt);
				reportErrs(() => cxt.error());
			} else {
				const ruleErrs = def.async ? validateAsync() : validateSync();
				if (def.modifying) modifyData(cxt);
				reportErrs(() => addErrs(cxt, ruleErrs));
			}
		}
		function validateAsync() {
			const ruleErrs = gen.let("ruleErrs", null);
			gen.try(() => assignValid((0, codegen_1._)`await `), (e) => gen.assign(valid, false).if((0, codegen_1._)`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1._)`${e}.errors`), () => gen.throw(e)));
			return ruleErrs;
		}
		function validateSync() {
			const validateErrs = (0, codegen_1._)`${validateRef}.errors`;
			gen.assign(validateErrs, null);
			assignValid(codegen_1.nil);
			return validateErrs;
		}
		function assignValid(_await = def.async ? (0, codegen_1._)`await ` : codegen_1.nil) {
			const passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self;
			const passSchema = !("compile" in def && !$data || def.schema === false);
			gen.assign(valid, (0, codegen_1._)`${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
		}
		function reportErrs(errors) {
			var _a;
			gen.if((0, codegen_1.not)((_a = def.valid) !== null && _a !== void 0 ? _a : valid), errors);
		}
	}
	exports.funcKeywordCode = funcKeywordCode;
	function modifyData(cxt) {
		const { gen, data, it } = cxt;
		gen.if(it.parentData, () => gen.assign(data, (0, codegen_1._)`${it.parentData}[${it.parentDataProperty}]`));
	}
	function addErrs(cxt, errs) {
		const { gen } = cxt;
		gen.if((0, codegen_1._)`Array.isArray(${errs})`, () => {
			gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`).assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
			(0, errors_1.extendErrors)(cxt);
		}, () => cxt.error());
	}
	function checkAsyncKeyword({ schemaEnv }, def) {
		if (def.async && !schemaEnv.$async) throw new Error("async keyword in sync schema");
	}
	function useKeyword(gen, keyword, result) {
		if (result === void 0) throw new Error(`keyword "${keyword}" failed to compile`);
		return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : {
			ref: result,
			code: (0, codegen_1.stringify)(result)
		});
	}
	function validSchemaType(schema, schemaType, allowUndefined = false) {
		return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
	}
	exports.validSchemaType = validSchemaType;
	function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
		/* istanbul ignore if */
		if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword) throw new Error("ajv implementation error");
		const deps = def.dependencies;
		if (deps === null || deps === void 0 ? void 0 : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) throw new Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
		if (def.validateSchema) {
			if (!def.validateSchema(schema[keyword])) {
				const msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` + self.errorsText(def.validateSchema.errors);
				if (opts.validateSchema === "log") self.logger.error(msg);
				else throw new Error(msg);
			}
		}
	}
	exports.validateKeywordUsage = validateKeywordUsage;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.extendSubschemaMode = exports.extendSubschemaData = exports.getSubschema = void 0;
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
		if (keyword !== void 0 && schema !== void 0) throw new Error("both \"keyword\" and \"schema\" passed, only one allowed");
		if (keyword !== void 0) {
			const sch = it.schema[keyword];
			return schemaProp === void 0 ? {
				schema: sch,
				schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
				errSchemaPath: `${it.errSchemaPath}/${keyword}`
			} : {
				schema: sch[schemaProp],
				schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
				errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`
			};
		}
		if (schema !== void 0) {
			if (schemaPath === void 0 || errSchemaPath === void 0 || topSchemaRef === void 0) throw new Error("\"schemaPath\", \"errSchemaPath\" and \"topSchemaRef\" are required with \"schema\"");
			return {
				schema,
				schemaPath,
				topSchemaRef,
				errSchemaPath
			};
		}
		throw new Error("either \"keyword\" or \"schema\" must be passed");
	}
	exports.getSubschema = getSubschema;
	function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
		if (data !== void 0 && dataProp !== void 0) throw new Error("both \"data\" and \"dataProp\" passed, only one allowed");
		const { gen } = it;
		if (dataProp !== void 0) {
			const { errorPath, dataPathArr, opts } = it;
			dataContextProps(gen.let("data", (0, codegen_1._)`${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true));
			subschema.errorPath = (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
			subschema.parentDataProperty = (0, codegen_1._)`${dataProp}`;
			subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
		}
		if (data !== void 0) {
			dataContextProps(data instanceof codegen_1.Name ? data : gen.let("data", data, true));
			if (propertyName !== void 0) subschema.propertyName = propertyName;
		}
		if (dataTypes) subschema.dataTypes = dataTypes;
		function dataContextProps(_nextData) {
			subschema.data = _nextData;
			subschema.dataLevel = it.dataLevel + 1;
			subschema.dataTypes = [];
			it.definedProperties = /* @__PURE__ */ new Set();
			subschema.parentData = it.data;
			subschema.dataNames = [...it.dataNames, _nextData];
		}
	}
	exports.extendSubschemaData = extendSubschemaData;
	function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
		if (compositeRule !== void 0) subschema.compositeRule = compositeRule;
		if (createErrors !== void 0) subschema.createErrors = createErrors;
		if (allErrors !== void 0) subschema.allErrors = allErrors;
		subschema.jtdDiscriminator = jtdDiscriminator;
		subschema.jtdMetadata = jtdMetadata;
	}
	exports.extendSubschemaMode = extendSubschemaMode;
}));
//#endregion
//#region ../../node_modules/.pnpm/fast-deep-equal@3.1.3/node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = function equal(a, b) {
		if (a === b) return true;
		if (a && b && typeof a == "object" && typeof b == "object") {
			if (a.constructor !== b.constructor) return false;
			var length, i, keys;
			if (Array.isArray(a)) {
				length = a.length;
				if (length != b.length) return false;
				for (i = length; i-- !== 0;) if (!equal(a[i], b[i])) return false;
				return true;
			}
			if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
			if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
			if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
			keys = Object.keys(a);
			length = keys.length;
			if (length !== Object.keys(b).length) return false;
			for (i = length; i-- !== 0;) if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
			for (i = length; i-- !== 0;) {
				var key = keys[i];
				if (!equal(a[key], b[key])) return false;
			}
			return true;
		}
		return a !== a && b !== b;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/json-schema-traverse@1.0.0/node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var traverse = module.exports = function(schema, opts, cb) {
		if (typeof opts == "function") {
			cb = opts;
			opts = {};
		}
		cb = opts.cb || cb;
		var pre = typeof cb == "function" ? cb : cb.pre || function() {};
		var post = cb.post || function() {};
		_traverse(opts, pre, post, schema, "", schema);
	};
	traverse.keywords = {
		additionalItems: true,
		items: true,
		contains: true,
		additionalProperties: true,
		propertyNames: true,
		not: true,
		if: true,
		then: true,
		else: true
	};
	traverse.arrayKeywords = {
		items: true,
		allOf: true,
		anyOf: true,
		oneOf: true
	};
	traverse.propsKeywords = {
		$defs: true,
		definitions: true,
		properties: true,
		patternProperties: true,
		dependencies: true
	};
	traverse.skipKeywords = {
		default: true,
		enum: true,
		const: true,
		required: true,
		maximum: true,
		minimum: true,
		exclusiveMaximum: true,
		exclusiveMinimum: true,
		multipleOf: true,
		maxLength: true,
		minLength: true,
		pattern: true,
		format: true,
		maxItems: true,
		minItems: true,
		uniqueItems: true,
		maxProperties: true,
		minProperties: true
	};
	function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
		if (schema && typeof schema == "object" && !Array.isArray(schema)) {
			pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
			for (var key in schema) {
				var sch = schema[key];
				if (Array.isArray(sch)) {
					if (key in traverse.arrayKeywords) for (var i = 0; i < sch.length; i++) _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
				} else if (key in traverse.propsKeywords) {
					if (sch && typeof sch == "object") for (var prop in sch) _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
				} else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords)) _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
			}
			post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
		}
	}
	function escapeJsonPtr(str) {
		return str.replace(/~/g, "~0").replace(/\//g, "~1");
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/resolve.js
var require_resolve = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.getSchemaRefs = exports.resolveUrl = exports.normalizeId = exports._getFullPath = exports.getFullPath = exports.inlineRef = void 0;
	const util_1 = require_util();
	const equal = require_fast_deep_equal();
	const traverse = require_json_schema_traverse();
	const SIMPLE_INLINED = new Set([
		"type",
		"format",
		"pattern",
		"maxLength",
		"minLength",
		"maxProperties",
		"minProperties",
		"maxItems",
		"minItems",
		"maximum",
		"minimum",
		"uniqueItems",
		"multipleOf",
		"required",
		"enum",
		"const"
	]);
	function inlineRef(schema, limit = true) {
		if (typeof schema == "boolean") return true;
		if (limit === true) return !hasRef(schema);
		if (!limit) return false;
		return countKeys(schema) <= limit;
	}
	exports.inlineRef = inlineRef;
	const REF_KEYWORDS = new Set([
		"$ref",
		"$recursiveRef",
		"$recursiveAnchor",
		"$dynamicRef",
		"$dynamicAnchor"
	]);
	function hasRef(schema) {
		for (const key in schema) {
			if (REF_KEYWORDS.has(key)) return true;
			const sch = schema[key];
			if (Array.isArray(sch) && sch.some(hasRef)) return true;
			if (typeof sch == "object" && hasRef(sch)) return true;
		}
		return false;
	}
	function countKeys(schema) {
		let count = 0;
		for (const key in schema) {
			if (key === "$ref") return Infinity;
			count++;
			if (SIMPLE_INLINED.has(key)) continue;
			if (typeof schema[key] == "object") (0, util_1.eachItem)(schema[key], (sch) => count += countKeys(sch));
			if (count === Infinity) return Infinity;
		}
		return count;
	}
	function getFullPath(resolver, id = "", normalize) {
		if (normalize !== false) id = normalizeId(id);
		return _getFullPath(resolver, resolver.parse(id));
	}
	exports.getFullPath = getFullPath;
	function _getFullPath(resolver, p) {
		return resolver.serialize(p).split("#")[0] + "#";
	}
	exports._getFullPath = _getFullPath;
	const TRAILING_SLASH_HASH = /#\/?$/;
	function normalizeId(id) {
		return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
	}
	exports.normalizeId = normalizeId;
	function resolveUrl(resolver, baseId, id) {
		id = normalizeId(id);
		return resolver.resolve(baseId, id);
	}
	exports.resolveUrl = resolveUrl;
	const ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
	function getSchemaRefs(schema, baseId) {
		if (typeof schema == "boolean") return {};
		const { schemaId, uriResolver } = this.opts;
		const schId = normalizeId(schema[schemaId] || baseId);
		const baseIds = { "": schId };
		const pathPrefix = getFullPath(uriResolver, schId, false);
		const localRefs = {};
		const schemaRefs = /* @__PURE__ */ new Set();
		traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
			if (parentJsonPtr === void 0) return;
			const fullPath = pathPrefix + jsonPtr;
			let innerBaseId = baseIds[parentJsonPtr];
			if (typeof sch[schemaId] == "string") innerBaseId = addRef.call(this, sch[schemaId]);
			addAnchor.call(this, sch.$anchor);
			addAnchor.call(this, sch.$dynamicAnchor);
			baseIds[jsonPtr] = innerBaseId;
			function addRef(ref) {
				const _resolve = this.opts.uriResolver.resolve;
				ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref);
				if (schemaRefs.has(ref)) throw ambiguos(ref);
				schemaRefs.add(ref);
				let schOrRef = this.refs[ref];
				if (typeof schOrRef == "string") schOrRef = this.refs[schOrRef];
				if (typeof schOrRef == "object") checkAmbiguosRef(sch, schOrRef.schema, ref);
				else if (ref !== normalizeId(fullPath)) if (ref[0] === "#") {
					checkAmbiguosRef(sch, localRefs[ref], ref);
					localRefs[ref] = sch;
				} else this.refs[ref] = fullPath;
				return ref;
			}
			function addAnchor(anchor) {
				if (typeof anchor == "string") {
					if (!ANCHOR.test(anchor)) throw new Error(`invalid anchor "${anchor}"`);
					addRef.call(this, `#${anchor}`);
				}
			}
		});
		return localRefs;
		function checkAmbiguosRef(sch1, sch2, ref) {
			if (sch2 !== void 0 && !equal(sch1, sch2)) throw ambiguos(ref);
		}
		function ambiguos(ref) {
			return /* @__PURE__ */ new Error(`reference "${ref}" resolves to more than one schema`);
		}
	}
	exports.getSchemaRefs = getSchemaRefs;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/validate/index.js
var require_validate = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.getData = exports.KeywordCxt = exports.validateFunctionCode = void 0;
	const boolSchema_1 = require_boolSchema();
	const dataType_1 = require_dataType();
	const applicability_1 = require_applicability();
	const dataType_2 = require_dataType();
	const defaults_1 = require_defaults();
	const keyword_1 = require_keyword();
	const subschema_1 = require_subschema();
	const codegen_1 = require_codegen();
	const names_1 = require_names();
	const resolve_1 = require_resolve();
	const util_1 = require_util();
	const errors_1 = require_errors();
	function validateFunctionCode(it) {
		if (isSchemaObj(it)) {
			checkKeywords(it);
			if (schemaCxtHasRules(it)) {
				topSchemaObjCode(it);
				return;
			}
		}
		validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
	}
	exports.validateFunctionCode = validateFunctionCode;
	function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
		if (opts.code.es5) gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
			gen.code((0, codegen_1._)`"use strict"; ${funcSourceUrl(schema, opts)}`);
			destructureValCxtES5(gen, opts);
			gen.code(body);
		});
		else gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
	}
	function destructureValCxt(opts) {
		return (0, codegen_1._)`{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? (0, codegen_1._)`, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
	}
	function destructureValCxtES5(gen, opts) {
		gen.if(names_1.default.valCxt, () => {
			gen.var(names_1.default.instancePath, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.instancePath}`);
			gen.var(names_1.default.parentData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentData}`);
			gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentDataProperty}`);
			gen.var(names_1.default.rootData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.rootData}`);
			if (opts.dynamicRef) gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
		}, () => {
			gen.var(names_1.default.instancePath, (0, codegen_1._)`""`);
			gen.var(names_1.default.parentData, (0, codegen_1._)`undefined`);
			gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`undefined`);
			gen.var(names_1.default.rootData, names_1.default.data);
			if (opts.dynamicRef) gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`{}`);
		});
	}
	function topSchemaObjCode(it) {
		const { schema, opts, gen } = it;
		validateFunction(it, () => {
			if (opts.$comment && schema.$comment) commentKeyword(it);
			checkNoDefault(it);
			gen.let(names_1.default.vErrors, null);
			gen.let(names_1.default.errors, 0);
			if (opts.unevaluated) resetEvaluated(it);
			typeAndKeywords(it);
			returnResults(it);
		});
	}
	function resetEvaluated(it) {
		const { gen, validateName } = it;
		it.evaluated = gen.const("evaluated", (0, codegen_1._)`${validateName}.evaluated`);
		gen.if((0, codegen_1._)`${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1._)`${it.evaluated}.props`, (0, codegen_1._)`undefined`));
		gen.if((0, codegen_1._)`${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1._)`${it.evaluated}.items`, (0, codegen_1._)`undefined`));
	}
	function funcSourceUrl(schema, opts) {
		const schId = typeof schema == "object" && schema[opts.schemaId];
		return schId && (opts.code.source || opts.code.process) ? (0, codegen_1._)`/*# sourceURL=${schId} */` : codegen_1.nil;
	}
	function subschemaCode(it, valid) {
		if (isSchemaObj(it)) {
			checkKeywords(it);
			if (schemaCxtHasRules(it)) {
				subSchemaObjCode(it, valid);
				return;
			}
		}
		(0, boolSchema_1.boolOrEmptySchema)(it, valid);
	}
	function schemaCxtHasRules({ schema, self }) {
		if (typeof schema == "boolean") return !schema;
		for (const key in schema) if (self.RULES.all[key]) return true;
		return false;
	}
	function isSchemaObj(it) {
		return typeof it.schema != "boolean";
	}
	function subSchemaObjCode(it, valid) {
		const { schema, gen, opts } = it;
		if (opts.$comment && schema.$comment) commentKeyword(it);
		updateContext(it);
		checkAsyncSchema(it);
		const errsCount = gen.const("_errs", names_1.default.errors);
		typeAndKeywords(it, errsCount);
		gen.var(valid, (0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
	}
	function checkKeywords(it) {
		(0, util_1.checkUnknownRules)(it);
		checkRefsAndKeywords(it);
	}
	function typeAndKeywords(it, errsCount) {
		if (it.opts.jtd) return schemaKeywords(it, [], false, errsCount);
		const types = (0, dataType_1.getSchemaTypes)(it.schema);
		schemaKeywords(it, types, !(0, dataType_1.coerceAndCheckDataType)(it, types), errsCount);
	}
	function checkRefsAndKeywords(it) {
		const { schema, errSchemaPath, opts, self } = it;
		if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1.schemaHasRulesButRef)(schema, self.RULES)) self.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
	}
	function checkNoDefault(it) {
		const { schema, opts } = it;
		if (schema.default !== void 0 && opts.useDefaults && opts.strictSchema) (0, util_1.checkStrictMode)(it, "default is ignored in the schema root");
	}
	function updateContext(it) {
		const schId = it.schema[it.opts.schemaId];
		if (schId) it.baseId = (0, resolve_1.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
	}
	function checkAsyncSchema(it) {
		if (it.schema.$async && !it.schemaEnv.$async) throw new Error("async schema in sync schema");
	}
	function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
		const msg = schema.$comment;
		if (opts.$comment === true) gen.code((0, codegen_1._)`${names_1.default.self}.logger.log(${msg})`);
		else if (typeof opts.$comment == "function") {
			const schemaPath = (0, codegen_1.str)`${errSchemaPath}/$comment`;
			const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
			gen.code((0, codegen_1._)`${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
		}
	}
	function returnResults(it) {
		const { gen, schemaEnv, validateName, ValidationError, opts } = it;
		if (schemaEnv.$async) gen.if((0, codegen_1._)`${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw((0, codegen_1._)`new ${ValidationError}(${names_1.default.vErrors})`));
		else {
			gen.assign((0, codegen_1._)`${validateName}.errors`, names_1.default.vErrors);
			if (opts.unevaluated) assignEvaluated(it);
			gen.return((0, codegen_1._)`${names_1.default.errors} === 0`);
		}
	}
	function assignEvaluated({ gen, evaluated, props, items }) {
		if (props instanceof codegen_1.Name) gen.assign((0, codegen_1._)`${evaluated}.props`, props);
		if (items instanceof codegen_1.Name) gen.assign((0, codegen_1._)`${evaluated}.items`, items);
	}
	function schemaKeywords(it, types, typeErrors, errsCount) {
		const { gen, schema, data, allErrors, opts, self } = it;
		const { RULES } = self;
		if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1.schemaHasRulesButRef)(schema, RULES))) {
			gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
			return;
		}
		if (!opts.jtd) checkStrictTypes(it, types);
		gen.block(() => {
			for (const group of RULES.rules) groupKeywords(group);
			groupKeywords(RULES.post);
		});
		function groupKeywords(group) {
			if (!(0, applicability_1.shouldUseGroup)(schema, group)) return;
			if (group.type) {
				gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
				iterateKeywords(it, group);
				if (types.length === 1 && types[0] === group.type && typeErrors) {
					gen.else();
					(0, dataType_2.reportTypeError)(it);
				}
				gen.endIf();
			} else iterateKeywords(it, group);
			if (!allErrors) gen.if((0, codegen_1._)`${names_1.default.errors} === ${errsCount || 0}`);
		}
	}
	function iterateKeywords(it, group) {
		const { gen, schema, opts: { useDefaults } } = it;
		if (useDefaults) (0, defaults_1.assignDefaults)(it, group.type);
		gen.block(() => {
			for (const rule of group.rules) if ((0, applicability_1.shouldUseRule)(schema, rule)) keywordCode(it, rule.keyword, rule.definition, group.type);
		});
	}
	function checkStrictTypes(it, types) {
		if (it.schemaEnv.meta || !it.opts.strictTypes) return;
		checkContextTypes(it, types);
		if (!it.opts.allowUnionTypes) checkMultipleTypes(it, types);
		checkKeywordTypes(it, it.dataTypes);
	}
	function checkContextTypes(it, types) {
		if (!types.length) return;
		if (!it.dataTypes.length) {
			it.dataTypes = types;
			return;
		}
		types.forEach((t) => {
			if (!includesType(it.dataTypes, t)) strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
		});
		narrowSchemaTypes(it, types);
	}
	function checkMultipleTypes(it, ts) {
		if (ts.length > 1 && !(ts.length === 2 && ts.includes("null"))) strictTypesError(it, "use allowUnionTypes to allow union type keyword");
	}
	function checkKeywordTypes(it, ts) {
		const rules = it.self.RULES.all;
		for (const keyword in rules) {
			const rule = rules[keyword];
			if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
				const { type } = rule.definition;
				if (type.length && !type.some((t) => hasApplicableType(ts, t))) strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
			}
		}
	}
	function hasApplicableType(schTs, kwdT) {
		return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
	}
	function includesType(ts, t) {
		return ts.includes(t) || t === "integer" && ts.includes("number");
	}
	function narrowSchemaTypes(it, withTypes) {
		const ts = [];
		for (const t of it.dataTypes) if (includesType(withTypes, t)) ts.push(t);
		else if (withTypes.includes("integer") && t === "number") ts.push("integer");
		it.dataTypes = ts;
	}
	function strictTypesError(it, msg) {
		const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
		msg += ` at "${schemaPath}" (strictTypes)`;
		(0, util_1.checkStrictMode)(it, msg, it.opts.strictTypes);
	}
	var KeywordCxt = class {
		constructor(it, def, keyword) {
			(0, keyword_1.validateKeywordUsage)(it, def, keyword);
			this.gen = it.gen;
			this.allErrors = it.allErrors;
			this.keyword = keyword;
			this.data = it.data;
			this.schema = it.schema[keyword];
			this.$data = def.$data && it.opts.$data && this.schema && this.schema.$data;
			this.schemaValue = (0, util_1.schemaRefOrVal)(it, this.schema, keyword, this.$data);
			this.schemaType = def.schemaType;
			this.parentSchema = it.schema;
			this.params = {};
			this.it = it;
			this.def = def;
			if (this.$data) this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
			else {
				this.schemaCode = this.schemaValue;
				if (!(0, keyword_1.validSchemaType)(this.schema, def.schemaType, def.allowUndefined)) throw new Error(`${keyword} value must be ${JSON.stringify(def.schemaType)}`);
			}
			if ("code" in def ? def.trackErrors : def.errors !== false) this.errsCount = it.gen.const("_errs", names_1.default.errors);
		}
		result(condition, successAction, failAction) {
			this.failResult((0, codegen_1.not)(condition), successAction, failAction);
		}
		failResult(condition, successAction, failAction) {
			this.gen.if(condition);
			if (failAction) failAction();
			else this.error();
			if (successAction) {
				this.gen.else();
				successAction();
				if (this.allErrors) this.gen.endIf();
			} else if (this.allErrors) this.gen.endIf();
			else this.gen.else();
		}
		pass(condition, failAction) {
			this.failResult((0, codegen_1.not)(condition), void 0, failAction);
		}
		fail(condition) {
			if (condition === void 0) {
				this.error();
				if (!this.allErrors) this.gen.if(false);
				return;
			}
			this.gen.if(condition);
			this.error();
			if (this.allErrors) this.gen.endIf();
			else this.gen.else();
		}
		fail$data(condition) {
			if (!this.$data) return this.fail(condition);
			const { schemaCode } = this;
			this.fail((0, codegen_1._)`${schemaCode} !== undefined && (${(0, codegen_1.or)(this.invalid$data(), condition)})`);
		}
		error(append, errorParams, errorPaths) {
			if (errorParams) {
				this.setParams(errorParams);
				this._error(append, errorPaths);
				this.setParams({});
				return;
			}
			this._error(append, errorPaths);
		}
		_error(append, errorPaths) {
			(append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
		}
		$dataError() {
			(0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
		}
		reset() {
			if (this.errsCount === void 0) throw new Error("add \"trackErrors\" to keyword definition");
			(0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
		}
		ok(cond) {
			if (!this.allErrors) this.gen.if(cond);
		}
		setParams(obj, assign) {
			if (assign) Object.assign(this.params, obj);
			else this.params = obj;
		}
		block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
			this.gen.block(() => {
				this.check$data(valid, $dataValid);
				codeBlock();
			});
		}
		check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
			if (!this.$data) return;
			const { gen, schemaCode, schemaType, def } = this;
			gen.if((0, codegen_1.or)((0, codegen_1._)`${schemaCode} === undefined`, $dataValid));
			if (valid !== codegen_1.nil) gen.assign(valid, true);
			if (schemaType.length || def.validateSchema) {
				gen.elseIf(this.invalid$data());
				this.$dataError();
				if (valid !== codegen_1.nil) gen.assign(valid, false);
			}
			gen.else();
		}
		invalid$data() {
			const { gen, schemaCode, schemaType, def, it } = this;
			return (0, codegen_1.or)(wrong$DataType(), invalid$DataSchema());
			function wrong$DataType() {
				if (schemaType.length) {
					/* istanbul ignore if */
					if (!(schemaCode instanceof codegen_1.Name)) throw new Error("ajv implementation error");
					const st = Array.isArray(schemaType) ? schemaType : [schemaType];
					return (0, codegen_1._)`${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
				}
				return codegen_1.nil;
			}
			function invalid$DataSchema() {
				if (def.validateSchema) {
					const validateSchemaRef = gen.scopeValue("validate$data", { ref: def.validateSchema });
					return (0, codegen_1._)`!${validateSchemaRef}(${schemaCode})`;
				}
				return codegen_1.nil;
			}
		}
		subschema(appl, valid) {
			const subschema = (0, subschema_1.getSubschema)(this.it, appl);
			(0, subschema_1.extendSubschemaData)(subschema, this.it, appl);
			(0, subschema_1.extendSubschemaMode)(subschema, appl);
			const nextContext = {
				...this.it,
				...subschema,
				items: void 0,
				props: void 0
			};
			subschemaCode(nextContext, valid);
			return nextContext;
		}
		mergeEvaluated(schemaCxt, toName) {
			const { it, gen } = this;
			if (!it.opts.unevaluated) return;
			if (it.props !== true && schemaCxt.props !== void 0) it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
			if (it.items !== true && schemaCxt.items !== void 0) it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
		}
		mergeValidEvaluated(schemaCxt, valid) {
			const { it, gen } = this;
			if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
				gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name));
				return true;
			}
		}
	};
	exports.KeywordCxt = KeywordCxt;
	function keywordCode(it, keyword, def, ruleType) {
		const cxt = new KeywordCxt(it, def, keyword);
		if ("code" in def) def.code(cxt, ruleType);
		else if (cxt.$data && def.validate) (0, keyword_1.funcKeywordCode)(cxt, def);
		else if ("macro" in def) (0, keyword_1.macroKeywordCode)(cxt, def);
		else if (def.compile || def.validate) (0, keyword_1.funcKeywordCode)(cxt, def);
	}
	const JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
	const RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
	function getData($data, { dataLevel, dataNames, dataPathArr }) {
		let jsonPointer;
		let data;
		if ($data === "") return names_1.default.rootData;
		if ($data[0] === "/") {
			if (!JSON_POINTER.test($data)) throw new Error(`Invalid JSON-pointer: ${$data}`);
			jsonPointer = $data;
			data = names_1.default.rootData;
		} else {
			const matches = RELATIVE_JSON_POINTER.exec($data);
			if (!matches) throw new Error(`Invalid JSON-pointer: ${$data}`);
			const up = +matches[1];
			jsonPointer = matches[2];
			if (jsonPointer === "#") {
				if (up >= dataLevel) throw new Error(errorMsg("property/index", up));
				return dataPathArr[dataLevel - up];
			}
			if (up > dataLevel) throw new Error(errorMsg("data", up));
			data = dataNames[dataLevel - up];
			if (!jsonPointer) return data;
		}
		let expr = data;
		const segments = jsonPointer.split("/");
		for (const segment of segments) if (segment) {
			data = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)((0, util_1.unescapeJsonPointer)(segment))}`;
			expr = (0, codegen_1._)`${expr} && ${data}`;
		}
		return expr;
		function errorMsg(pointerType, up) {
			return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
		}
	}
	exports.getData = getData;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	var ValidationError = class extends Error {
		constructor(errors) {
			super("validation failed");
			this.errors = errors;
			this.ajv = this.validation = true;
		}
	};
	exports.default = ValidationError;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const resolve_1 = require_resolve();
	var MissingRefError = class extends Error {
		constructor(resolver, baseId, ref, msg) {
			super(msg || `can't resolve reference ${ref} from id ${baseId}`);
			this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
			this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
		}
	};
	exports.default = MissingRefError;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/compile/index.js
var require_compile = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.resolveSchema = exports.getCompilingSchema = exports.resolveRef = exports.compileSchema = exports.SchemaEnv = void 0;
	const codegen_1 = require_codegen();
	const validation_error_1 = require_validation_error();
	const names_1 = require_names();
	const resolve_1 = require_resolve();
	const util_1 = require_util();
	const validate_1 = require_validate();
	var SchemaEnv = class {
		constructor(env) {
			var _a;
			this.refs = {};
			this.dynamicAnchors = {};
			let schema;
			if (typeof env.schema == "object") schema = env.schema;
			this.schema = env.schema;
			this.schemaId = env.schemaId;
			this.root = env.root || this;
			this.baseId = (_a = env.baseId) !== null && _a !== void 0 ? _a : (0, resolve_1.normalizeId)(schema === null || schema === void 0 ? void 0 : schema[env.schemaId || "$id"]);
			this.schemaPath = env.schemaPath;
			this.localRefs = env.localRefs;
			this.meta = env.meta;
			this.$async = schema === null || schema === void 0 ? void 0 : schema.$async;
			this.refs = {};
		}
	};
	exports.SchemaEnv = SchemaEnv;
	function compileSchema(sch) {
		const _sch = getCompilingSchema.call(this, sch);
		if (_sch) return _sch;
		const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId);
		const { es5, lines } = this.opts.code;
		const { ownProperties } = this.opts;
		const gen = new codegen_1.CodeGen(this.scope, {
			es5,
			lines,
			ownProperties
		});
		let _ValidationError;
		if (sch.$async) _ValidationError = gen.scopeValue("Error", {
			ref: validation_error_1.default,
			code: (0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`
		});
		const validateName = gen.scopeName("validate");
		sch.validateName = validateName;
		const schemaCxt = {
			gen,
			allErrors: this.opts.allErrors,
			data: names_1.default.data,
			parentData: names_1.default.parentData,
			parentDataProperty: names_1.default.parentDataProperty,
			dataNames: [names_1.default.data],
			dataPathArr: [codegen_1.nil],
			dataLevel: 0,
			dataTypes: [],
			definedProperties: /* @__PURE__ */ new Set(),
			topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true ? {
				ref: sch.schema,
				code: (0, codegen_1.stringify)(sch.schema)
			} : { ref: sch.schema }),
			validateName,
			ValidationError: _ValidationError,
			schema: sch.schema,
			schemaEnv: sch,
			rootId,
			baseId: sch.baseId || rootId,
			schemaPath: codegen_1.nil,
			errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
			errorPath: (0, codegen_1._)`""`,
			opts: this.opts,
			self: this
		};
		let sourceCode;
		try {
			this._compilations.add(sch);
			(0, validate_1.validateFunctionCode)(schemaCxt);
			gen.optimize(this.opts.code.optimize);
			const validateCode = gen.toString();
			sourceCode = `${gen.scopeRefs(names_1.default.scope)}return ${validateCode}`;
			if (this.opts.code.process) sourceCode = this.opts.code.process(sourceCode, sch);
			const validate = new Function(`${names_1.default.self}`, `${names_1.default.scope}`, sourceCode)(this, this.scope.get());
			this.scope.value(validateName, { ref: validate });
			validate.errors = null;
			validate.schema = sch.schema;
			validate.schemaEnv = sch;
			if (sch.$async) validate.$async = true;
			if (this.opts.code.source === true) validate.source = {
				validateName,
				validateCode,
				scopeValues: gen._values
			};
			if (this.opts.unevaluated) {
				const { props, items } = schemaCxt;
				validate.evaluated = {
					props: props instanceof codegen_1.Name ? void 0 : props,
					items: items instanceof codegen_1.Name ? void 0 : items,
					dynamicProps: props instanceof codegen_1.Name,
					dynamicItems: items instanceof codegen_1.Name
				};
				if (validate.source) validate.source.evaluated = (0, codegen_1.stringify)(validate.evaluated);
			}
			sch.validate = validate;
			return sch;
		} catch (e) {
			delete sch.validate;
			delete sch.validateName;
			if (sourceCode) this.logger.error("Error compiling schema, function code:", sourceCode);
			throw e;
		} finally {
			this._compilations.delete(sch);
		}
	}
	exports.compileSchema = compileSchema;
	function resolveRef(root, baseId, ref) {
		var _a;
		ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
		const schOrFunc = root.refs[ref];
		if (schOrFunc) return schOrFunc;
		let _sch = resolve.call(this, root, ref);
		if (_sch === void 0) {
			const schema = (_a = root.localRefs) === null || _a === void 0 ? void 0 : _a[ref];
			const { schemaId } = this.opts;
			if (schema) _sch = new SchemaEnv({
				schema,
				schemaId,
				root,
				baseId
			});
		}
		if (_sch === void 0) return;
		return root.refs[ref] = inlineOrCompile.call(this, _sch);
	}
	exports.resolveRef = resolveRef;
	function inlineOrCompile(sch) {
		if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs)) return sch.schema;
		return sch.validate ? sch : compileSchema.call(this, sch);
	}
	function getCompilingSchema(schEnv) {
		for (const sch of this._compilations) if (sameSchemaEnv(sch, schEnv)) return sch;
	}
	exports.getCompilingSchema = getCompilingSchema;
	function sameSchemaEnv(s1, s2) {
		return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
	}
	function resolve(root, ref) {
		let sch;
		while (typeof (sch = this.refs[ref]) == "string") ref = sch;
		return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
	}
	function resolveSchema(root, ref) {
		const p = this.opts.uriResolver.parse(ref);
		const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
		let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, void 0);
		if (Object.keys(root.schema).length > 0 && refPath === baseId) return getJsonPointer.call(this, p, root);
		const id = (0, resolve_1.normalizeId)(refPath);
		const schOrRef = this.refs[id] || this.schemas[id];
		if (typeof schOrRef == "string") {
			const sch = resolveSchema.call(this, root, schOrRef);
			if (typeof (sch === null || sch === void 0 ? void 0 : sch.schema) !== "object") return;
			return getJsonPointer.call(this, p, sch);
		}
		if (typeof (schOrRef === null || schOrRef === void 0 ? void 0 : schOrRef.schema) !== "object") return;
		if (!schOrRef.validate) compileSchema.call(this, schOrRef);
		if (id === (0, resolve_1.normalizeId)(ref)) {
			const { schema } = schOrRef;
			const { schemaId } = this.opts;
			const schId = schema[schemaId];
			if (schId) baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
			return new SchemaEnv({
				schema,
				schemaId,
				root,
				baseId
			});
		}
		return getJsonPointer.call(this, p, schOrRef);
	}
	exports.resolveSchema = resolveSchema;
	const PREVENT_SCOPE_CHANGE = new Set([
		"properties",
		"patternProperties",
		"enum",
		"dependencies",
		"definitions"
	]);
	function getJsonPointer(parsedRef, { baseId, schema, root }) {
		var _a;
		if (((_a = parsedRef.fragment) === null || _a === void 0 ? void 0 : _a[0]) !== "/") return;
		for (const part of parsedRef.fragment.slice(1).split("/")) {
			if (typeof schema === "boolean") return;
			const partSchema = schema[(0, util_1.unescapeFragment)(part)];
			if (partSchema === void 0) return;
			schema = partSchema;
			const schId = typeof schema === "object" && schema[this.opts.schemaId];
			if (!PREVENT_SCOPE_CHANGE.has(part) && schId) baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
		}
		let env;
		if (typeof schema != "boolean" && schema.$ref && !(0, util_1.schemaHasRulesButRef)(schema, this.RULES)) {
			const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
			env = resolveSchema.call(this, root, $ref);
		}
		const { schemaId } = this.opts;
		env = env || new SchemaEnv({
			schema,
			schemaId,
			root,
			baseId
		});
		if (env.schema !== env.root.schema) return env;
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/data.json
var require_data = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"$id": "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
		"description": "Meta-schema for $data reference (JSON AnySchema extension proposal)",
		"type": "object",
		"required": ["$data"],
		"properties": { "$data": {
			"type": "string",
			"anyOf": [{ "format": "relative-json-pointer" }, { "format": "json-pointer" }]
		} },
		"additionalProperties": false
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/fast-uri@3.1.5/node_modules/fast-uri/lib/utils.js
var require_utils = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {(value: string) => boolean} */
	const isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
	/** @type {(value: string) => boolean} */
	const isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
	/** @type {(value: string) => boolean} */
	const isHexPair = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu);
	/** @type {(value: string) => boolean} */
	const isUnreserved = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu);
	/** @type {(value: string) => boolean} */
	const isPathCharacter = RegExp.prototype.test.bind(/^[\da-z\-._~!$&'()*+,;=:@/]$/iu);
	/**
	* @param {Array<string>} input
	* @returns {string}
	*/
	function stringArrayToHexStripped(input) {
		let acc = "";
		let code = 0;
		let i = 0;
		for (i = 0; i < input.length; i++) {
			code = input[i].charCodeAt(0);
			if (code === 48) continue;
			if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) return "";
			acc += input[i];
			break;
		}
		for (i += 1; i < input.length; i++) {
			code = input[i].charCodeAt(0);
			if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) return "";
			acc += input[i];
		}
		return acc;
	}
	/**
	* @typedef {Object} GetIPV6Result
	* @property {boolean} error - Indicates if there was an error parsing the IPv6 address.
	* @property {string} address - The parsed IPv6 address.
	* @property {string} [zone] - The zone identifier, if present.
	*/
	/**
	* @param {string} value
	* @returns {boolean}
	*/
	const nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
	/**
	* @param {Array<string>} buffer
	* @returns {boolean}
	*/
	function consumeIsZone(buffer) {
		buffer.length = 0;
		return true;
	}
	/**
	* @param {Array<string>} buffer
	* @param {Array<string>} address
	* @param {GetIPV6Result} output
	* @returns {boolean}
	*/
	function consumeHextets(buffer, address, output) {
		if (buffer.length) {
			const hex = stringArrayToHexStripped(buffer);
			if (hex !== "") address.push(hex);
			else {
				output.error = true;
				return false;
			}
			buffer.length = 0;
		}
		return true;
	}
	/**
	* @param {string} input
	* @returns {GetIPV6Result}
	*/
	function getIPV6(input) {
		let tokenCount = 0;
		const output = {
			error: false,
			address: "",
			zone: ""
		};
		/** @type {Array<string>} */
		const address = [];
		/** @type {Array<string>} */
		const buffer = [];
		let endipv6Encountered = false;
		let endIpv6 = false;
		let consume = consumeHextets;
		for (let i = 0; i < input.length; i++) {
			const cursor = input[i];
			if (cursor === "[" || cursor === "]") continue;
			if (cursor === ":") {
				if (endipv6Encountered === true) endIpv6 = true;
				if (!consume(buffer, address, output)) break;
				if (++tokenCount > 7) {
					output.error = true;
					break;
				}
				if (i > 0 && input[i - 1] === ":") endipv6Encountered = true;
				address.push(":");
				continue;
			} else if (cursor === "%") {
				if (!consume(buffer, address, output)) break;
				consume = consumeIsZone;
			} else {
				buffer.push(cursor);
				continue;
			}
		}
		if (buffer.length) if (consume === consumeIsZone) output.zone = buffer.join("");
		else if (endIpv6) address.push(buffer.join(""));
		else address.push(stringArrayToHexStripped(buffer));
		output.address = address.join("");
		return output;
	}
	/**
	* @typedef {Object} NormalizeIPv6Result
	* @property {string} host - The normalized host.
	* @property {string} [escapedHost] - The escaped host.
	* @property {boolean} isIPV6 - Indicates if the host is an IPv6 address.
	*/
	/**
	* @param {string} host
	* @returns {NormalizeIPv6Result}
	*/
	function normalizeIPv6(host) {
		if (findToken(host, ":") < 2) return {
			host,
			isIPV6: false
		};
		const ipv6 = getIPV6(host);
		if (!ipv6.error) {
			let newHost = ipv6.address;
			let escapedHost = ipv6.address;
			if (ipv6.zone) {
				newHost += "%" + ipv6.zone;
				escapedHost += "%25" + ipv6.zone;
			}
			return {
				host: newHost,
				isIPV6: true,
				escapedHost
			};
		} else return {
			host,
			isIPV6: false
		};
	}
	/**
	* @param {string} str
	* @param {string} token
	* @returns {number}
	*/
	function findToken(str, token) {
		let ind = 0;
		for (let i = 0; i < str.length; i++) if (str[i] === token) ind++;
		return ind;
	}
	/**
	* @param {string} path
	* @returns {string}
	*
	* @see https://datatracker.ietf.org/doc/html/rfc3986#section-5.2.4
	*/
	function removeDotSegments(path) {
		let input = path;
		const output = [];
		let nextSlash = -1;
		let len = 0;
		while (len = input.length) {
			if (len === 1) if (input === ".") break;
			else if (input === "/") {
				output.push("/");
				break;
			} else {
				output.push(input);
				break;
			}
			else if (len === 2) {
				if (input[0] === ".") {
					if (input[1] === ".") break;
					else if (input[1] === "/") {
						input = input.slice(2);
						continue;
					}
				} else if (input[0] === "/") {
					if (input[1] === "." || input[1] === "/") {
						output.push("/");
						break;
					}
				}
			} else if (len === 3) {
				if (input === "/..") {
					if (output.length !== 0) output.pop();
					output.push("/");
					break;
				}
			}
			if (input[0] === ".") {
				if (input[1] === ".") {
					if (input[2] === "/") {
						input = input.slice(3);
						continue;
					}
				} else if (input[1] === "/") {
					input = input.slice(2);
					continue;
				}
			} else if (input[0] === "/") {
				if (input[1] === ".") {
					if (input[2] === "/") {
						input = input.slice(2);
						continue;
					} else if (input[2] === ".") {
						if (input[3] === "/") {
							input = input.slice(3);
							if (output.length !== 0) output.pop();
							continue;
						}
					}
				}
			}
			if ((nextSlash = input.indexOf("/", 1)) === -1) {
				output.push(input);
				break;
			} else {
				output.push(input.slice(0, nextSlash));
				input = input.slice(nextSlash);
			}
		}
		return output.join("");
	}
	/**
	* Re-escape RFC 3986 gen-delims that must not appear literally in the host.
	* After the URI regex parses, these characters cannot be literal in the host
	* field, so any that appear after decoding came from percent-encoding and
	* must be restored to prevent authority structure changes.
	*
	* @param {string} host
	* @param {boolean} isIP - true for IPv4/IPv6 hosts (skip colon re-escaping)
	* @returns {string}
	*/
	const HOST_DELIMS = {
		"@": "%40",
		"/": "%2F",
		"?": "%3F",
		"#": "%23",
		":": "%3A"
	};
	const HOST_DELIM_RE = /[@/?#:]/g;
	const HOST_DELIM_NO_COLON_RE = /[@/?#]/g;
	function reescapeHostDelimiters(host, isIP) {
		const re = isIP ? HOST_DELIM_NO_COLON_RE : HOST_DELIM_RE;
		re.lastIndex = 0;
		return host.replace(re, (ch) => HOST_DELIMS[ch]);
	}
	/**
	* Normalizes percent escapes and optionally decodes only unreserved ASCII bytes.
	* Reserved delimiters such as `%2F` and `%2E` stay escaped.
	*
	* @param {string} input
	* @param {boolean} [decodeUnreserved=false]
	* @returns {string}
	*/
	function normalizePercentEncoding(input, decodeUnreserved = false) {
		if (input.indexOf("%") === -1) return input;
		let output = "";
		for (let i = 0; i < input.length; i++) {
			if (input[i] === "%" && i + 2 < input.length) {
				const hex = input.slice(i + 1, i + 3);
				if (isHexPair(hex)) {
					const normalizedHex = hex.toUpperCase();
					const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
					if (decodeUnreserved && isUnreserved(decoded)) output += decoded;
					else output += "%" + normalizedHex;
					i += 2;
					continue;
				}
			}
			output += input[i];
		}
		return output;
	}
	/**
	* Normalizes path data without turning reserved escapes into live path syntax.
	* Valid escapes are uppercased, raw unsafe characters are escaped, and only
	* unreserved bytes that are not `.` are decoded.
	*
	* @param {string} input
	* @returns {string}
	*/
	function normalizePathEncoding(input) {
		let output = "";
		for (let i = 0; i < input.length; i++) {
			if (input[i] === "%" && i + 2 < input.length) {
				const hex = input.slice(i + 1, i + 3);
				if (isHexPair(hex)) {
					const normalizedHex = hex.toUpperCase();
					const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
					if (decoded !== "." && isUnreserved(decoded)) output += decoded;
					else output += "%" + normalizedHex;
					i += 2;
					continue;
				}
			}
			if (isPathCharacter(input[i])) output += input[i];
			else output += escape(input[i]);
		}
		return output;
	}
	/**
	* Escapes a component while preserving existing valid percent escapes.
	*
	* @param {string} input
	* @returns {string}
	*/
	function escapePreservingEscapes(input) {
		let output = "";
		for (let i = 0; i < input.length; i++) {
			if (input[i] === "%" && i + 2 < input.length) {
				const hex = input.slice(i + 1, i + 3);
				if (isHexPair(hex)) {
					output += "%" + hex.toUpperCase();
					i += 2;
					continue;
				}
			}
			output += escape(input[i]);
		}
		return output;
	}
	/**
	* @param {import('../types/index').URIComponent} component
	* @returns {string|undefined}
	*/
	function recomposeAuthority(component) {
		const uriTokens = [];
		if (component.userinfo !== void 0) {
			uriTokens.push(component.userinfo);
			uriTokens.push("@");
		}
		if (component.host !== void 0) {
			let host = unescape(component.host);
			if (!isIPv4(host)) {
				const ipV6res = normalizeIPv6(host);
				if (ipV6res.isIPV6 === true) host = `[${ipV6res.escapedHost}]`;
				else host = reescapeHostDelimiters(host, false);
			}
			uriTokens.push(host);
		}
		if (typeof component.port === "number" || typeof component.port === "string") {
			uriTokens.push(":");
			uriTokens.push(String(component.port));
		}
		return uriTokens.length ? uriTokens.join("") : void 0;
	}
	module.exports = {
		nonSimpleDomain,
		recomposeAuthority,
		reescapeHostDelimiters,
		normalizePercentEncoding,
		normalizePathEncoding,
		escapePreservingEscapes,
		removeDotSegments,
		isIPv4,
		isUUID,
		normalizeIPv6,
		stringArrayToHexStripped
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/fast-uri@3.1.5/node_modules/fast-uri/lib/schemes.js
var require_schemes = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const { isUUID } = require_utils();
	const URN_REG = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
	const supportedSchemeNames = [
		"http",
		"https",
		"ws",
		"wss",
		"urn",
		"urn:uuid"
	];
	/** @typedef {supportedSchemeNames[number]} SchemeName */
	/**
	* @param {string} name
	* @returns {name is SchemeName}
	*/
	function isValidSchemeName(name) {
		return supportedSchemeNames.indexOf(name) !== -1;
	}
	/**
	* @callback SchemeFn
	* @param {import('../types/index').URIComponent} component
	* @param {import('../types/index').Options} options
	* @returns {import('../types/index').URIComponent}
	*/
	/**
	* @typedef {Object} SchemeHandler
	* @property {SchemeName} scheme - The scheme name.
	* @property {boolean} [domainHost] - Indicates if the scheme supports domain hosts.
	* @property {SchemeFn} parse - Function to parse the URI component for this scheme.
	* @property {SchemeFn} serialize - Function to serialize the URI component for this scheme.
	* @property {boolean} [skipNormalize] - Indicates if normalization should be skipped for this scheme.
	* @property {boolean} [absolutePath] - Indicates if the scheme uses absolute paths.
	* @property {boolean} [unicodeSupport] - Indicates if the scheme supports Unicode.
	*/
	/**
	* @param {import('../types/index').URIComponent} wsComponent
	* @returns {boolean}
	*/
	function wsIsSecure(wsComponent) {
		if (wsComponent.secure === true) return true;
		else if (wsComponent.secure === false) return false;
		else if (wsComponent.scheme) return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
		else return false;
	}
	/** @type {SchemeFn} */
	function httpParse(component) {
		if (!component.host) component.error = component.error || "HTTP URIs must have a host.";
		return component;
	}
	/** @type {SchemeFn} */
	function httpSerialize(component) {
		const secure = String(component.scheme).toLowerCase() === "https";
		if (component.port === (secure ? 443 : 80) || component.port === "") component.port = void 0;
		if (!component.path) component.path = "/";
		return component;
	}
	/** @type {SchemeFn} */
	function wsParse(wsComponent) {
		wsComponent.secure = wsIsSecure(wsComponent);
		wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
		wsComponent.path = void 0;
		wsComponent.query = void 0;
		return wsComponent;
	}
	/** @type {SchemeFn} */
	function wsSerialize(wsComponent) {
		if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") wsComponent.port = void 0;
		if (typeof wsComponent.secure === "boolean") {
			wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
			wsComponent.secure = void 0;
		}
		if (wsComponent.resourceName) {
			const [path, query] = wsComponent.resourceName.split("?");
			wsComponent.path = path && path !== "/" ? path : void 0;
			wsComponent.query = query;
			wsComponent.resourceName = void 0;
		}
		wsComponent.fragment = void 0;
		return wsComponent;
	}
	/** @type {SchemeFn} */
	function urnParse(urnComponent, options) {
		if (!urnComponent.path) {
			urnComponent.error = "URN can not be parsed";
			return urnComponent;
		}
		const matches = urnComponent.path.match(URN_REG);
		if (matches) {
			const scheme = options.scheme || urnComponent.scheme || "urn";
			urnComponent.nid = matches[1].toLowerCase();
			urnComponent.nss = matches[2];
			const schemeHandler = getSchemeHandler(`${scheme}:${options.nid || urnComponent.nid}`);
			urnComponent.path = void 0;
			if (schemeHandler) urnComponent = schemeHandler.parse(urnComponent, options);
		} else urnComponent.error = urnComponent.error || "URN can not be parsed.";
		return urnComponent;
	}
	/** @type {SchemeFn} */
	function urnSerialize(urnComponent, options) {
		if (urnComponent.nid === void 0) throw new Error("URN without nid cannot be serialized");
		const scheme = options.scheme || urnComponent.scheme || "urn";
		const nid = urnComponent.nid.toLowerCase();
		const schemeHandler = getSchemeHandler(`${scheme}:${options.nid || nid}`);
		if (schemeHandler) urnComponent = schemeHandler.serialize(urnComponent, options);
		const uriComponent = urnComponent;
		const nss = urnComponent.nss;
		uriComponent.path = `${nid || options.nid}:${nss}`;
		options.skipEscape = true;
		return uriComponent;
	}
	/** @type {SchemeFn} */
	function urnuuidParse(urnComponent, options) {
		const uuidComponent = urnComponent;
		uuidComponent.uuid = uuidComponent.nss;
		uuidComponent.nss = void 0;
		if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) uuidComponent.error = uuidComponent.error || "UUID is not valid.";
		return uuidComponent;
	}
	/** @type {SchemeFn} */
	function urnuuidSerialize(uuidComponent) {
		const urnComponent = uuidComponent;
		urnComponent.nss = (uuidComponent.uuid || "").toLowerCase();
		return urnComponent;
	}
	const http = {
		scheme: "http",
		domainHost: true,
		parse: httpParse,
		serialize: httpSerialize
	};
	const https = {
		scheme: "https",
		domainHost: http.domainHost,
		parse: httpParse,
		serialize: httpSerialize
	};
	const ws = {
		scheme: "ws",
		domainHost: true,
		parse: wsParse,
		serialize: wsSerialize
	};
	const SCHEMES = {
		http,
		https,
		ws,
		wss: {
			scheme: "wss",
			domainHost: ws.domainHost,
			parse: ws.parse,
			serialize: ws.serialize
		},
		urn: {
			scheme: "urn",
			parse: urnParse,
			serialize: urnSerialize,
			skipNormalize: true
		},
		"urn:uuid": {
			scheme: "urn:uuid",
			parse: urnuuidParse,
			serialize: urnuuidSerialize,
			skipNormalize: true
		}
	};
	Object.setPrototypeOf(SCHEMES, null);
	/**
	* @param {string|undefined} scheme
	* @returns {SchemeHandler|undefined}
	*/
	function getSchemeHandler(scheme) {
		return scheme && (SCHEMES[scheme] || SCHEMES[scheme.toLowerCase()]) || void 0;
	}
	module.exports = {
		wsIsSecure,
		SCHEMES,
		isValidSchemeName,
		getSchemeHandler
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/fast-uri@3.1.5/node_modules/fast-uri/index.js
var require_fast_uri = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizePercentEncoding, normalizePathEncoding, escapePreservingEscapes, reescapeHostDelimiters, isIPv4, nonSimpleDomain } = require_utils();
	const { SCHEMES, getSchemeHandler } = require_schemes();
	/**
	* @template {import('./types/index').URIComponent|string} T
	* @param {T} uri
	* @param {import('./types/index').Options} [options]
	* @returns {T}
	*/
	function normalize(uri, options) {
		if (typeof uri === "string") uri = normalizeString(uri, options);
		else if (typeof uri === "object") uri = parse(serialize(uri, options), options);
		return uri;
	}
	/**
	* @param {string} baseURI
	* @param {string} relativeURI
	* @param {import('./types/index').Options} [options]
	* @returns {string}
	*/
	function resolve(baseURI, relativeURI, options) {
		const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
		const { parsed: baseParsed, malformedAuthorityOrPort: baseMalformed } = parseWithStatus(baseURI, schemelessOptions);
		const { parsed: relativeParsed, malformedAuthorityOrPort: relativeMalformed } = parseWithStatus(relativeURI, schemelessOptions);
		if (baseMalformed || relativeMalformed) throw new Error(baseParsed.error || relativeParsed.error || "URI is malformed.");
		const resolved = resolveComponent(baseParsed, relativeParsed, schemelessOptions, true);
		schemelessOptions.skipEscape = true;
		return serialize(resolved, schemelessOptions);
	}
	/**
	* @param {import ('./types/index').URIComponent} base
	* @param {import ('./types/index').URIComponent} relative
	* @param {import('./types/index').Options} [options]
	* @param {boolean} [skipNormalization=false]
	* @returns {import ('./types/index').URIComponent}
	*/
	function resolveComponent(base, relative, options, skipNormalization) {
		/** @type {import('./types/index').URIComponent} */
		const target = {};
		if (!skipNormalization) {
			base = parse(serialize(base, options), options);
			relative = parse(serialize(relative, options), options);
		}
		options = options || {};
		if (!options.tolerant && relative.scheme) {
			target.scheme = relative.scheme;
			target.userinfo = relative.userinfo;
			target.host = relative.host;
			target.port = relative.port;
			target.path = removeDotSegments(relative.path || "");
			target.query = relative.query;
		} else {
			if (relative.userinfo !== void 0 || relative.host !== void 0 || relative.port !== void 0) {
				target.userinfo = relative.userinfo;
				target.host = relative.host;
				target.port = relative.port;
				target.path = removeDotSegments(relative.path || "");
				target.query = relative.query;
			} else {
				if (!relative.path) {
					target.path = base.path;
					if (relative.query !== void 0) target.query = relative.query;
					else target.query = base.query;
				} else {
					if (relative.path[0] === "/") target.path = removeDotSegments(relative.path);
					else {
						if ((base.userinfo !== void 0 || base.host !== void 0 || base.port !== void 0) && !base.path) target.path = "/" + relative.path;
						else if (!base.path) target.path = relative.path;
						else target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative.path;
						target.path = removeDotSegments(target.path);
					}
					target.query = relative.query;
				}
				target.userinfo = base.userinfo;
				target.host = base.host;
				target.port = base.port;
			}
			target.scheme = base.scheme;
		}
		target.fragment = relative.fragment;
		return target;
	}
	/**
	* @param {import ('./types/index').URIComponent|string} uriA
	* @param {import ('./types/index').URIComponent|string} uriB
	* @param {import ('./types/index').Options} options
	* @returns {boolean}
	*/
	function equal(uriA, uriB, options) {
		const normalizedA = normalizeComparableURI(uriA, options);
		const normalizedB = normalizeComparableURI(uriB, options);
		return normalizedA !== void 0 && normalizedB !== void 0 && normalizedA.toLowerCase() === normalizedB.toLowerCase();
	}
	/**
	* @param {Readonly<import('./types/index').URIComponent>} cmpts
	* @param {import('./types/index').Options} [opts]
	* @returns {string}
	*/
	function serialize(cmpts, opts) {
		const component = {
			host: cmpts.host,
			scheme: cmpts.scheme,
			userinfo: cmpts.userinfo,
			port: cmpts.port,
			path: cmpts.path,
			query: cmpts.query,
			nid: cmpts.nid,
			nss: cmpts.nss,
			uuid: cmpts.uuid,
			fragment: cmpts.fragment,
			reference: cmpts.reference,
			resourceName: cmpts.resourceName,
			secure: cmpts.secure,
			error: ""
		};
		const options = Object.assign({}, opts);
		const uriTokens = [];
		const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
		if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(component, options);
		if (component.path !== void 0) if (!options.skipEscape) {
			component.path = escapePreservingEscapes(component.path);
			if (component.scheme !== void 0) component.path = component.path.split("%3A").join(":");
		} else component.path = normalizePercentEncoding(component.path);
		if (options.reference !== "suffix" && component.scheme) uriTokens.push(component.scheme, ":");
		const authority = recomposeAuthority(component);
		if (authority !== void 0) {
			if (options.reference !== "suffix") uriTokens.push("//");
			uriTokens.push(authority);
			if (component.path && component.path[0] !== "/") uriTokens.push("/");
		}
		if (component.path !== void 0) {
			let s = component.path;
			if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) s = removeDotSegments(s);
			if (authority === void 0 && s[0] === "/" && s[1] === "/") s = "/%2F" + s.slice(2);
			uriTokens.push(s);
		}
		if (component.query !== void 0) uriTokens.push("?", component.query);
		if (component.fragment !== void 0) uriTokens.push("#", component.fragment);
		return uriTokens.join("");
	}
	const URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
	const AUTHORITY_PREFIX = /^(?:[^#/:?]+:)?\/\/([^/?#]*)/;
	const AUTHORITY_INTRODUCER_REGION = /^(?:[^#/:?]+:)?([/\\\t\n\r]*)/;
	/**
	* @param {import('./types/index').URIComponent} parsed
	* @param {RegExpMatchArray} matches
	* @returns {string|undefined}
	*/
	function getParseError(parsed, matches) {
		if (matches[2] !== void 0 && parsed.path && parsed.path[0] !== "/") return "URI path must start with \"/\" when authority is present.";
		if (typeof parsed.port === "number" && (parsed.port < 0 || parsed.port > 65535)) return "URI port is malformed.";
	}
	/**
	* @param {string} uri
	* @param {import('./types/index').Options} [opts]
	* @returns {{ parsed: import('./types/index').URIComponent, malformedAuthorityOrPort: boolean }}
	*/
	function parseWithStatus(uri, opts) {
		const options = Object.assign({}, opts);
		/** @type {import('./types/index').URIComponent} */
		const parsed = {
			scheme: void 0,
			userinfo: void 0,
			host: "",
			port: void 0,
			path: "",
			query: void 0,
			fragment: void 0
		};
		let malformedAuthorityOrPort = false;
		let isIP = false;
		if (options.reference === "suffix") if (options.scheme) uri = options.scheme + ":" + uri;
		else uri = "//" + uri;
		const authorityMatch = uri.match(AUTHORITY_PREFIX);
		if (authorityMatch !== null && authorityMatch[1].indexOf("\\") !== -1) {
			parsed.error = "URI authority must not contain a literal backslash.";
			malformedAuthorityOrPort = true;
		}
		const introducerMatch = uri.match(AUTHORITY_INTRODUCER_REGION);
		if (introducerMatch !== null) {
			const region = introducerMatch[1];
			const normalizedRegion = region.replace(/[\t\n\r]/g, "");
			if (normalizedRegion.length >= 2) {
				if (normalizedRegion.slice(0, 2) !== "//") {
					parsed.error = parsed.error || "URI authority must not contain a literal backslash.";
					malformedAuthorityOrPort = true;
				} else if (region.length !== normalizedRegion.length) {
					parsed.error = parsed.error || "URI authority introducer must not contain whitespace.";
					malformedAuthorityOrPort = true;
				}
			}
		}
		const matches = uri.match(URI_PARSE);
		if (matches) {
			parsed.scheme = matches[1];
			parsed.userinfo = matches[3];
			parsed.host = matches[4];
			parsed.port = parseInt(matches[5], 10);
			parsed.path = matches[6] || "";
			parsed.query = matches[7];
			parsed.fragment = matches[8];
			if (isNaN(parsed.port)) parsed.port = matches[5];
			const parseError = getParseError(parsed, matches);
			if (parseError !== void 0) {
				parsed.error = parsed.error || parseError;
				malformedAuthorityOrPort = true;
			}
			if (parsed.host) if (isIPv4(parsed.host) === false) {
				const ipv6result = normalizeIPv6(parsed.host);
				parsed.host = ipv6result.host.toLowerCase();
				isIP = ipv6result.isIPV6;
			} else isIP = true;
			if (parsed.scheme === void 0 && parsed.userinfo === void 0 && parsed.host === void 0 && parsed.port === void 0 && parsed.query === void 0 && !parsed.path) parsed.reference = "same-document";
			else if (parsed.scheme === void 0) parsed.reference = "relative";
			else if (parsed.fragment === void 0) parsed.reference = "absolute";
			else parsed.reference = "uri";
			if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
			const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
			if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport)) {
				if (parsed.host && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) try {
					parsed.host = new URL("http://" + parsed.host).hostname;
				} catch (e) {
					parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
				}
			}
			if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
				if (uri.indexOf("%") !== -1) {
					if (parsed.scheme !== void 0) parsed.scheme = unescape(parsed.scheme);
					if (parsed.host !== void 0) parsed.host = reescapeHostDelimiters(unescape(parsed.host), isIP);
				}
				if (parsed.path) parsed.path = normalizePathEncoding(parsed.path);
				if (parsed.fragment) try {
					parsed.fragment = encodeURI(decodeURIComponent(parsed.fragment));
				} catch {
					parsed.error = parsed.error || "URI malformed";
				}
			}
			if (schemeHandler && schemeHandler.parse) schemeHandler.parse(parsed, options);
		} else parsed.error = parsed.error || "URI can not be parsed.";
		return {
			parsed,
			malformedAuthorityOrPort
		};
	}
	/**
	* @param {string} uri
	* @param {import('./types/index').Options} [opts]
	* @returns
	*/
	function parse(uri, opts) {
		return parseWithStatus(uri, opts).parsed;
	}
	/**
	* @param {string} uri
	* @param {import('./types/index').Options} [opts]
	* @returns {string}
	*/
	function normalizeString(uri, opts) {
		return normalizeStringWithStatus(uri, opts).normalized;
	}
	/**
	* @param {string} uri
	* @param {import('./types/index').Options} [opts]
	* @returns {{ normalized: string, malformedAuthorityOrPort: boolean }}
	*/
	function normalizeStringWithStatus(uri, opts) {
		const { parsed, malformedAuthorityOrPort } = parseWithStatus(uri, opts);
		return {
			normalized: malformedAuthorityOrPort ? uri : serialize(parsed, opts),
			malformedAuthorityOrPort
		};
	}
	/**
	* @param {import ('./types/index').URIComponent|string} uri
	* @param {import('./types/index').Options} [opts]
	* @returns {string|undefined}
	*/
	function normalizeComparableURI(uri, opts) {
		if (typeof uri === "string") {
			const { normalized, malformedAuthorityOrPort } = normalizeStringWithStatus(uri, opts);
			return malformedAuthorityOrPort ? void 0 : normalized;
		}
		if (typeof uri === "object") return serialize(uri, opts);
	}
	const fastUri = {
		SCHEMES,
		normalize,
		resolve,
		resolveComponent,
		equal,
		serialize,
		parse
	};
	module.exports = fastUri;
	module.exports.default = fastUri;
	module.exports.fastUri = fastUri;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/uri.js
var require_uri = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const uri = require_fast_uri();
	uri.code = "require(\"ajv/dist/runtime/uri\").default";
	exports.default = uri;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/core.js
var require_core$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = void 0;
	var validate_1 = require_validate();
	Object.defineProperty(exports, "KeywordCxt", {
		enumerable: true,
		get: function() {
			return validate_1.KeywordCxt;
		}
	});
	var codegen_1 = require_codegen();
	Object.defineProperty(exports, "_", {
		enumerable: true,
		get: function() {
			return codegen_1._;
		}
	});
	Object.defineProperty(exports, "str", {
		enumerable: true,
		get: function() {
			return codegen_1.str;
		}
	});
	Object.defineProperty(exports, "stringify", {
		enumerable: true,
		get: function() {
			return codegen_1.stringify;
		}
	});
	Object.defineProperty(exports, "nil", {
		enumerable: true,
		get: function() {
			return codegen_1.nil;
		}
	});
	Object.defineProperty(exports, "Name", {
		enumerable: true,
		get: function() {
			return codegen_1.Name;
		}
	});
	Object.defineProperty(exports, "CodeGen", {
		enumerable: true,
		get: function() {
			return codegen_1.CodeGen;
		}
	});
	const validation_error_1 = require_validation_error();
	const ref_error_1 = require_ref_error();
	const rules_1 = require_rules();
	const compile_1 = require_compile();
	const codegen_2 = require_codegen();
	const resolve_1 = require_resolve();
	const dataType_1 = require_dataType();
	const util_1 = require_util();
	const $dataRefSchema = require_data();
	const uri_1 = require_uri();
	const defaultRegExp = (str, flags) => new RegExp(str, flags);
	defaultRegExp.code = "new RegExp";
	const META_IGNORE_OPTIONS = [
		"removeAdditional",
		"useDefaults",
		"coerceTypes"
	];
	const EXT_SCOPE_NAMES = new Set([
		"validate",
		"serialize",
		"parse",
		"wrapper",
		"root",
		"schema",
		"keyword",
		"pattern",
		"formats",
		"validate$data",
		"func",
		"obj",
		"Error"
	]);
	const removedOptions = {
		errorDataPath: "",
		format: "`validateFormats: false` can be used instead.",
		nullable: "\"nullable\" keyword is supported by default.",
		jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
		extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
		missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
		processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
		sourceCode: "Use option `code: {source: true}`",
		strictDefaults: "It is default now, see option `strict`.",
		strictKeywords: "It is default now, see option `strict`.",
		uniqueItems: "\"uniqueItems\" keyword is always validated.",
		unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
		cache: "Map is used as cache, schema object as key.",
		serialize: "Map is used as cache, schema object as key.",
		ajvErrors: "It is default now."
	};
	const deprecatedOptions = {
		ignoreKeywordsWithRef: "",
		jsPropertySyntax: "",
		unicode: "\"minLength\"/\"maxLength\" account for unicode characters by default."
	};
	const MAX_EXPRESSION = 200;
	function requiredOptions(o) {
		var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
		const s = o.strict;
		const _optz = (_a = o.code) === null || _a === void 0 ? void 0 : _a.optimize;
		const optimize = _optz === true || _optz === void 0 ? 1 : _optz || 0;
		const regExp = (_c = (_b = o.code) === null || _b === void 0 ? void 0 : _b.regExp) !== null && _c !== void 0 ? _c : defaultRegExp;
		const uriResolver = (_d = o.uriResolver) !== null && _d !== void 0 ? _d : uri_1.default;
		return {
			strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== void 0 ? _e : s) !== null && _f !== void 0 ? _f : true,
			strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== void 0 ? _g : s) !== null && _h !== void 0 ? _h : true,
			strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== void 0 ? _j : s) !== null && _k !== void 0 ? _k : "log",
			strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== void 0 ? _l : s) !== null && _m !== void 0 ? _m : "log",
			strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== void 0 ? _o : s) !== null && _p !== void 0 ? _p : false,
			code: o.code ? {
				...o.code,
				optimize,
				regExp
			} : {
				optimize,
				regExp
			},
			loopRequired: (_q = o.loopRequired) !== null && _q !== void 0 ? _q : MAX_EXPRESSION,
			loopEnum: (_r = o.loopEnum) !== null && _r !== void 0 ? _r : MAX_EXPRESSION,
			meta: (_s = o.meta) !== null && _s !== void 0 ? _s : true,
			messages: (_t = o.messages) !== null && _t !== void 0 ? _t : true,
			inlineRefs: (_u = o.inlineRefs) !== null && _u !== void 0 ? _u : true,
			schemaId: (_v = o.schemaId) !== null && _v !== void 0 ? _v : "$id",
			addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== void 0 ? _w : true,
			validateSchema: (_x = o.validateSchema) !== null && _x !== void 0 ? _x : true,
			validateFormats: (_y = o.validateFormats) !== null && _y !== void 0 ? _y : true,
			unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== void 0 ? _z : true,
			int32range: (_0 = o.int32range) !== null && _0 !== void 0 ? _0 : true,
			uriResolver
		};
	}
	var Ajv = class {
		constructor(opts = {}) {
			this.schemas = {};
			this.refs = {};
			this.formats = Object.create(null);
			this._compilations = /* @__PURE__ */ new Set();
			this._loading = {};
			this._cache = /* @__PURE__ */ new Map();
			opts = this.opts = {
				...opts,
				...requiredOptions(opts)
			};
			const { es5, lines } = this.opts.code;
			this.scope = new codegen_2.ValueScope({
				scope: {},
				prefixes: EXT_SCOPE_NAMES,
				es5,
				lines
			});
			this.logger = getLogger(opts.logger);
			const formatOpt = opts.validateFormats;
			opts.validateFormats = false;
			this.RULES = (0, rules_1.getRules)();
			checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
			checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
			this._metaOpts = getMetaSchemaOptions.call(this);
			if (opts.formats) addInitialFormats.call(this);
			this._addVocabularies();
			this._addDefaultMetaSchema();
			if (opts.keywords) addInitialKeywords.call(this, opts.keywords);
			if (typeof opts.meta == "object") this.addMetaSchema(opts.meta);
			addInitialSchemas.call(this);
			opts.validateFormats = formatOpt;
		}
		_addVocabularies() {
			this.addKeyword("$async");
		}
		_addDefaultMetaSchema() {
			const { $data, meta, schemaId } = this.opts;
			let _dataRefSchema = $dataRefSchema;
			if (schemaId === "id") {
				_dataRefSchema = { ...$dataRefSchema };
				_dataRefSchema.id = _dataRefSchema.$id;
				delete _dataRefSchema.$id;
			}
			if (meta && $data) this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
		}
		defaultMeta() {
			const { meta, schemaId } = this.opts;
			return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : void 0;
		}
		validate(schemaKeyRef, data) {
			let v;
			if (typeof schemaKeyRef == "string") {
				v = this.getSchema(schemaKeyRef);
				if (!v) throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
			} else v = this.compile(schemaKeyRef);
			const valid = v(data);
			if (!("$async" in v)) this.errors = v.errors;
			return valid;
		}
		compile(schema, _meta) {
			const sch = this._addSchema(schema, _meta);
			return sch.validate || this._compileSchemaEnv(sch);
		}
		compileAsync(schema, meta) {
			if (typeof this.opts.loadSchema != "function") throw new Error("options.loadSchema should be a function");
			const { loadSchema } = this.opts;
			return runCompileAsync.call(this, schema, meta);
			async function runCompileAsync(_schema, _meta) {
				await loadMetaSchema.call(this, _schema.$schema);
				const sch = this._addSchema(_schema, _meta);
				return sch.validate || _compileAsync.call(this, sch);
			}
			async function loadMetaSchema($ref) {
				if ($ref && !this.getSchema($ref)) await runCompileAsync.call(this, { $ref }, true);
			}
			async function _compileAsync(sch) {
				try {
					return this._compileSchemaEnv(sch);
				} catch (e) {
					if (!(e instanceof ref_error_1.default)) throw e;
					checkLoaded.call(this, e);
					await loadMissingSchema.call(this, e.missingSchema);
					return _compileAsync.call(this, sch);
				}
			}
			function checkLoaded({ missingSchema: ref, missingRef }) {
				if (this.refs[ref]) throw new Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
			}
			async function loadMissingSchema(ref) {
				const _schema = await _loadSchema.call(this, ref);
				if (!this.refs[ref]) await loadMetaSchema.call(this, _schema.$schema);
				if (!this.refs[ref]) this.addSchema(_schema, ref, meta);
			}
			async function _loadSchema(ref) {
				const p = this._loading[ref];
				if (p) return p;
				try {
					return await (this._loading[ref] = loadSchema(ref));
				} finally {
					delete this._loading[ref];
				}
			}
		}
		addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
			if (Array.isArray(schema)) {
				for (const sch of schema) this.addSchema(sch, void 0, _meta, _validateSchema);
				return this;
			}
			let id;
			if (typeof schema === "object") {
				const { schemaId } = this.opts;
				id = schema[schemaId];
				if (id !== void 0 && typeof id != "string") throw new Error(`schema ${schemaId} must be string`);
			}
			key = (0, resolve_1.normalizeId)(key || id);
			this._checkUnique(key);
			this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
			return this;
		}
		addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
			this.addSchema(schema, key, true, _validateSchema);
			return this;
		}
		validateSchema(schema, throwOrLogError) {
			if (typeof schema == "boolean") return true;
			let $schema;
			$schema = schema.$schema;
			if ($schema !== void 0 && typeof $schema != "string") throw new Error("$schema must be a string");
			$schema = $schema || this.opts.defaultMeta || this.defaultMeta();
			if (!$schema) {
				this.logger.warn("meta-schema not available");
				this.errors = null;
				return true;
			}
			const valid = this.validate($schema, schema);
			if (!valid && throwOrLogError) {
				const message = "schema is invalid: " + this.errorsText();
				if (this.opts.validateSchema === "log") this.logger.error(message);
				else throw new Error(message);
			}
			return valid;
		}
		getSchema(keyRef) {
			let sch;
			while (typeof (sch = getSchEnv.call(this, keyRef)) == "string") keyRef = sch;
			if (sch === void 0) {
				const { schemaId } = this.opts;
				const root = new compile_1.SchemaEnv({
					schema: {},
					schemaId
				});
				sch = compile_1.resolveSchema.call(this, root, keyRef);
				if (!sch) return;
				this.refs[keyRef] = sch;
			}
			return sch.validate || this._compileSchemaEnv(sch);
		}
		removeSchema(schemaKeyRef) {
			if (schemaKeyRef instanceof RegExp) {
				this._removeAllSchemas(this.schemas, schemaKeyRef);
				this._removeAllSchemas(this.refs, schemaKeyRef);
				return this;
			}
			switch (typeof schemaKeyRef) {
				case "undefined":
					this._removeAllSchemas(this.schemas);
					this._removeAllSchemas(this.refs);
					this._cache.clear();
					return this;
				case "string": {
					const sch = getSchEnv.call(this, schemaKeyRef);
					if (typeof sch == "object") this._cache.delete(sch.schema);
					delete this.schemas[schemaKeyRef];
					delete this.refs[schemaKeyRef];
					return this;
				}
				case "object": {
					const cacheKey = schemaKeyRef;
					this._cache.delete(cacheKey);
					let id = schemaKeyRef[this.opts.schemaId];
					if (id) {
						id = (0, resolve_1.normalizeId)(id);
						delete this.schemas[id];
						delete this.refs[id];
					}
					return this;
				}
				default: throw new Error("ajv.removeSchema: invalid parameter");
			}
		}
		addVocabulary(definitions) {
			for (const def of definitions) this.addKeyword(def);
			return this;
		}
		addKeyword(kwdOrDef, def) {
			let keyword;
			if (typeof kwdOrDef == "string") {
				keyword = kwdOrDef;
				if (typeof def == "object") {
					this.logger.warn("these parameters are deprecated, see docs for addKeyword");
					def.keyword = keyword;
				}
			} else if (typeof kwdOrDef == "object" && def === void 0) {
				def = kwdOrDef;
				keyword = def.keyword;
				if (Array.isArray(keyword) && !keyword.length) throw new Error("addKeywords: keyword must be string or non-empty array");
			} else throw new Error("invalid addKeywords parameters");
			checkKeyword.call(this, keyword, def);
			if (!def) {
				(0, util_1.eachItem)(keyword, (kwd) => addRule.call(this, kwd));
				return this;
			}
			keywordMetaschema.call(this, def);
			const definition = {
				...def,
				type: (0, dataType_1.getJSONTypes)(def.type),
				schemaType: (0, dataType_1.getJSONTypes)(def.schemaType)
			};
			(0, util_1.eachItem)(keyword, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t)));
			return this;
		}
		getKeyword(keyword) {
			const rule = this.RULES.all[keyword];
			return typeof rule == "object" ? rule.definition : !!rule;
		}
		removeKeyword(keyword) {
			const { RULES } = this;
			delete RULES.keywords[keyword];
			delete RULES.all[keyword];
			for (const group of RULES.rules) {
				const i = group.rules.findIndex((rule) => rule.keyword === keyword);
				if (i >= 0) group.rules.splice(i, 1);
			}
			return this;
		}
		addFormat(name, format) {
			if (typeof format == "string") format = new RegExp(format);
			this.formats[name] = format;
			return this;
		}
		errorsText(errors = this.errors, { separator = ", ", dataVar = "data" } = {}) {
			if (!errors || errors.length === 0) return "No errors";
			return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
		}
		$dataMetaSchema(metaSchema, keywordsJsonPointers) {
			const rules = this.RULES.all;
			metaSchema = JSON.parse(JSON.stringify(metaSchema));
			for (const jsonPointer of keywordsJsonPointers) {
				const segments = jsonPointer.split("/").slice(1);
				let keywords = metaSchema;
				for (const seg of segments) keywords = keywords[seg];
				for (const key in rules) {
					const rule = rules[key];
					if (typeof rule != "object") continue;
					const { $data } = rule.definition;
					const schema = keywords[key];
					if ($data && schema) keywords[key] = schemaOrData(schema);
				}
			}
			return metaSchema;
		}
		_removeAllSchemas(schemas, regex) {
			for (const keyRef in schemas) {
				const sch = schemas[keyRef];
				if (!regex || regex.test(keyRef)) {
					if (typeof sch == "string") delete schemas[keyRef];
					else if (sch && !sch.meta) {
						this._cache.delete(sch.schema);
						delete schemas[keyRef];
					}
				}
			}
		}
		_addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
			let id;
			const { schemaId } = this.opts;
			if (typeof schema == "object") id = schema[schemaId];
			else if (this.opts.jtd) throw new Error("schema must be object");
			else if (typeof schema != "boolean") throw new Error("schema must be object or boolean");
			let sch = this._cache.get(schema);
			if (sch !== void 0) return sch;
			baseId = (0, resolve_1.normalizeId)(id || baseId);
			const localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
			sch = new compile_1.SchemaEnv({
				schema,
				schemaId,
				meta,
				baseId,
				localRefs
			});
			this._cache.set(sch.schema, sch);
			if (addSchema && !baseId.startsWith("#")) {
				if (baseId) this._checkUnique(baseId);
				this.refs[baseId] = sch;
			}
			if (validateSchema) this.validateSchema(schema, true);
			return sch;
		}
		_checkUnique(id) {
			if (this.schemas[id] || this.refs[id]) throw new Error(`schema with key or id "${id}" already exists`);
		}
		_compileSchemaEnv(sch) {
			if (sch.meta) this._compileMetaSchema(sch);
			else compile_1.compileSchema.call(this, sch);
			/* istanbul ignore if */
			if (!sch.validate) throw new Error("ajv implementation error");
			return sch.validate;
		}
		_compileMetaSchema(sch) {
			const currentOpts = this.opts;
			this.opts = this._metaOpts;
			try {
				compile_1.compileSchema.call(this, sch);
			} finally {
				this.opts = currentOpts;
			}
		}
	};
	Ajv.ValidationError = validation_error_1.default;
	Ajv.MissingRefError = ref_error_1.default;
	exports.default = Ajv;
	function checkOptions(checkOpts, options, msg, log = "error") {
		for (const key in checkOpts) {
			const opt = key;
			if (opt in options) this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
		}
	}
	function getSchEnv(keyRef) {
		keyRef = (0, resolve_1.normalizeId)(keyRef);
		return this.schemas[keyRef] || this.refs[keyRef];
	}
	function addInitialSchemas() {
		const optsSchemas = this.opts.schemas;
		if (!optsSchemas) return;
		if (Array.isArray(optsSchemas)) this.addSchema(optsSchemas);
		else for (const key in optsSchemas) this.addSchema(optsSchemas[key], key);
	}
	function addInitialFormats() {
		for (const name in this.opts.formats) {
			const format = this.opts.formats[name];
			if (format) this.addFormat(name, format);
		}
	}
	function addInitialKeywords(defs) {
		if (Array.isArray(defs)) {
			this.addVocabulary(defs);
			return;
		}
		this.logger.warn("keywords option as map is deprecated, pass array");
		for (const keyword in defs) {
			const def = defs[keyword];
			if (!def.keyword) def.keyword = keyword;
			this.addKeyword(def);
		}
	}
	function getMetaSchemaOptions() {
		const metaOpts = { ...this.opts };
		for (const opt of META_IGNORE_OPTIONS) delete metaOpts[opt];
		return metaOpts;
	}
	const noLogs = {
		log() {},
		warn() {},
		error() {}
	};
	function getLogger(logger) {
		if (logger === false) return noLogs;
		if (logger === void 0) return console;
		if (logger.log && logger.warn && logger.error) return logger;
		throw new Error("logger must implement log, warn and error methods");
	}
	const KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
	function checkKeyword(keyword, def) {
		const { RULES } = this;
		(0, util_1.eachItem)(keyword, (kwd) => {
			if (RULES.keywords[kwd]) throw new Error(`Keyword ${kwd} is already defined`);
			if (!KEYWORD_NAME.test(kwd)) throw new Error(`Keyword ${kwd} has invalid name`);
		});
		if (!def) return;
		if (def.$data && !("code" in def || "validate" in def)) throw new Error("$data keyword must have \"code\" or \"validate\" function");
	}
	function addRule(keyword, definition, dataType) {
		var _a;
		const post = definition === null || definition === void 0 ? void 0 : definition.post;
		if (dataType && post) throw new Error("keyword with \"post\" flag cannot have \"type\"");
		const { RULES } = this;
		let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
		if (!ruleGroup) {
			ruleGroup = {
				type: dataType,
				rules: []
			};
			RULES.rules.push(ruleGroup);
		}
		RULES.keywords[keyword] = true;
		if (!definition) return;
		const rule = {
			keyword,
			definition: {
				...definition,
				type: (0, dataType_1.getJSONTypes)(definition.type),
				schemaType: (0, dataType_1.getJSONTypes)(definition.schemaType)
			}
		};
		if (definition.before) addBeforeRule.call(this, ruleGroup, rule, definition.before);
		else ruleGroup.rules.push(rule);
		RULES.all[keyword] = rule;
		(_a = definition.implements) === null || _a === void 0 || _a.forEach((kwd) => this.addKeyword(kwd));
	}
	function addBeforeRule(ruleGroup, rule, before) {
		const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
		if (i >= 0) ruleGroup.rules.splice(i, 0, rule);
		else {
			ruleGroup.rules.push(rule);
			this.logger.warn(`rule ${before} is not defined`);
		}
	}
	function keywordMetaschema(def) {
		let { metaSchema } = def;
		if (metaSchema === void 0) return;
		if (def.$data && this.opts.$data) metaSchema = schemaOrData(metaSchema);
		def.validateSchema = this.compile(metaSchema, true);
	}
	const $dataRef = { $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#" };
	function schemaOrData(schema) {
		return { anyOf: [schema, $dataRef] };
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/id.js
var require_id = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.default = {
		keyword: "id",
		code() {
			throw new Error("NOT SUPPORTED: keyword \"id\", use \"$id\" for schema ID");
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.callRef = exports.getValidate = void 0;
	const ref_error_1 = require_ref_error();
	const code_1 = require_code();
	const codegen_1 = require_codegen();
	const names_1 = require_names();
	const compile_1 = require_compile();
	const util_1 = require_util();
	const def = {
		keyword: "$ref",
		schemaType: "string",
		code(cxt) {
			const { gen, schema: $ref, it } = cxt;
			const { baseId, schemaEnv: env, validateName, opts, self } = it;
			const { root } = env;
			if (($ref === "#" || $ref === "#/") && baseId === root.baseId) return callRootRef();
			const schOrEnv = compile_1.resolveRef.call(self, root, baseId, $ref);
			if (schOrEnv === void 0) throw new ref_error_1.default(it.opts.uriResolver, baseId, $ref);
			if (schOrEnv instanceof compile_1.SchemaEnv) return callValidate(schOrEnv);
			return inlineRefSchema(schOrEnv);
			function callRootRef() {
				if (env === root) return callRef(cxt, validateName, env, env.$async);
				const rootName = gen.scopeValue("root", { ref: root });
				return callRef(cxt, (0, codegen_1._)`${rootName}.validate`, root, root.$async);
			}
			function callValidate(sch) {
				callRef(cxt, getValidate(cxt, sch), sch, sch.$async);
			}
			function inlineRefSchema(sch) {
				const schName = gen.scopeValue("schema", opts.code.source === true ? {
					ref: sch,
					code: (0, codegen_1.stringify)(sch)
				} : { ref: sch });
				const valid = gen.name("valid");
				const schCxt = cxt.subschema({
					schema: sch,
					dataTypes: [],
					schemaPath: codegen_1.nil,
					topSchemaRef: schName,
					errSchemaPath: $ref
				}, valid);
				cxt.mergeEvaluated(schCxt);
				cxt.ok(valid);
			}
		}
	};
	function getValidate(cxt, sch) {
		const { gen } = cxt;
		return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : (0, codegen_1._)`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
	}
	exports.getValidate = getValidate;
	function callRef(cxt, v, sch, $async) {
		const { gen, it } = cxt;
		const { allErrors, schemaEnv: env, opts } = it;
		const passCxt = opts.passContext ? names_1.default.this : codegen_1.nil;
		if ($async) callAsyncRef();
		else callSyncRef();
		function callAsyncRef() {
			if (!env.$async) throw new Error("async schema referenced by sync schema");
			const valid = gen.let("valid");
			gen.try(() => {
				gen.code((0, codegen_1._)`await ${(0, code_1.callValidateCode)(cxt, v, passCxt)}`);
				addEvaluatedFrom(v);
				if (!allErrors) gen.assign(valid, true);
			}, (e) => {
				gen.if((0, codegen_1._)`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
				addErrorsFrom(e);
				if (!allErrors) gen.assign(valid, false);
			});
			cxt.ok(valid);
		}
		function callSyncRef() {
			cxt.result((0, code_1.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
		}
		function addErrorsFrom(source) {
			const errs = (0, codegen_1._)`${source}.errors`;
			gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`);
			gen.assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
		}
		function addEvaluatedFrom(source) {
			var _a;
			if (!it.opts.unevaluated) return;
			const schEvaluated = (_a = sch === null || sch === void 0 ? void 0 : sch.validate) === null || _a === void 0 ? void 0 : _a.evaluated;
			if (it.props !== true) if (schEvaluated && !schEvaluated.dynamicProps) {
				if (schEvaluated.props !== void 0) it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
			} else {
				const props = gen.var("props", (0, codegen_1._)`${source}.evaluated.props`);
				it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
			}
			if (it.items !== true) if (schEvaluated && !schEvaluated.dynamicItems) {
				if (schEvaluated.items !== void 0) it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
			} else {
				const items = gen.var("items", (0, codegen_1._)`${source}.evaluated.items`);
				it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
			}
		}
	}
	exports.callRef = callRef;
	exports.default = def;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/core/index.js
var require_core$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const id_1 = require_id();
	const ref_1 = require_ref();
	exports.default = [
		"$schema",
		"$id",
		"$defs",
		"$vocabulary",
		{ keyword: "$comment" },
		"definitions",
		id_1.default,
		ref_1.default
	];
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const ops = codegen_1.operators;
	const KWDs = {
		maximum: {
			okStr: "<=",
			ok: ops.LTE,
			fail: ops.GT
		},
		minimum: {
			okStr: ">=",
			ok: ops.GTE,
			fail: ops.LT
		},
		exclusiveMaximum: {
			okStr: "<",
			ok: ops.LT,
			fail: ops.GTE
		},
		exclusiveMinimum: {
			okStr: ">",
			ok: ops.GT,
			fail: ops.LTE
		}
	};
	exports.default = {
		keyword: Object.keys(KWDs),
		type: "number",
		schemaType: "number",
		$data: true,
		error: {
			message: ({ keyword, schemaCode }) => (0, codegen_1.str)`must be ${KWDs[keyword].okStr} ${schemaCode}`,
			params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
		},
		code(cxt) {
			const { keyword, data, schemaCode } = cxt;
			cxt.fail$data((0, codegen_1._)`${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	exports.default = {
		keyword: "multipleOf",
		type: "number",
		schemaType: "number",
		$data: true,
		error: {
			message: ({ schemaCode }) => (0, codegen_1.str)`must be multiple of ${schemaCode}`,
			params: ({ schemaCode }) => (0, codegen_1._)`{multipleOf: ${schemaCode}}`
		},
		code(cxt) {
			const { gen, data, schemaCode, it } = cxt;
			const prec = it.opts.multipleOfPrecision;
			const res = gen.let("res");
			const invalid = prec ? (0, codegen_1._)`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : (0, codegen_1._)`${res} !== parseInt(${res})`;
			cxt.fail$data((0, codegen_1._)`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	function ucs2length(str) {
		const len = str.length;
		let length = 0;
		let pos = 0;
		let value;
		while (pos < len) {
			length++;
			value = str.charCodeAt(pos++);
			if (value >= 55296 && value <= 56319 && pos < len) {
				value = str.charCodeAt(pos);
				if ((value & 64512) === 56320) pos++;
			}
		}
		return length;
	}
	exports.default = ucs2length;
	ucs2length.code = "require(\"ajv/dist/runtime/ucs2length\").default";
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const ucs2length_1 = require_ucs2length();
	exports.default = {
		keyword: ["maxLength", "minLength"],
		type: "string",
		schemaType: "number",
		$data: true,
		error: {
			message({ keyword, schemaCode }) {
				const comp = keyword === "maxLength" ? "more" : "fewer";
				return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} characters`;
			},
			params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
		},
		code(cxt) {
			const { keyword, data, schemaCode, it } = cxt;
			const op = keyword === "maxLength" ? codegen_1.operators.GT : codegen_1.operators.LT;
			const len = it.opts.unicode === false ? (0, codegen_1._)`${data}.length` : (0, codegen_1._)`${(0, util_1.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
			cxt.fail$data((0, codegen_1._)`${len} ${op} ${schemaCode}`);
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const code_1 = require_code();
	const util_1 = require_util();
	const codegen_1 = require_codegen();
	exports.default = {
		keyword: "pattern",
		type: "string",
		schemaType: "string",
		$data: true,
		error: {
			message: ({ schemaCode }) => (0, codegen_1.str)`must match pattern "${schemaCode}"`,
			params: ({ schemaCode }) => (0, codegen_1._)`{pattern: ${schemaCode}}`
		},
		code(cxt) {
			const { gen, data, $data, schema, schemaCode, it } = cxt;
			const u = it.opts.unicodeRegExp ? "u" : "";
			if ($data) {
				const { regExp } = it.opts.code;
				const regExpCode = regExp.code === "new RegExp" ? (0, codegen_1._)`new RegExp` : (0, util_1.useFunc)(gen, regExp);
				const valid = gen.let("valid");
				gen.try(() => gen.assign(valid, (0, codegen_1._)`${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, false));
				cxt.fail$data((0, codegen_1._)`!${valid}`);
			} else {
				const regExp = (0, code_1.usePattern)(cxt, schema);
				cxt.fail$data((0, codegen_1._)`!${regExp}.test(${data})`);
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	exports.default = {
		keyword: ["maxProperties", "minProperties"],
		type: "object",
		schemaType: "number",
		$data: true,
		error: {
			message({ keyword, schemaCode }) {
				const comp = keyword === "maxProperties" ? "more" : "fewer";
				return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} properties`;
			},
			params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
		},
		code(cxt) {
			const { keyword, data, schemaCode } = cxt;
			const op = keyword === "maxProperties" ? codegen_1.operators.GT : codegen_1.operators.LT;
			cxt.fail$data((0, codegen_1._)`Object.keys(${data}).length ${op} ${schemaCode}`);
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const code_1 = require_code();
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	exports.default = {
		keyword: "required",
		type: "object",
		schemaType: "array",
		$data: true,
		error: {
			message: ({ params: { missingProperty } }) => (0, codegen_1.str)`must have required property '${missingProperty}'`,
			params: ({ params: { missingProperty } }) => (0, codegen_1._)`{missingProperty: ${missingProperty}}`
		},
		code(cxt) {
			const { gen, schema, schemaCode, data, $data, it } = cxt;
			const { opts } = it;
			if (!$data && schema.length === 0) return;
			const useLoop = schema.length >= opts.loopRequired;
			if (it.allErrors) allErrorsMode();
			else exitOnErrorMode();
			if (opts.strictRequired) {
				const props = cxt.parentSchema.properties;
				const { definedProperties } = cxt.it;
				for (const requiredKey of schema) if ((props === null || props === void 0 ? void 0 : props[requiredKey]) === void 0 && !definedProperties.has(requiredKey)) {
					const msg = `required property "${requiredKey}" is not defined at "${it.schemaEnv.baseId + it.errSchemaPath}" (strictRequired)`;
					(0, util_1.checkStrictMode)(it, msg, it.opts.strictRequired);
				}
			}
			function allErrorsMode() {
				if (useLoop || $data) cxt.block$data(codegen_1.nil, loopAllRequired);
				else for (const prop of schema) (0, code_1.checkReportMissingProp)(cxt, prop);
			}
			function exitOnErrorMode() {
				const missing = gen.let("missing");
				if (useLoop || $data) {
					const valid = gen.let("valid", true);
					cxt.block$data(valid, () => loopUntilMissing(missing, valid));
					cxt.ok(valid);
				} else {
					gen.if((0, code_1.checkMissingProp)(cxt, schema, missing));
					(0, code_1.reportMissingProp)(cxt, missing);
					gen.else();
				}
			}
			function loopAllRequired() {
				gen.forOf("prop", schemaCode, (prop) => {
					cxt.setParams({ missingProperty: prop });
					gen.if((0, code_1.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
				});
			}
			function loopUntilMissing(missing, valid) {
				cxt.setParams({ missingProperty: missing });
				gen.forOf(missing, schemaCode, () => {
					gen.assign(valid, (0, code_1.propertyInData)(gen, data, missing, opts.ownProperties));
					gen.if((0, codegen_1.not)(valid), () => {
						cxt.error();
						gen.break();
					});
				}, codegen_1.nil);
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	exports.default = {
		keyword: ["maxItems", "minItems"],
		type: "array",
		schemaType: "number",
		$data: true,
		error: {
			message({ keyword, schemaCode }) {
				const comp = keyword === "maxItems" ? "more" : "fewer";
				return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} items`;
			},
			params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
		},
		code(cxt) {
			const { keyword, data, schemaCode } = cxt;
			const op = keyword === "maxItems" ? codegen_1.operators.GT : codegen_1.operators.LT;
			cxt.fail$data((0, codegen_1._)`${data}.length ${op} ${schemaCode}`);
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/equal.js
var require_equal = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const equal = require_fast_deep_equal();
	equal.code = "require(\"ajv/dist/runtime/equal\").default";
	exports.default = equal;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const dataType_1 = require_dataType();
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const equal_1 = require_equal();
	exports.default = {
		keyword: "uniqueItems",
		type: "array",
		schemaType: "boolean",
		$data: true,
		error: {
			message: ({ params: { i, j } }) => (0, codegen_1.str)`must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
			params: ({ params: { i, j } }) => (0, codegen_1._)`{i: ${i}, j: ${j}}`
		},
		code(cxt) {
			const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
			if (!$data && !schema) return;
			const valid = gen.let("valid");
			const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
			cxt.block$data(valid, validateUniqueItems, (0, codegen_1._)`${schemaCode} === false`);
			cxt.ok(valid);
			function validateUniqueItems() {
				const i = gen.let("i", (0, codegen_1._)`${data}.length`);
				const j = gen.let("j");
				cxt.setParams({
					i,
					j
				});
				gen.assign(valid, true);
				gen.if((0, codegen_1._)`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
			}
			function canOptimize() {
				return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
			}
			function loopN(i, j) {
				const item = gen.name("item");
				const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
				const indices = gen.const("indices", (0, codegen_1._)`{}`);
				gen.for((0, codegen_1._)`;${i}--;`, () => {
					gen.let(item, (0, codegen_1._)`${data}[${i}]`);
					gen.if(wrongType, (0, codegen_1._)`continue`);
					if (itemTypes.length > 1) gen.if((0, codegen_1._)`typeof ${item} == "string"`, (0, codegen_1._)`${item} += "_"`);
					gen.if((0, codegen_1._)`typeof ${indices}[${item}] == "number"`, () => {
						gen.assign(j, (0, codegen_1._)`${indices}[${item}]`);
						cxt.error();
						gen.assign(valid, false).break();
					}).code((0, codegen_1._)`${indices}[${item}] = ${i}`);
				});
			}
			function loopN2(i, j) {
				const eql = (0, util_1.useFunc)(gen, equal_1.default);
				const outer = gen.name("outer");
				gen.label(outer).for((0, codegen_1._)`;${i}--;`, () => gen.for((0, codegen_1._)`${j} = ${i}; ${j}--;`, () => gen.if((0, codegen_1._)`${eql}(${data}[${i}], ${data}[${j}])`, () => {
					cxt.error();
					gen.assign(valid, false).break(outer);
				})));
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const equal_1 = require_equal();
	exports.default = {
		keyword: "const",
		$data: true,
		error: {
			message: "must be equal to constant",
			params: ({ schemaCode }) => (0, codegen_1._)`{allowedValue: ${schemaCode}}`
		},
		code(cxt) {
			const { gen, data, $data, schemaCode, schema } = cxt;
			if ($data || schema && typeof schema == "object") cxt.fail$data((0, codegen_1._)`!${(0, util_1.useFunc)(gen, equal_1.default)}(${data}, ${schemaCode})`);
			else cxt.fail((0, codegen_1._)`${schema} !== ${data}`);
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const equal_1 = require_equal();
	exports.default = {
		keyword: "enum",
		schemaType: "array",
		$data: true,
		error: {
			message: "must be equal to one of the allowed values",
			params: ({ schemaCode }) => (0, codegen_1._)`{allowedValues: ${schemaCode}}`
		},
		code(cxt) {
			const { gen, data, $data, schema, schemaCode, it } = cxt;
			if (!$data && schema.length === 0) throw new Error("enum must have non-empty array");
			const useLoop = schema.length >= it.opts.loopEnum;
			let eql;
			const getEql = () => eql !== null && eql !== void 0 ? eql : eql = (0, util_1.useFunc)(gen, equal_1.default);
			let valid;
			if (useLoop || $data) {
				valid = gen.let("valid");
				cxt.block$data(valid, loopEnum);
			} else {
				/* istanbul ignore if */
				if (!Array.isArray(schema)) throw new Error("ajv implementation error");
				const vSchema = gen.const("vSchema", schemaCode);
				valid = (0, codegen_1.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
			}
			cxt.pass(valid);
			function loopEnum() {
				gen.assign(valid, false);
				gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1._)`${getEql()}(${data}, ${v})`, () => gen.assign(valid, true).break()));
			}
			function equalCode(vSchema, i) {
				const sch = schema[i];
				return typeof sch === "object" && sch !== null ? (0, codegen_1._)`${getEql()}(${data}, ${vSchema}[${i}])` : (0, codegen_1._)`${data} === ${sch}`;
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const limitNumber_1 = require_limitNumber();
	const multipleOf_1 = require_multipleOf();
	const limitLength_1 = require_limitLength();
	const pattern_1 = require_pattern();
	const limitProperties_1 = require_limitProperties();
	const required_1 = require_required();
	const limitItems_1 = require_limitItems();
	const uniqueItems_1 = require_uniqueItems();
	const const_1 = require_const();
	const enum_1 = require_enum();
	exports.default = [
		limitNumber_1.default,
		multipleOf_1.default,
		limitLength_1.default,
		pattern_1.default,
		limitProperties_1.default,
		required_1.default,
		limitItems_1.default,
		uniqueItems_1.default,
		{
			keyword: "type",
			schemaType: ["string", "array"]
		},
		{
			keyword: "nullable",
			schemaType: "boolean"
		},
		const_1.default,
		enum_1.default
	];
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.validateAdditionalItems = void 0;
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const def = {
		keyword: "additionalItems",
		type: "array",
		schemaType: ["boolean", "object"],
		before: "uniqueItems",
		error: {
			message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
			params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
		},
		code(cxt) {
			const { parentSchema, it } = cxt;
			const { items } = parentSchema;
			if (!Array.isArray(items)) {
				(0, util_1.checkStrictMode)(it, "\"additionalItems\" is ignored when \"items\" is not an array of schemas");
				return;
			}
			validateAdditionalItems(cxt, items);
		}
	};
	function validateAdditionalItems(cxt, items) {
		const { gen, schema, data, keyword, it } = cxt;
		it.items = true;
		const len = gen.const("len", (0, codegen_1._)`${data}.length`);
		if (schema === false) {
			cxt.setParams({ len: items.length });
			cxt.pass((0, codegen_1._)`${len} <= ${items.length}`);
		} else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
			const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items.length}`);
			gen.if((0, codegen_1.not)(valid), () => validateItems(valid));
			cxt.ok(valid);
		}
		function validateItems(valid) {
			gen.forRange("i", items.length, len, (i) => {
				cxt.subschema({
					keyword,
					dataProp: i,
					dataPropType: util_1.Type.Num
				}, valid);
				if (!it.allErrors) gen.if((0, codegen_1.not)(valid), () => gen.break());
			});
		}
	}
	exports.validateAdditionalItems = validateAdditionalItems;
	exports.default = def;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.validateTuple = void 0;
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const code_1 = require_code();
	const def = {
		keyword: "items",
		type: "array",
		schemaType: [
			"object",
			"array",
			"boolean"
		],
		before: "uniqueItems",
		code(cxt) {
			const { schema, it } = cxt;
			if (Array.isArray(schema)) return validateTuple(cxt, "additionalItems", schema);
			it.items = true;
			if ((0, util_1.alwaysValidSchema)(it, schema)) return;
			cxt.ok((0, code_1.validateArray)(cxt));
		}
	};
	function validateTuple(cxt, extraItems, schArr = cxt.schema) {
		const { gen, parentSchema, data, keyword, it } = cxt;
		checkStrictTuple(parentSchema);
		if (it.opts.unevaluated && schArr.length && it.items !== true) it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
		const valid = gen.name("valid");
		const len = gen.const("len", (0, codegen_1._)`${data}.length`);
		schArr.forEach((sch, i) => {
			if ((0, util_1.alwaysValidSchema)(it, sch)) return;
			gen.if((0, codegen_1._)`${len} > ${i}`, () => cxt.subschema({
				keyword,
				schemaProp: i,
				dataProp: i
			}, valid));
			cxt.ok(valid);
		});
		function checkStrictTuple(sch) {
			const { opts, errSchemaPath } = it;
			const l = schArr.length;
			const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
			if (opts.strictTuples && !fullTuple) {
				const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
				(0, util_1.checkStrictMode)(it, msg, opts.strictTuples);
			}
		}
	}
	exports.validateTuple = validateTuple;
	exports.default = def;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const items_1 = require_items();
	exports.default = {
		keyword: "prefixItems",
		type: "array",
		schemaType: ["array"],
		before: "uniqueItems",
		code: (cxt) => (0, items_1.validateTuple)(cxt, "items")
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const code_1 = require_code();
	const additionalItems_1 = require_additionalItems();
	exports.default = {
		keyword: "items",
		type: "array",
		schemaType: ["object", "boolean"],
		before: "uniqueItems",
		error: {
			message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
			params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
		},
		code(cxt) {
			const { schema, parentSchema, it } = cxt;
			const { prefixItems } = parentSchema;
			it.items = true;
			if ((0, util_1.alwaysValidSchema)(it, schema)) return;
			if (prefixItems) (0, additionalItems_1.validateAdditionalItems)(cxt, prefixItems);
			else cxt.ok((0, code_1.validateArray)(cxt));
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	exports.default = {
		keyword: "contains",
		type: "array",
		schemaType: ["object", "boolean"],
		before: "uniqueItems",
		trackErrors: true,
		error: {
			message: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1.str)`must contain at least ${min} valid item(s)` : (0, codegen_1.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
			params: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1._)`{minContains: ${min}}` : (0, codegen_1._)`{minContains: ${min}, maxContains: ${max}}`
		},
		code(cxt) {
			const { gen, schema, parentSchema, data, it } = cxt;
			let min;
			let max;
			const { minContains, maxContains } = parentSchema;
			if (it.opts.next) {
				min = minContains === void 0 ? 1 : minContains;
				max = maxContains;
			} else min = 1;
			const len = gen.const("len", (0, codegen_1._)`${data}.length`);
			cxt.setParams({
				min,
				max
			});
			if (max === void 0 && min === 0) {
				(0, util_1.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
				return;
			}
			if (max !== void 0 && min > max) {
				(0, util_1.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
				cxt.fail();
				return;
			}
			if ((0, util_1.alwaysValidSchema)(it, schema)) {
				let cond = (0, codegen_1._)`${len} >= ${min}`;
				if (max !== void 0) cond = (0, codegen_1._)`${cond} && ${len} <= ${max}`;
				cxt.pass(cond);
				return;
			}
			it.items = true;
			const valid = gen.name("valid");
			if (max === void 0 && min === 1) validateItems(valid, () => gen.if(valid, () => gen.break()));
			else if (min === 0) {
				gen.let(valid, true);
				if (max !== void 0) gen.if((0, codegen_1._)`${data}.length > 0`, validateItemsWithCount);
			} else {
				gen.let(valid, false);
				validateItemsWithCount();
			}
			cxt.result(valid, () => cxt.reset());
			function validateItemsWithCount() {
				const schValid = gen.name("_valid");
				const count = gen.let("count", 0);
				validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
			}
			function validateItems(_valid, block) {
				gen.forRange("i", 0, len, (i) => {
					cxt.subschema({
						keyword: "contains",
						dataProp: i,
						dataPropType: util_1.Type.Num,
						compositeRule: true
					}, _valid);
					block();
				});
			}
			function checkLimits(count) {
				gen.code((0, codegen_1._)`${count}++`);
				if (max === void 0) gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true).break());
				else {
					gen.if((0, codegen_1._)`${count} > ${max}`, () => gen.assign(valid, false).break());
					if (min === 1) gen.assign(valid, true);
					else gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true));
				}
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.validateSchemaDeps = exports.validatePropertyDeps = exports.error = void 0;
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const code_1 = require_code();
	exports.error = {
		message: ({ params: { property, depsCount, deps } }) => {
			const property_ies = depsCount === 1 ? "property" : "properties";
			return (0, codegen_1.str)`must have ${property_ies} ${deps} when property ${property} is present`;
		},
		params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
	};
	const def = {
		keyword: "dependencies",
		type: "object",
		schemaType: "object",
		error: exports.error,
		code(cxt) {
			const [propDeps, schDeps] = splitDependencies(cxt);
			validatePropertyDeps(cxt, propDeps);
			validateSchemaDeps(cxt, schDeps);
		}
	};
	function splitDependencies({ schema }) {
		const propertyDeps = {};
		const schemaDeps = {};
		for (const key in schema) {
			if (key === "__proto__") continue;
			const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
			deps[key] = schema[key];
		}
		return [propertyDeps, schemaDeps];
	}
	function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
		const { gen, data, it } = cxt;
		if (Object.keys(propertyDeps).length === 0) return;
		const missing = gen.let("missing");
		for (const prop in propertyDeps) {
			const deps = propertyDeps[prop];
			if (deps.length === 0) continue;
			const hasProperty = (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties);
			cxt.setParams({
				property: prop,
				depsCount: deps.length,
				deps: deps.join(", ")
			});
			if (it.allErrors) gen.if(hasProperty, () => {
				for (const depProp of deps) (0, code_1.checkReportMissingProp)(cxt, depProp);
			});
			else {
				gen.if((0, codegen_1._)`${hasProperty} && (${(0, code_1.checkMissingProp)(cxt, deps, missing)})`);
				(0, code_1.reportMissingProp)(cxt, missing);
				gen.else();
			}
		}
	}
	exports.validatePropertyDeps = validatePropertyDeps;
	function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
		const { gen, data, keyword, it } = cxt;
		const valid = gen.name("valid");
		for (const prop in schemaDeps) {
			if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop])) continue;
			gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties), () => {
				const schCxt = cxt.subschema({
					keyword,
					schemaProp: prop
				}, valid);
				cxt.mergeValidEvaluated(schCxt, valid);
			}, () => gen.var(valid, true));
			cxt.ok(valid);
		}
	}
	exports.validateSchemaDeps = validateSchemaDeps;
	exports.default = def;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	exports.default = {
		keyword: "propertyNames",
		type: "object",
		schemaType: ["object", "boolean"],
		error: {
			message: "property name must be valid",
			params: ({ params }) => (0, codegen_1._)`{propertyName: ${params.propertyName}}`
		},
		code(cxt) {
			const { gen, schema, data, it } = cxt;
			if ((0, util_1.alwaysValidSchema)(it, schema)) return;
			const valid = gen.name("valid");
			gen.forIn("key", data, (key) => {
				cxt.setParams({ propertyName: key });
				cxt.subschema({
					keyword: "propertyNames",
					data: key,
					dataTypes: ["string"],
					propertyName: key,
					compositeRule: true
				}, valid);
				gen.if((0, codegen_1.not)(valid), () => {
					cxt.error(true);
					if (!it.allErrors) gen.break();
				});
			});
			cxt.ok(valid);
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const code_1 = require_code();
	const codegen_1 = require_codegen();
	const names_1 = require_names();
	const util_1 = require_util();
	exports.default = {
		keyword: "additionalProperties",
		type: ["object"],
		schemaType: ["boolean", "object"],
		allowUndefined: true,
		trackErrors: true,
		error: {
			message: "must NOT have additional properties",
			params: ({ params }) => (0, codegen_1._)`{additionalProperty: ${params.additionalProperty}}`
		},
		code(cxt) {
			const { gen, schema, parentSchema, data, errsCount, it } = cxt;
			/* istanbul ignore if */
			if (!errsCount) throw new Error("ajv implementation error");
			const { allErrors, opts } = it;
			it.props = true;
			if (opts.removeAdditional !== "all" && (0, util_1.alwaysValidSchema)(it, schema)) return;
			const props = (0, code_1.allSchemaProperties)(parentSchema.properties);
			const patProps = (0, code_1.allSchemaProperties)(parentSchema.patternProperties);
			checkAdditionalProperties();
			cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
			function checkAdditionalProperties() {
				gen.forIn("key", data, (key) => {
					if (!props.length && !patProps.length) additionalPropertyCode(key);
					else gen.if(isAdditional(key), () => additionalPropertyCode(key));
				});
			}
			function isAdditional(key) {
				let definedProp;
				if (props.length > 8) {
					const propsSchema = (0, util_1.schemaRefOrVal)(it, parentSchema.properties, "properties");
					definedProp = (0, code_1.isOwnProperty)(gen, propsSchema, key);
				} else if (props.length) definedProp = (0, codegen_1.or)(...props.map((p) => (0, codegen_1._)`${key} === ${p}`));
				else definedProp = codegen_1.nil;
				if (patProps.length) definedProp = (0, codegen_1.or)(definedProp, ...patProps.map((p) => (0, codegen_1._)`${(0, code_1.usePattern)(cxt, p)}.test(${key})`));
				return (0, codegen_1.not)(definedProp);
			}
			function deleteAdditional(key) {
				gen.code((0, codegen_1._)`delete ${data}[${key}]`);
			}
			function additionalPropertyCode(key) {
				if (opts.removeAdditional === "all" || opts.removeAdditional && schema === false) {
					deleteAdditional(key);
					return;
				}
				if (schema === false) {
					cxt.setParams({ additionalProperty: key });
					cxt.error();
					if (!allErrors) gen.break();
					return;
				}
				if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
					const valid = gen.name("valid");
					if (opts.removeAdditional === "failing") {
						applyAdditionalSchema(key, valid, false);
						gen.if((0, codegen_1.not)(valid), () => {
							cxt.reset();
							deleteAdditional(key);
						});
					} else {
						applyAdditionalSchema(key, valid);
						if (!allErrors) gen.if((0, codegen_1.not)(valid), () => gen.break());
					}
				}
			}
			function applyAdditionalSchema(key, valid, errors) {
				const subschema = {
					keyword: "additionalProperties",
					dataProp: key,
					dataPropType: util_1.Type.Str
				};
				if (errors === false) Object.assign(subschema, {
					compositeRule: true,
					createErrors: false,
					allErrors: false
				});
				cxt.subschema(subschema, valid);
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const validate_1 = require_validate();
	const code_1 = require_code();
	const util_1 = require_util();
	const additionalProperties_1 = require_additionalProperties();
	exports.default = {
		keyword: "properties",
		type: "object",
		schemaType: "object",
		code(cxt) {
			const { gen, schema, parentSchema, data, it } = cxt;
			if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === void 0) additionalProperties_1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1.default, "additionalProperties"));
			const allProps = (0, code_1.allSchemaProperties)(schema);
			for (const prop of allProps) it.definedProperties.add(prop);
			if (it.opts.unevaluated && allProps.length && it.props !== true) it.props = util_1.mergeEvaluated.props(gen, (0, util_1.toHash)(allProps), it.props);
			const properties = allProps.filter((p) => !(0, util_1.alwaysValidSchema)(it, schema[p]));
			if (properties.length === 0) return;
			const valid = gen.name("valid");
			for (const prop of properties) {
				if (hasDefault(prop)) applyPropertySchema(prop);
				else {
					gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties));
					applyPropertySchema(prop);
					if (!it.allErrors) gen.else().var(valid, true);
					gen.endIf();
				}
				cxt.it.definedProperties.add(prop);
				cxt.ok(valid);
			}
			function hasDefault(prop) {
				return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== void 0;
			}
			function applyPropertySchema(prop) {
				cxt.subschema({
					keyword: "properties",
					schemaProp: prop,
					dataProp: prop
				}, valid);
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const code_1 = require_code();
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const util_2 = require_util();
	exports.default = {
		keyword: "patternProperties",
		type: "object",
		schemaType: "object",
		code(cxt) {
			const { gen, schema, data, parentSchema, it } = cxt;
			const { opts } = it;
			const patterns = (0, code_1.allSchemaProperties)(schema);
			const alwaysValidPatterns = patterns.filter((p) => (0, util_1.alwaysValidSchema)(it, schema[p]));
			if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === true)) return;
			const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
			const valid = gen.name("valid");
			if (it.props !== true && !(it.props instanceof codegen_1.Name)) it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
			const { props } = it;
			validatePatternProperties();
			function validatePatternProperties() {
				for (const pat of patterns) {
					if (checkProperties) checkMatchingProperties(pat);
					if (it.allErrors) validateProperties(pat);
					else {
						gen.var(valid, true);
						validateProperties(pat);
						gen.if(valid);
					}
				}
			}
			function checkMatchingProperties(pat) {
				for (const prop in checkProperties) if (new RegExp(pat).test(prop)) (0, util_1.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
			}
			function validateProperties(pat) {
				gen.forIn("key", data, (key) => {
					gen.if((0, codegen_1._)`${(0, code_1.usePattern)(cxt, pat)}.test(${key})`, () => {
						const alwaysValid = alwaysValidPatterns.includes(pat);
						if (!alwaysValid) cxt.subschema({
							keyword: "patternProperties",
							schemaProp: pat,
							dataProp: key,
							dataPropType: util_2.Type.Str
						}, valid);
						if (it.opts.unevaluated && props !== true) gen.assign((0, codegen_1._)`${props}[${key}]`, true);
						else if (!alwaysValid && !it.allErrors) gen.if((0, codegen_1.not)(valid), () => gen.break());
					});
				});
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const util_1 = require_util();
	exports.default = {
		keyword: "not",
		schemaType: ["object", "boolean"],
		trackErrors: true,
		code(cxt) {
			const { gen, schema, it } = cxt;
			if ((0, util_1.alwaysValidSchema)(it, schema)) {
				cxt.fail();
				return;
			}
			const valid = gen.name("valid");
			cxt.subschema({
				keyword: "not",
				compositeRule: true,
				createErrors: false,
				allErrors: false
			}, valid);
			cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
		},
		error: { message: "must NOT be valid" }
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.default = {
		keyword: "anyOf",
		schemaType: "array",
		trackErrors: true,
		code: require_code().validateUnion,
		error: { message: "must match a schema in anyOf" }
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	exports.default = {
		keyword: "oneOf",
		schemaType: "array",
		trackErrors: true,
		error: {
			message: "must match exactly one schema in oneOf",
			params: ({ params }) => (0, codegen_1._)`{passingSchemas: ${params.passing}}`
		},
		code(cxt) {
			const { gen, schema, parentSchema, it } = cxt;
			/* istanbul ignore if */
			if (!Array.isArray(schema)) throw new Error("ajv implementation error");
			if (it.opts.discriminator && parentSchema.discriminator) return;
			const schArr = schema;
			const valid = gen.let("valid", false);
			const passing = gen.let("passing", null);
			const schValid = gen.name("_valid");
			cxt.setParams({ passing });
			gen.block(validateOneOf);
			cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
			function validateOneOf() {
				schArr.forEach((sch, i) => {
					let schCxt;
					if ((0, util_1.alwaysValidSchema)(it, sch)) gen.var(schValid, true);
					else schCxt = cxt.subschema({
						keyword: "oneOf",
						schemaProp: i,
						compositeRule: true
					}, schValid);
					if (i > 0) gen.if((0, codegen_1._)`${schValid} && ${valid}`).assign(valid, false).assign(passing, (0, codegen_1._)`[${passing}, ${i}]`).else();
					gen.if(schValid, () => {
						gen.assign(valid, true);
						gen.assign(passing, i);
						if (schCxt) cxt.mergeEvaluated(schCxt, codegen_1.Name);
					});
				});
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const util_1 = require_util();
	exports.default = {
		keyword: "allOf",
		schemaType: "array",
		code(cxt) {
			const { gen, schema, it } = cxt;
			/* istanbul ignore if */
			if (!Array.isArray(schema)) throw new Error("ajv implementation error");
			const valid = gen.name("valid");
			schema.forEach((sch, i) => {
				if ((0, util_1.alwaysValidSchema)(it, sch)) return;
				const schCxt = cxt.subschema({
					keyword: "allOf",
					schemaProp: i
				}, valid);
				cxt.ok(valid);
				cxt.mergeEvaluated(schCxt);
			});
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const def = {
		keyword: "if",
		schemaType: ["object", "boolean"],
		trackErrors: true,
		error: {
			message: ({ params }) => (0, codegen_1.str)`must match "${params.ifClause}" schema`,
			params: ({ params }) => (0, codegen_1._)`{failingKeyword: ${params.ifClause}}`
		},
		code(cxt) {
			const { gen, parentSchema, it } = cxt;
			if (parentSchema.then === void 0 && parentSchema.else === void 0) (0, util_1.checkStrictMode)(it, "\"if\" without \"then\" and \"else\" is ignored");
			const hasThen = hasSchema(it, "then");
			const hasElse = hasSchema(it, "else");
			if (!hasThen && !hasElse) return;
			const valid = gen.let("valid", true);
			const schValid = gen.name("_valid");
			validateIf();
			cxt.reset();
			if (hasThen && hasElse) {
				const ifClause = gen.let("ifClause");
				cxt.setParams({ ifClause });
				gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
			} else if (hasThen) gen.if(schValid, validateClause("then"));
			else gen.if((0, codegen_1.not)(schValid), validateClause("else"));
			cxt.pass(valid, () => cxt.error(true));
			function validateIf() {
				const schCxt = cxt.subschema({
					keyword: "if",
					compositeRule: true,
					createErrors: false,
					allErrors: false
				}, schValid);
				cxt.mergeEvaluated(schCxt);
			}
			function validateClause(keyword, ifClause) {
				return () => {
					const schCxt = cxt.subschema({ keyword }, schValid);
					gen.assign(valid, schValid);
					cxt.mergeValidEvaluated(schCxt, valid);
					if (ifClause) gen.assign(ifClause, (0, codegen_1._)`${keyword}`);
					else cxt.setParams({ ifClause: keyword });
				};
			}
		}
	};
	function hasSchema(it, keyword) {
		const schema = it.schema[keyword];
		return schema !== void 0 && !(0, util_1.alwaysValidSchema)(it, schema);
	}
	exports.default = def;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const util_1 = require_util();
	exports.default = {
		keyword: ["then", "else"],
		schemaType: ["object", "boolean"],
		code({ keyword, parentSchema, it }) {
			if (parentSchema.if === void 0) (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const additionalItems_1 = require_additionalItems();
	const prefixItems_1 = require_prefixItems();
	const items_1 = require_items();
	const items2020_1 = require_items2020();
	const contains_1 = require_contains();
	const dependencies_1 = require_dependencies();
	const propertyNames_1 = require_propertyNames();
	const additionalProperties_1 = require_additionalProperties();
	const properties_1 = require_properties();
	const patternProperties_1 = require_patternProperties();
	const not_1 = require_not();
	const anyOf_1 = require_anyOf();
	const oneOf_1 = require_oneOf();
	const allOf_1 = require_allOf();
	const if_1 = require_if();
	const thenElse_1 = require_thenElse();
	function getApplicator(draft2020 = false) {
		const applicator = [
			not_1.default,
			anyOf_1.default,
			oneOf_1.default,
			allOf_1.default,
			if_1.default,
			thenElse_1.default,
			propertyNames_1.default,
			additionalProperties_1.default,
			dependencies_1.default,
			properties_1.default,
			patternProperties_1.default
		];
		if (draft2020) applicator.push(prefixItems_1.default, items2020_1.default);
		else applicator.push(additionalItems_1.default, items_1.default);
		applicator.push(contains_1.default);
		return applicator;
	}
	exports.default = getApplicator;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/dynamic/dynamicAnchor.js
var require_dynamicAnchor = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.dynamicAnchor = void 0;
	const codegen_1 = require_codegen();
	const names_1 = require_names();
	const compile_1 = require_compile();
	const ref_1 = require_ref();
	const def = {
		keyword: "$dynamicAnchor",
		schemaType: "string",
		code: (cxt) => dynamicAnchor(cxt, cxt.schema)
	};
	function dynamicAnchor(cxt, anchor) {
		const { gen, it } = cxt;
		it.schemaEnv.root.dynamicAnchors[anchor] = true;
		const v = (0, codegen_1._)`${names_1.default.dynamicAnchors}${(0, codegen_1.getProperty)(anchor)}`;
		const validate = it.errSchemaPath === "#" ? it.validateName : _getValidate(cxt);
		gen.if((0, codegen_1._)`!${v}`, () => gen.assign(v, validate));
	}
	exports.dynamicAnchor = dynamicAnchor;
	function _getValidate(cxt) {
		const { schemaEnv, schema, self } = cxt.it;
		const { root, baseId, localRefs, meta } = schemaEnv.root;
		const { schemaId } = self.opts;
		const sch = new compile_1.SchemaEnv({
			schema,
			schemaId,
			root,
			baseId,
			localRefs,
			meta
		});
		compile_1.compileSchema.call(self, sch);
		return (0, ref_1.getValidate)(cxt, sch);
	}
	exports.default = def;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/dynamic/dynamicRef.js
var require_dynamicRef = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.dynamicRef = void 0;
	const codegen_1 = require_codegen();
	const names_1 = require_names();
	const ref_1 = require_ref();
	const def = {
		keyword: "$dynamicRef",
		schemaType: "string",
		code: (cxt) => dynamicRef(cxt, cxt.schema)
	};
	function dynamicRef(cxt, ref) {
		const { gen, keyword, it } = cxt;
		if (ref[0] !== "#") throw new Error(`"${keyword}" only supports hash fragment reference`);
		const anchor = ref.slice(1);
		if (it.allErrors) _dynamicRef();
		else {
			const valid = gen.let("valid", false);
			_dynamicRef(valid);
			cxt.ok(valid);
		}
		function _dynamicRef(valid) {
			if (it.schemaEnv.root.dynamicAnchors[anchor]) {
				const v = gen.let("_v", (0, codegen_1._)`${names_1.default.dynamicAnchors}${(0, codegen_1.getProperty)(anchor)}`);
				gen.if(v, _callRef(v, valid), _callRef(it.validateName, valid));
			} else _callRef(it.validateName, valid)();
		}
		function _callRef(validate, valid) {
			return valid ? () => gen.block(() => {
				(0, ref_1.callRef)(cxt, validate);
				gen.let(valid, true);
			}) : () => (0, ref_1.callRef)(cxt, validate);
		}
	}
	exports.dynamicRef = dynamicRef;
	exports.default = def;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/dynamic/recursiveAnchor.js
var require_recursiveAnchor = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const dynamicAnchor_1 = require_dynamicAnchor();
	const util_1 = require_util();
	exports.default = {
		keyword: "$recursiveAnchor",
		schemaType: "boolean",
		code(cxt) {
			if (cxt.schema) (0, dynamicAnchor_1.dynamicAnchor)(cxt, "");
			else (0, util_1.checkStrictMode)(cxt.it, "$recursiveAnchor: false is ignored");
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/dynamic/recursiveRef.js
var require_recursiveRef = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const dynamicRef_1 = require_dynamicRef();
	exports.default = {
		keyword: "$recursiveRef",
		schemaType: "string",
		code: (cxt) => (0, dynamicRef_1.dynamicRef)(cxt, cxt.schema)
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/dynamic/index.js
var require_dynamic = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const dynamicAnchor_1 = require_dynamicAnchor();
	const dynamicRef_1 = require_dynamicRef();
	const recursiveAnchor_1 = require_recursiveAnchor();
	const recursiveRef_1 = require_recursiveRef();
	exports.default = [
		dynamicAnchor_1.default,
		dynamicRef_1.default,
		recursiveAnchor_1.default,
		recursiveRef_1.default
	];
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/dependentRequired.js
var require_dependentRequired = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const dependencies_1 = require_dependencies();
	exports.default = {
		keyword: "dependentRequired",
		type: "object",
		schemaType: "object",
		error: dependencies_1.error,
		code: (cxt) => (0, dependencies_1.validatePropertyDeps)(cxt)
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/applicator/dependentSchemas.js
var require_dependentSchemas = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const dependencies_1 = require_dependencies();
	exports.default = {
		keyword: "dependentSchemas",
		type: "object",
		schemaType: "object",
		code: (cxt) => (0, dependencies_1.validateSchemaDeps)(cxt)
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/validation/limitContains.js
var require_limitContains = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const util_1 = require_util();
	exports.default = {
		keyword: ["maxContains", "minContains"],
		type: "array",
		schemaType: "number",
		code({ keyword, parentSchema, it }) {
			if (parentSchema.contains === void 0) (0, util_1.checkStrictMode)(it, `"${keyword}" without "contains" is ignored`);
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/next.js
var require_next = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const dependentRequired_1 = require_dependentRequired();
	const dependentSchemas_1 = require_dependentSchemas();
	const limitContains_1 = require_limitContains();
	exports.default = [
		dependentRequired_1.default,
		dependentSchemas_1.default,
		limitContains_1.default
	];
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/unevaluated/unevaluatedProperties.js
var require_unevaluatedProperties = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	const names_1 = require_names();
	exports.default = {
		keyword: "unevaluatedProperties",
		type: "object",
		schemaType: ["boolean", "object"],
		trackErrors: true,
		error: {
			message: "must NOT have unevaluated properties",
			params: ({ params }) => (0, codegen_1._)`{unevaluatedProperty: ${params.unevaluatedProperty}}`
		},
		code(cxt) {
			const { gen, schema, data, errsCount, it } = cxt;
			/* istanbul ignore if */
			if (!errsCount) throw new Error("ajv implementation error");
			const { allErrors, props } = it;
			if (props instanceof codegen_1.Name) gen.if((0, codegen_1._)`${props} !== true`, () => gen.forIn("key", data, (key) => gen.if(unevaluatedDynamic(props, key), () => unevaluatedPropCode(key))));
			else if (props !== true) gen.forIn("key", data, (key) => props === void 0 ? unevaluatedPropCode(key) : gen.if(unevaluatedStatic(props, key), () => unevaluatedPropCode(key)));
			it.props = true;
			cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
			function unevaluatedPropCode(key) {
				if (schema === false) {
					cxt.setParams({ unevaluatedProperty: key });
					cxt.error();
					if (!allErrors) gen.break();
					return;
				}
				if (!(0, util_1.alwaysValidSchema)(it, schema)) {
					const valid = gen.name("valid");
					cxt.subschema({
						keyword: "unevaluatedProperties",
						dataProp: key,
						dataPropType: util_1.Type.Str
					}, valid);
					if (!allErrors) gen.if((0, codegen_1.not)(valid), () => gen.break());
				}
			}
			function unevaluatedDynamic(evaluatedProps, key) {
				return (0, codegen_1._)`!${evaluatedProps} || !${evaluatedProps}[${key}]`;
			}
			function unevaluatedStatic(evaluatedProps, key) {
				const ps = [];
				for (const p in evaluatedProps) if (evaluatedProps[p] === true) ps.push((0, codegen_1._)`${key} !== ${p}`);
				return (0, codegen_1.and)(...ps);
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/unevaluated/unevaluatedItems.js
var require_unevaluatedItems = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const util_1 = require_util();
	exports.default = {
		keyword: "unevaluatedItems",
		type: "array",
		schemaType: ["boolean", "object"],
		error: {
			message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
			params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
		},
		code(cxt) {
			const { gen, schema, data, it } = cxt;
			const items = it.items || 0;
			if (items === true) return;
			const len = gen.const("len", (0, codegen_1._)`${data}.length`);
			if (schema === false) {
				cxt.setParams({ len: items });
				cxt.fail((0, codegen_1._)`${len} > ${items}`);
			} else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
				const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items}`);
				gen.if((0, codegen_1.not)(valid), () => validateItems(valid, items));
				cxt.ok(valid);
			}
			it.items = true;
			function validateItems(valid, from) {
				gen.forRange("i", from, len, (i) => {
					cxt.subschema({
						keyword: "unevaluatedItems",
						dataProp: i,
						dataPropType: util_1.Type.Num
					}, valid);
					if (!it.allErrors) gen.if((0, codegen_1.not)(valid), () => gen.break());
				});
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/unevaluated/index.js
var require_unevaluated$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const unevaluatedProperties_1 = require_unevaluatedProperties();
	const unevaluatedItems_1 = require_unevaluatedItems();
	exports.default = [unevaluatedProperties_1.default, unevaluatedItems_1.default];
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/format/format.js
var require_format$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	exports.default = {
		keyword: "format",
		type: ["number", "string"],
		schemaType: "string",
		$data: true,
		error: {
			message: ({ schemaCode }) => (0, codegen_1.str)`must match format "${schemaCode}"`,
			params: ({ schemaCode }) => (0, codegen_1._)`{format: ${schemaCode}}`
		},
		code(cxt, ruleType) {
			const { gen, data, $data, schema, schemaCode, it } = cxt;
			const { opts, errSchemaPath, schemaEnv, self } = it;
			if (!opts.validateFormats) return;
			if ($data) validate$DataFormat();
			else validateFormat();
			function validate$DataFormat() {
				const fmts = gen.scopeValue("formats", {
					ref: self.formats,
					code: opts.code.formats
				});
				const fDef = gen.const("fDef", (0, codegen_1._)`${fmts}[${schemaCode}]`);
				const fType = gen.let("fType");
				const format = gen.let("format");
				gen.if((0, codegen_1._)`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1._)`${fDef}.type || "string"`).assign(format, (0, codegen_1._)`${fDef}.validate`), () => gen.assign(fType, (0, codegen_1._)`"string"`).assign(format, fDef));
				cxt.fail$data((0, codegen_1.or)(unknownFmt(), invalidFmt()));
				function unknownFmt() {
					if (opts.strictSchema === false) return codegen_1.nil;
					return (0, codegen_1._)`${schemaCode} && !${format}`;
				}
				function invalidFmt() {
					const callFormat = schemaEnv.$async ? (0, codegen_1._)`(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))` : (0, codegen_1._)`${format}(${data})`;
					const validData = (0, codegen_1._)`(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
					return (0, codegen_1._)`${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
				}
			}
			function validateFormat() {
				const formatDef = self.formats[schema];
				if (!formatDef) {
					unknownFormat();
					return;
				}
				if (formatDef === true) return;
				const [fmtType, format, fmtRef] = getFormat(formatDef);
				if (fmtType === ruleType) cxt.pass(validCondition());
				function unknownFormat() {
					if (opts.strictSchema === false) {
						self.logger.warn(unknownMsg());
						return;
					}
					throw new Error(unknownMsg());
					function unknownMsg() {
						return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
					}
				}
				function getFormat(fmtDef) {
					const code = fmtDef instanceof RegExp ? (0, codegen_1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(schema)}` : void 0;
					const fmt = gen.scopeValue("formats", {
						key: schema,
						ref: fmtDef,
						code
					});
					if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) return [
						fmtDef.type || "string",
						fmtDef.validate,
						(0, codegen_1._)`${fmt}.validate`
					];
					return [
						"string",
						fmtDef,
						fmt
					];
				}
				function validCondition() {
					if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
						if (!schemaEnv.$async) throw new Error("async format in sync schema");
						return (0, codegen_1._)`await ${fmtRef}(${data})`;
					}
					return typeof format == "function" ? (0, codegen_1._)`${fmtRef}(${data})` : (0, codegen_1._)`${fmtRef}.test(${data})`;
				}
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/format/index.js
var require_format = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.default = [require_format$1().default];
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.contentVocabulary = exports.metadataVocabulary = void 0;
	exports.metadataVocabulary = [
		"title",
		"description",
		"default",
		"deprecated",
		"readOnly",
		"writeOnly",
		"examples"
	];
	exports.contentVocabulary = [
		"contentMediaType",
		"contentEncoding",
		"contentSchema"
	];
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/draft2020.js
var require_draft2020 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const core_1 = require_core$1();
	const validation_1 = require_validation$1();
	const applicator_1 = require_applicator$1();
	const dynamic_1 = require_dynamic();
	const next_1 = require_next();
	const unevaluated_1 = require_unevaluated$1();
	const format_1 = require_format();
	const metadata_1 = require_metadata();
	exports.default = [
		dynamic_1.default,
		core_1.default,
		validation_1.default,
		(0, applicator_1.default)(true),
		format_1.default,
		metadata_1.metadataVocabulary,
		metadata_1.contentVocabulary,
		next_1.default,
		unevaluated_1.default
	];
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.DiscrError = void 0;
	var DiscrError;
	(function(DiscrError) {
		DiscrError["Tag"] = "tag";
		DiscrError["Mapping"] = "mapping";
	})(DiscrError || (exports.DiscrError = DiscrError = {}));
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const codegen_1 = require_codegen();
	const types_1 = require_types();
	const compile_1 = require_compile();
	const ref_error_1 = require_ref_error();
	const util_1 = require_util();
	exports.default = {
		keyword: "discriminator",
		type: "object",
		schemaType: "object",
		error: {
			message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
			params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._)`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
		},
		code(cxt) {
			const { gen, data, schema, parentSchema, it } = cxt;
			const { oneOf } = parentSchema;
			if (!it.opts.discriminator) throw new Error("discriminator: requires discriminator option");
			const tagName = schema.propertyName;
			if (typeof tagName != "string") throw new Error("discriminator: requires propertyName");
			if (schema.mapping) throw new Error("discriminator: mapping is not supported");
			if (!oneOf) throw new Error("discriminator: requires oneOf keyword");
			const valid = gen.let("valid", false);
			const tag = gen.const("tag", (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(tagName)}`);
			gen.if((0, codegen_1._)`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, {
				discrError: types_1.DiscrError.Tag,
				tag,
				tagName
			}));
			cxt.ok(valid);
			function validateMapping() {
				const mapping = getMapping();
				gen.if(false);
				for (const tagValue in mapping) {
					gen.elseIf((0, codegen_1._)`${tag} === ${tagValue}`);
					gen.assign(valid, applyTagSchema(mapping[tagValue]));
				}
				gen.else();
				cxt.error(false, {
					discrError: types_1.DiscrError.Mapping,
					tag,
					tagName
				});
				gen.endIf();
			}
			function applyTagSchema(schemaProp) {
				const _valid = gen.name("valid");
				const schCxt = cxt.subschema({
					keyword: "oneOf",
					schemaProp
				}, _valid);
				cxt.mergeEvaluated(schCxt, codegen_1.Name);
				return _valid;
			}
			function getMapping() {
				var _a;
				const oneOfMapping = {};
				const topRequired = hasRequired(parentSchema);
				let tagRequired = true;
				for (let i = 0; i < oneOf.length; i++) {
					let sch = oneOf[i];
					if ((sch === null || sch === void 0 ? void 0 : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
						const ref = sch.$ref;
						sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
						if (sch instanceof compile_1.SchemaEnv) sch = sch.schema;
						if (sch === void 0) throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
					}
					const propSch = (_a = sch === null || sch === void 0 ? void 0 : sch.properties) === null || _a === void 0 ? void 0 : _a[tagName];
					if (typeof propSch != "object") throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
					tagRequired = tagRequired && (topRequired || hasRequired(sch));
					addMappings(propSch, i);
				}
				if (!tagRequired) throw new Error(`discriminator: "${tagName}" must be required`);
				return oneOfMapping;
				function hasRequired({ required }) {
					return Array.isArray(required) && required.includes(tagName);
				}
				function addMappings(sch, i) {
					if (sch.const) addMapping(sch.const, i);
					else if (sch.enum) for (const tagValue of sch.enum) addMapping(tagValue, i);
					else throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
				}
				function addMapping(tagValue, i) {
					if (typeof tagValue != "string" || tagValue in oneOfMapping) throw new Error(`discriminator: "${tagName}" values must be unique strings`);
					oneOfMapping[tagValue] = i;
				}
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/schema.json
var require_schema = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://json-schema.org/draft/2020-12/schema",
		"$vocabulary": {
			"https://json-schema.org/draft/2020-12/vocab/core": true,
			"https://json-schema.org/draft/2020-12/vocab/applicator": true,
			"https://json-schema.org/draft/2020-12/vocab/unevaluated": true,
			"https://json-schema.org/draft/2020-12/vocab/validation": true,
			"https://json-schema.org/draft/2020-12/vocab/meta-data": true,
			"https://json-schema.org/draft/2020-12/vocab/format-annotation": true,
			"https://json-schema.org/draft/2020-12/vocab/content": true
		},
		"$dynamicAnchor": "meta",
		"title": "Core and Validation specifications meta-schema",
		"allOf": [
			{ "$ref": "meta/core" },
			{ "$ref": "meta/applicator" },
			{ "$ref": "meta/unevaluated" },
			{ "$ref": "meta/validation" },
			{ "$ref": "meta/meta-data" },
			{ "$ref": "meta/format-annotation" },
			{ "$ref": "meta/content" }
		],
		"type": ["object", "boolean"],
		"$comment": "This meta-schema also defines keywords that have appeared in previous drafts in order to prevent incompatible extensions as they remain in common use.",
		"properties": {
			"definitions": {
				"$comment": "\"definitions\" has been replaced by \"$defs\".",
				"type": "object",
				"additionalProperties": { "$dynamicRef": "#meta" },
				"deprecated": true,
				"default": {}
			},
			"dependencies": {
				"$comment": "\"dependencies\" has been split and replaced by \"dependentSchemas\" and \"dependentRequired\" in order to serve their differing semantics.",
				"type": "object",
				"additionalProperties": { "anyOf": [{ "$dynamicRef": "#meta" }, { "$ref": "meta/validation#/$defs/stringArray" }] },
				"deprecated": true,
				"default": {}
			},
			"$recursiveAnchor": {
				"$comment": "\"$recursiveAnchor\" has been replaced by \"$dynamicAnchor\".",
				"$ref": "meta/core#/$defs/anchorString",
				"deprecated": true
			},
			"$recursiveRef": {
				"$comment": "\"$recursiveRef\" has been replaced by \"$dynamicRef\".",
				"$ref": "meta/core#/$defs/uriReferenceString",
				"deprecated": true
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/applicator.json
var require_applicator = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://json-schema.org/draft/2020-12/meta/applicator",
		"$vocabulary": { "https://json-schema.org/draft/2020-12/vocab/applicator": true },
		"$dynamicAnchor": "meta",
		"title": "Applicator vocabulary meta-schema",
		"type": ["object", "boolean"],
		"properties": {
			"prefixItems": { "$ref": "#/$defs/schemaArray" },
			"items": { "$dynamicRef": "#meta" },
			"contains": { "$dynamicRef": "#meta" },
			"additionalProperties": { "$dynamicRef": "#meta" },
			"properties": {
				"type": "object",
				"additionalProperties": { "$dynamicRef": "#meta" },
				"default": {}
			},
			"patternProperties": {
				"type": "object",
				"additionalProperties": { "$dynamicRef": "#meta" },
				"propertyNames": { "format": "regex" },
				"default": {}
			},
			"dependentSchemas": {
				"type": "object",
				"additionalProperties": { "$dynamicRef": "#meta" },
				"default": {}
			},
			"propertyNames": { "$dynamicRef": "#meta" },
			"if": { "$dynamicRef": "#meta" },
			"then": { "$dynamicRef": "#meta" },
			"else": { "$dynamicRef": "#meta" },
			"allOf": { "$ref": "#/$defs/schemaArray" },
			"anyOf": { "$ref": "#/$defs/schemaArray" },
			"oneOf": { "$ref": "#/$defs/schemaArray" },
			"not": { "$dynamicRef": "#meta" }
		},
		"$defs": { "schemaArray": {
			"type": "array",
			"minItems": 1,
			"items": { "$dynamicRef": "#meta" }
		} }
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/unevaluated.json
var require_unevaluated = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://json-schema.org/draft/2020-12/meta/unevaluated",
		"$vocabulary": { "https://json-schema.org/draft/2020-12/vocab/unevaluated": true },
		"$dynamicAnchor": "meta",
		"title": "Unevaluated applicator vocabulary meta-schema",
		"type": ["object", "boolean"],
		"properties": {
			"unevaluatedItems": { "$dynamicRef": "#meta" },
			"unevaluatedProperties": { "$dynamicRef": "#meta" }
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/content.json
var require_content = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://json-schema.org/draft/2020-12/meta/content",
		"$vocabulary": { "https://json-schema.org/draft/2020-12/vocab/content": true },
		"$dynamicAnchor": "meta",
		"title": "Content vocabulary meta-schema",
		"type": ["object", "boolean"],
		"properties": {
			"contentEncoding": { "type": "string" },
			"contentMediaType": { "type": "string" },
			"contentSchema": { "$dynamicRef": "#meta" }
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/core.json
var require_core = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://json-schema.org/draft/2020-12/meta/core",
		"$vocabulary": { "https://json-schema.org/draft/2020-12/vocab/core": true },
		"$dynamicAnchor": "meta",
		"title": "Core vocabulary meta-schema",
		"type": ["object", "boolean"],
		"properties": {
			"$id": {
				"$ref": "#/$defs/uriReferenceString",
				"$comment": "Non-empty fragments not allowed.",
				"pattern": "^[^#]*#?$"
			},
			"$schema": { "$ref": "#/$defs/uriString" },
			"$ref": { "$ref": "#/$defs/uriReferenceString" },
			"$anchor": { "$ref": "#/$defs/anchorString" },
			"$dynamicRef": { "$ref": "#/$defs/uriReferenceString" },
			"$dynamicAnchor": { "$ref": "#/$defs/anchorString" },
			"$vocabulary": {
				"type": "object",
				"propertyNames": { "$ref": "#/$defs/uriString" },
				"additionalProperties": { "type": "boolean" }
			},
			"$comment": { "type": "string" },
			"$defs": {
				"type": "object",
				"additionalProperties": { "$dynamicRef": "#meta" }
			}
		},
		"$defs": {
			"anchorString": {
				"type": "string",
				"pattern": "^[A-Za-z_][-A-Za-z0-9._]*$"
			},
			"uriString": {
				"type": "string",
				"format": "uri"
			},
			"uriReferenceString": {
				"type": "string",
				"format": "uri-reference"
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/format-annotation.json
var require_format_annotation = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://json-schema.org/draft/2020-12/meta/format-annotation",
		"$vocabulary": { "https://json-schema.org/draft/2020-12/vocab/format-annotation": true },
		"$dynamicAnchor": "meta",
		"title": "Format vocabulary meta-schema for annotation results",
		"type": ["object", "boolean"],
		"properties": { "format": { "type": "string" } }
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/meta-data.json
var require_meta_data = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://json-schema.org/draft/2020-12/meta/meta-data",
		"$vocabulary": { "https://json-schema.org/draft/2020-12/vocab/meta-data": true },
		"$dynamicAnchor": "meta",
		"title": "Meta-data vocabulary meta-schema",
		"type": ["object", "boolean"],
		"properties": {
			"title": { "type": "string" },
			"description": { "type": "string" },
			"default": true,
			"deprecated": {
				"type": "boolean",
				"default": false
			},
			"readOnly": {
				"type": "boolean",
				"default": false
			},
			"writeOnly": {
				"type": "boolean",
				"default": false
			},
			"examples": {
				"type": "array",
				"items": true
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/meta/validation.json
var require_validation = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$id": "https://json-schema.org/draft/2020-12/meta/validation",
		"$vocabulary": { "https://json-schema.org/draft/2020-12/vocab/validation": true },
		"$dynamicAnchor": "meta",
		"title": "Validation vocabulary meta-schema",
		"type": ["object", "boolean"],
		"properties": {
			"type": { "anyOf": [{ "$ref": "#/$defs/simpleTypes" }, {
				"type": "array",
				"items": { "$ref": "#/$defs/simpleTypes" },
				"minItems": 1,
				"uniqueItems": true
			}] },
			"const": true,
			"enum": {
				"type": "array",
				"items": true
			},
			"multipleOf": {
				"type": "number",
				"exclusiveMinimum": 0
			},
			"maximum": { "type": "number" },
			"exclusiveMaximum": { "type": "number" },
			"minimum": { "type": "number" },
			"exclusiveMinimum": { "type": "number" },
			"maxLength": { "$ref": "#/$defs/nonNegativeInteger" },
			"minLength": { "$ref": "#/$defs/nonNegativeIntegerDefault0" },
			"pattern": {
				"type": "string",
				"format": "regex"
			},
			"maxItems": { "$ref": "#/$defs/nonNegativeInteger" },
			"minItems": { "$ref": "#/$defs/nonNegativeIntegerDefault0" },
			"uniqueItems": {
				"type": "boolean",
				"default": false
			},
			"maxContains": { "$ref": "#/$defs/nonNegativeInteger" },
			"minContains": {
				"$ref": "#/$defs/nonNegativeInteger",
				"default": 1
			},
			"maxProperties": { "$ref": "#/$defs/nonNegativeInteger" },
			"minProperties": { "$ref": "#/$defs/nonNegativeIntegerDefault0" },
			"required": { "$ref": "#/$defs/stringArray" },
			"dependentRequired": {
				"type": "object",
				"additionalProperties": { "$ref": "#/$defs/stringArray" }
			}
		},
		"$defs": {
			"nonNegativeInteger": {
				"type": "integer",
				"minimum": 0
			},
			"nonNegativeIntegerDefault0": {
				"$ref": "#/$defs/nonNegativeInteger",
				"default": 0
			},
			"simpleTypes": { "enum": [
				"array",
				"boolean",
				"integer",
				"null",
				"number",
				"object",
				"string"
			] },
			"stringArray": {
				"type": "array",
				"items": { "type": "string" },
				"uniqueItems": true,
				"default": []
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-2020-12/index.js
var require_json_schema_2020_12 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const metaSchema = require_schema();
	const applicator = require_applicator();
	const unevaluated = require_unevaluated();
	const content = require_content();
	const core = require_core();
	const format = require_format_annotation();
	const metadata = require_meta_data();
	const validation = require_validation();
	const META_SUPPORT_DATA = ["/properties"];
	function addMetaSchema2020($data) {
		[
			metaSchema,
			applicator,
			unevaluated,
			content,
			core,
			with$data(this, format),
			metadata,
			with$data(this, validation)
		].forEach((sch) => this.addMetaSchema(sch, void 0, false));
		return this;
		function with$data(ajv, sch) {
			return $data ? ajv.$dataMetaSchema(sch, META_SUPPORT_DATA) : sch;
		}
	}
	exports.default = addMetaSchema2020;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/2020.js
var require__2020 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv2020 = void 0;
	const core_1 = require_core$2();
	const draft2020_1 = require_draft2020();
	const discriminator_1 = require_discriminator();
	const json_schema_2020_12_1 = require_json_schema_2020_12();
	const META_SCHEMA_ID = "https://json-schema.org/draft/2020-12/schema";
	var Ajv2020 = class extends core_1.default {
		constructor(opts = {}) {
			super({
				...opts,
				dynamicRef: true,
				next: true,
				unevaluated: true
			});
		}
		_addVocabularies() {
			super._addVocabularies();
			draft2020_1.default.forEach((v) => this.addVocabulary(v));
			if (this.opts.discriminator) this.addKeyword(discriminator_1.default);
		}
		_addDefaultMetaSchema() {
			super._addDefaultMetaSchema();
			const { $data, meta } = this.opts;
			if (!meta) return;
			json_schema_2020_12_1.default.call(this, $data);
			this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
		}
		defaultMeta() {
			return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
		}
	};
	exports.Ajv2020 = Ajv2020;
	module.exports = exports = Ajv2020;
	module.exports.Ajv2020 = Ajv2020;
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.default = Ajv2020;
	var validate_1 = require_validate();
	Object.defineProperty(exports, "KeywordCxt", {
		enumerable: true,
		get: function() {
			return validate_1.KeywordCxt;
		}
	});
	var codegen_1 = require_codegen();
	Object.defineProperty(exports, "_", {
		enumerable: true,
		get: function() {
			return codegen_1._;
		}
	});
	Object.defineProperty(exports, "str", {
		enumerable: true,
		get: function() {
			return codegen_1.str;
		}
	});
	Object.defineProperty(exports, "stringify", {
		enumerable: true,
		get: function() {
			return codegen_1.stringify;
		}
	});
	Object.defineProperty(exports, "nil", {
		enumerable: true,
		get: function() {
			return codegen_1.nil;
		}
	});
	Object.defineProperty(exports, "Name", {
		enumerable: true,
		get: function() {
			return codegen_1.Name;
		}
	});
	Object.defineProperty(exports, "CodeGen", {
		enumerable: true,
		get: function() {
			return codegen_1.CodeGen;
		}
	});
	var validation_error_1 = require_validation_error();
	Object.defineProperty(exports, "ValidationError", {
		enumerable: true,
		get: function() {
			return validation_error_1.default;
		}
	});
	var ref_error_1 = require_ref_error();
	Object.defineProperty(exports, "MissingRefError", {
		enumerable: true,
		get: function() {
			return ref_error_1.default;
		}
	});
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.20.0/node_modules/ajv-formats/dist/formats.js
var require_formats = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.formatNames = exports.fastFormats = exports.fullFormats = void 0;
	function fmtDef(validate, compare) {
		return {
			validate,
			compare
		};
	}
	exports.fullFormats = {
		date: fmtDef(date, compareDate),
		time: fmtDef(getTime(true), compareTime),
		"date-time": fmtDef(getDateTime(true), compareDateTime),
		"iso-time": fmtDef(getTime(), compareIsoTime),
		"iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
		duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
		uri,
		"uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
		"uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
		url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
		email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
		hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
		ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
		ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
		regex,
		uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
		"json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
		"json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
		"relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
		byte,
		int32: {
			type: "number",
			validate: validateInt32
		},
		int64: {
			type: "number",
			validate: validateInt64
		},
		float: {
			type: "number",
			validate: validateNumber
		},
		double: {
			type: "number",
			validate: validateNumber
		},
		password: true,
		binary: true
	};
	exports.fastFormats = {
		...exports.fullFormats,
		date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
		time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
		"date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
		"iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
		"iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
		uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
		"uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
		email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
	};
	exports.formatNames = Object.keys(exports.fullFormats);
	function isLeapYear(year) {
		return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	}
	const DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
	const DAYS = [
		0,
		31,
		28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31
	];
	function date(str) {
		const matches = DATE.exec(str);
		if (!matches) return false;
		const year = +matches[1];
		const month = +matches[2];
		const day = +matches[3];
		return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
	}
	function compareDate(d1, d2) {
		if (!(d1 && d2)) return void 0;
		if (d1 > d2) return 1;
		if (d1 < d2) return -1;
		return 0;
	}
	const TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
	function getTime(strictTimeZone) {
		return function time(str) {
			const matches = TIME.exec(str);
			if (!matches) return false;
			const hr = +matches[1];
			const min = +matches[2];
			const sec = +matches[3];
			const tz = matches[4];
			const tzSign = matches[5] === "-" ? -1 : 1;
			const tzH = +(matches[6] || 0);
			const tzM = +(matches[7] || 0);
			if (tzH > 23 || tzM > 59 || strictTimeZone && !tz) return false;
			if (hr <= 23 && min <= 59 && sec < 60) return true;
			const utcMin = min - tzM * tzSign;
			const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
			return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
		};
	}
	function compareTime(s1, s2) {
		if (!(s1 && s2)) return void 0;
		const t1 = (/* @__PURE__ */ new Date("2020-01-01T" + s1)).valueOf();
		const t2 = (/* @__PURE__ */ new Date("2020-01-01T" + s2)).valueOf();
		if (!(t1 && t2)) return void 0;
		return t1 - t2;
	}
	function compareIsoTime(t1, t2) {
		if (!(t1 && t2)) return void 0;
		const a1 = TIME.exec(t1);
		const a2 = TIME.exec(t2);
		if (!(a1 && a2)) return void 0;
		t1 = a1[1] + a1[2] + a1[3];
		t2 = a2[1] + a2[2] + a2[3];
		if (t1 > t2) return 1;
		if (t1 < t2) return -1;
		return 0;
	}
	const DATE_TIME_SEPARATOR = /t|\s/i;
	function getDateTime(strictTimeZone) {
		const time = getTime(strictTimeZone);
		return function date_time(str) {
			const dateTime = str.split(DATE_TIME_SEPARATOR);
			return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
		};
	}
	function compareDateTime(dt1, dt2) {
		if (!(dt1 && dt2)) return void 0;
		const d1 = new Date(dt1).valueOf();
		const d2 = new Date(dt2).valueOf();
		if (!(d1 && d2)) return void 0;
		return d1 - d2;
	}
	function compareIsoDateTime(dt1, dt2) {
		if (!(dt1 && dt2)) return void 0;
		const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
		const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
		const res = compareDate(d1, d2);
		if (res === void 0) return void 0;
		return res || compareTime(t1, t2);
	}
	const NOT_URI_FRAGMENT = /\/|:/;
	const URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
	function uri(str) {
		return NOT_URI_FRAGMENT.test(str) && URI.test(str);
	}
	const BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
	function byte(str) {
		BYTE.lastIndex = 0;
		return BYTE.test(str);
	}
	const MIN_INT32 = -(2 ** 31);
	const MAX_INT32 = 2 ** 31 - 1;
	function validateInt32(value) {
		return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
	}
	function validateInt64(value) {
		return Number.isInteger(value);
	}
	function validateNumber() {
		return true;
	}
	const Z_ANCHOR = /[^\\]\\Z/;
	function regex(str) {
		if (Z_ANCHOR.test(str)) return false;
		try {
			new RegExp(str);
			return true;
		} catch (e) {
			return false;
		}
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const core_1 = require_core$1();
	const validation_1 = require_validation$1();
	const applicator_1 = require_applicator$1();
	const format_1 = require_format();
	const metadata_1 = require_metadata();
	exports.default = [
		core_1.default,
		validation_1.default,
		(0, applicator_1.default)(),
		format_1.default,
		metadata_1.metadataVocabulary,
		metadata_1.contentVocabulary
	];
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"$schema": "http://json-schema.org/draft-07/schema#",
		"$id": "http://json-schema.org/draft-07/schema#",
		"title": "Core schema meta-schema",
		"definitions": {
			"schemaArray": {
				"type": "array",
				"minItems": 1,
				"items": { "$ref": "#" }
			},
			"nonNegativeInteger": {
				"type": "integer",
				"minimum": 0
			},
			"nonNegativeIntegerDefault0": { "allOf": [{ "$ref": "#/definitions/nonNegativeInteger" }, { "default": 0 }] },
			"simpleTypes": { "enum": [
				"array",
				"boolean",
				"integer",
				"null",
				"number",
				"object",
				"string"
			] },
			"stringArray": {
				"type": "array",
				"items": { "type": "string" },
				"uniqueItems": true,
				"default": []
			}
		},
		"type": ["object", "boolean"],
		"properties": {
			"$id": {
				"type": "string",
				"format": "uri-reference"
			},
			"$schema": {
				"type": "string",
				"format": "uri"
			},
			"$ref": {
				"type": "string",
				"format": "uri-reference"
			},
			"$comment": { "type": "string" },
			"title": { "type": "string" },
			"description": { "type": "string" },
			"default": true,
			"readOnly": {
				"type": "boolean",
				"default": false
			},
			"examples": {
				"type": "array",
				"items": true
			},
			"multipleOf": {
				"type": "number",
				"exclusiveMinimum": 0
			},
			"maximum": { "type": "number" },
			"exclusiveMaximum": { "type": "number" },
			"minimum": { "type": "number" },
			"exclusiveMinimum": { "type": "number" },
			"maxLength": { "$ref": "#/definitions/nonNegativeInteger" },
			"minLength": { "$ref": "#/definitions/nonNegativeIntegerDefault0" },
			"pattern": {
				"type": "string",
				"format": "regex"
			},
			"additionalItems": { "$ref": "#" },
			"items": {
				"anyOf": [{ "$ref": "#" }, { "$ref": "#/definitions/schemaArray" }],
				"default": true
			},
			"maxItems": { "$ref": "#/definitions/nonNegativeInteger" },
			"minItems": { "$ref": "#/definitions/nonNegativeIntegerDefault0" },
			"uniqueItems": {
				"type": "boolean",
				"default": false
			},
			"contains": { "$ref": "#" },
			"maxProperties": { "$ref": "#/definitions/nonNegativeInteger" },
			"minProperties": { "$ref": "#/definitions/nonNegativeIntegerDefault0" },
			"required": { "$ref": "#/definitions/stringArray" },
			"additionalProperties": { "$ref": "#" },
			"definitions": {
				"type": "object",
				"additionalProperties": { "$ref": "#" },
				"default": {}
			},
			"properties": {
				"type": "object",
				"additionalProperties": { "$ref": "#" },
				"default": {}
			},
			"patternProperties": {
				"type": "object",
				"additionalProperties": { "$ref": "#" },
				"propertyNames": { "format": "regex" },
				"default": {}
			},
			"dependencies": {
				"type": "object",
				"additionalProperties": { "anyOf": [{ "$ref": "#" }, { "$ref": "#/definitions/stringArray" }] }
			},
			"propertyNames": { "$ref": "#" },
			"const": true,
			"enum": {
				"type": "array",
				"items": true,
				"minItems": 1,
				"uniqueItems": true
			},
			"type": { "anyOf": [{ "$ref": "#/definitions/simpleTypes" }, {
				"type": "array",
				"items": { "$ref": "#/definitions/simpleTypes" },
				"minItems": 1,
				"uniqueItems": true
			}] },
			"format": { "type": "string" },
			"contentMediaType": { "type": "string" },
			"contentEncoding": { "type": "string" },
			"if": { "$ref": "#" },
			"then": { "$ref": "#" },
			"else": { "$ref": "#" },
			"allOf": { "$ref": "#/definitions/schemaArray" },
			"anyOf": { "$ref": "#/definitions/schemaArray" },
			"oneOf": { "$ref": "#/definitions/schemaArray" },
			"not": { "$ref": "#" }
		},
		"default": true
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/ajv.js
var require_ajv = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv = void 0;
	const core_1 = require_core$2();
	const draft7_1 = require_draft7();
	const discriminator_1 = require_discriminator();
	const draft7MetaSchema = require_json_schema_draft_07();
	const META_SUPPORT_DATA = ["/properties"];
	const META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";
	var Ajv = class extends core_1.default {
		_addVocabularies() {
			super._addVocabularies();
			draft7_1.default.forEach((v) => this.addVocabulary(v));
			if (this.opts.discriminator) this.addKeyword(discriminator_1.default);
		}
		_addDefaultMetaSchema() {
			super._addDefaultMetaSchema();
			if (!this.opts.meta) return;
			const metaSchema = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA) : draft7MetaSchema;
			this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
			this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
		}
		defaultMeta() {
			return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
		}
	};
	exports.Ajv = Ajv;
	module.exports = exports = Ajv;
	module.exports.Ajv = Ajv;
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.default = Ajv;
	var validate_1 = require_validate();
	Object.defineProperty(exports, "KeywordCxt", {
		enumerable: true,
		get: function() {
			return validate_1.KeywordCxt;
		}
	});
	var codegen_1 = require_codegen();
	Object.defineProperty(exports, "_", {
		enumerable: true,
		get: function() {
			return codegen_1._;
		}
	});
	Object.defineProperty(exports, "str", {
		enumerable: true,
		get: function() {
			return codegen_1.str;
		}
	});
	Object.defineProperty(exports, "stringify", {
		enumerable: true,
		get: function() {
			return codegen_1.stringify;
		}
	});
	Object.defineProperty(exports, "nil", {
		enumerable: true,
		get: function() {
			return codegen_1.nil;
		}
	});
	Object.defineProperty(exports, "Name", {
		enumerable: true,
		get: function() {
			return codegen_1.Name;
		}
	});
	Object.defineProperty(exports, "CodeGen", {
		enumerable: true,
		get: function() {
			return codegen_1.CodeGen;
		}
	});
	var validation_error_1 = require_validation_error();
	Object.defineProperty(exports, "ValidationError", {
		enumerable: true,
		get: function() {
			return validation_error_1.default;
		}
	});
	var ref_error_1 = require_ref_error();
	Object.defineProperty(exports, "MissingRefError", {
		enumerable: true,
		get: function() {
			return ref_error_1.default;
		}
	});
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.20.0/node_modules/ajv-formats/dist/limit.js
var require_limit = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.formatLimitDefinition = void 0;
	const ajv_1 = require_ajv();
	const codegen_1 = require_codegen();
	const ops = codegen_1.operators;
	const KWDs = {
		formatMaximum: {
			okStr: "<=",
			ok: ops.LTE,
			fail: ops.GT
		},
		formatMinimum: {
			okStr: ">=",
			ok: ops.GTE,
			fail: ops.LT
		},
		formatExclusiveMaximum: {
			okStr: "<",
			ok: ops.LT,
			fail: ops.GTE
		},
		formatExclusiveMinimum: {
			okStr: ">",
			ok: ops.GT,
			fail: ops.LTE
		}
	};
	exports.formatLimitDefinition = {
		keyword: Object.keys(KWDs),
		type: "string",
		schemaType: "string",
		$data: true,
		error: {
			message: ({ keyword, schemaCode }) => (0, codegen_1.str)`should be ${KWDs[keyword].okStr} ${schemaCode}`,
			params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
		},
		code(cxt) {
			const { gen, data, schemaCode, keyword, it } = cxt;
			const { opts, self } = it;
			if (!opts.validateFormats) return;
			const fCxt = new ajv_1.KeywordCxt(it, self.RULES.all.format.definition, "format");
			if (fCxt.$data) validate$DataFormat();
			else validateFormat();
			function validate$DataFormat() {
				const fmts = gen.scopeValue("formats", {
					ref: self.formats,
					code: opts.code.formats
				});
				const fmt = gen.const("fmt", (0, codegen_1._)`${fmts}[${fCxt.schemaCode}]`);
				cxt.fail$data((0, codegen_1.or)((0, codegen_1._)`typeof ${fmt} != "object"`, (0, codegen_1._)`${fmt} instanceof RegExp`, (0, codegen_1._)`typeof ${fmt}.compare != "function"`, compareCode(fmt)));
			}
			function validateFormat() {
				const format = fCxt.schema;
				const fmtDef = self.formats[format];
				if (!fmtDef || fmtDef === true) return;
				if (typeof fmtDef != "object" || fmtDef instanceof RegExp || typeof fmtDef.compare != "function") throw new Error(`"${keyword}": format "${format}" does not define "compare" function`);
				const fmt = gen.scopeValue("formats", {
					key: format,
					ref: fmtDef,
					code: opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(format)}` : void 0
				});
				cxt.fail$data(compareCode(fmt));
			}
			function compareCode(fmt) {
				return (0, codegen_1._)`${fmt}.compare(${data}, ${schemaCode}) ${KWDs[keyword].fail} 0`;
			}
		},
		dependencies: ["format"]
	};
	const formatLimitPlugin = (ajv) => {
		ajv.addKeyword(exports.formatLimitDefinition);
		return ajv;
	};
	exports.default = formatLimitPlugin;
}));
//#endregion
//#region ../../node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.20.0/node_modules/ajv-formats/dist/index.js
var require_dist = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	const formats_1 = require_formats();
	const limit_1 = require_limit();
	const codegen_1 = require_codegen();
	const fullName = new codegen_1.Name("fullFormats");
	const fastName = new codegen_1.Name("fastFormats");
	const formatsPlugin = (ajv, opts = { keywords: true }) => {
		if (Array.isArray(opts)) {
			addFormats(ajv, opts, formats_1.fullFormats, fullName);
			return ajv;
		}
		const [formats, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName];
		addFormats(ajv, opts.formats || formats_1.formatNames, formats, exportName);
		if (opts.keywords) (0, limit_1.default)(ajv);
		return ajv;
	};
	formatsPlugin.get = (name, mode = "full") => {
		const f = (mode === "fast" ? formats_1.fastFormats : formats_1.fullFormats)[name];
		if (!f) throw new Error(`Unknown format "${name}"`);
		return f;
	};
	function addFormats(ajv, list, fs, exportName) {
		var _a;
		var _b;
		(_a = (_b = ajv.opts.code).formats) !== null && _a !== void 0 || (_b.formats = (0, codegen_1._)`require("ajv-formats/dist/formats").${exportName}`);
		for (const f of list) ajv.addFormat(f, fs[f]);
	}
	module.exports = exports = formatsPlugin;
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.default = formatsPlugin;
}));
//#endregion
//#region src/manifest-validator.ts
var import__2020 = /* @__PURE__ */ __toESM(require__2020(), 1);
var import_dist = /* @__PURE__ */ __toESM(require_dist(), 1);
const MANIFEST_SCHEMA_PATH = fileURLToPath(new URL("../../../protocol/project-control/v1alpha1/schemas/project-manifest.schema.json", import.meta.url));
let manifestValidator;
function validateProjectManifest(value) {
	let validate;
	try {
		validate = manifestValidator ??= compileManifestSchema();
	} catch {
		return {
			valid: false,
			errors: [{
				field: "$",
				reason: "schema_unavailable"
			}]
		};
	}
	const valid = validate(value);
	const errors = valid ? [] : (validate.errors ?? []).slice(0, 20).map(publicIssue);
	if (valid) {
		const entries = value.spec?.documents?.entries;
		const identities = /* @__PURE__ */ new Set();
		for (const [index, raw] of (entries ?? []).entries()) {
			const entry = raw;
			const identity = `${String(entry.role)}\u0000${String(entry.path).toLocaleLowerCase("en-US")}`;
			if (identities.has(identity)) errors.push({
				field: `/spec/documents/entries/${String(index)}`,
				reason: "duplicate_role_path"
			});
			identities.add(identity);
		}
	}
	return {
		valid: errors.length === 0,
		errors
	};
}
function compileManifestSchema() {
	const schema = JSON.parse(readFileSync(MANIFEST_SCHEMA_PATH, "utf8"));
	const ajv = new import__2020.default({
		allErrors: true,
		strict: true
	});
	(0, import_dist.default)(ajv);
	return ajv.compile(schema);
}
function publicIssue(error) {
	return {
		field: error.instancePath === "" ? "$" : error.instancePath,
		reason: error.keyword
	};
}
//#endregion
//#region src/discovery/runtime.js
const SCANNER_VERSION = "gate2c-readonly/1";
const DEFAULTS = Object.freeze({
	maxDepth: 3,
	sourceDepth: 1,
	maxEntries: 2e4,
	maxDocuments: 200,
	maxBytes: 32 * 1024 * 1024,
	maxFileBytes: 2 * 1024 * 1024,
	maxCandidates: 100,
	previewChars: 800
});
const HARD_LIMITS = Object.freeze({
	maxDepth: 3,
	sourceDepth: 3,
	maxEntries: 5e4,
	maxDocuments: 200,
	maxBytes: 128 * 1024 * 1024,
	maxFileBytes: 8 * 1024 * 1024,
	maxCandidates: 500,
	previewChars: 1e3
});
const IGNORED_DIRECTORIES$1 = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	"dist",
	"build",
	"out",
	"target",
	".next",
	"coverage",
	"artifacts",
	".cache",
	"cache",
	"caches",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".ruff_cache",
	".turbo",
	".gradle",
	".idea",
	".pnpm-store",
	".yarn",
	"tmp",
	"temp",
	"$recycle.bin"
]);
function isIgnoredDirectoryName(lowerName) {
	return IGNORED_DIRECTORIES$1.has(lowerName) || lowerName.startsWith(".dsh-staging.");
}
const DOCUMENT_DIRECTORIES = new Set([
	"docs",
	"doc",
	"documentation",
	"documents",
	"adr",
	"adrs",
	"decisions",
	"architecture-decision-records"
]);
const TEXT_EXTENSIONS$2 = new Set([
	".md",
	".markdown",
	".mdx",
	".txt",
	".rst"
]);
const DOCUMENT_ROLES$2 = new Set([
	"readme",
	"prd",
	"devlog",
	"progress",
	"next",
	"current_architecture",
	"decision",
	"other"
]);
const PROJECT_MARKERS = new Map([
	["package.json", "node_manifest"],
	["pnpm-workspace.yaml", "node_workspace"],
	["pyproject.toml", "python_manifest"],
	["cargo.toml", "rust_manifest"],
	["go.mod", "go_manifest"],
	["pom.xml", "java_manifest"],
	["build.gradle", "gradle_manifest"],
	["build.gradle.kts", "gradle_manifest"],
	["composer.json", "php_manifest"],
	["gemfile", "ruby_manifest"],
	["mix.exs", "elixir_manifest"],
	["makefile", "build_manifest"],
	["agents.md", "agent_marker"]
]);
const SAFE_RELATIVE_PATH$1 = /^(?!\/)(?!.*[:\\])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\u0000-\u001F\u007F])(?!.*\/\/)(?!.*\/$)[^/]+(?:\/[^/]+)*$/;
const PROJECT_ID$1 = /^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
var DiscoveryPathError = class extends Error {
	constructor(message, code, details = {}) {
		super(message);
		this.name = "DiscoveryPathError";
		this.code = code;
		this.details = details;
	}
};
function boundedInteger(value, fallback, maximum, name, minimum = 1) {
	const actual = value === void 0 ? fallback : value;
	if (!Number.isSafeInteger(actual) || actual < minimum || actual > maximum) throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
	return actual;
}
function normalizeOptions(options = {}) {
	if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Discovery options must be an object.");
	return Object.freeze({
		maxDepth: boundedInteger(options.maxDepth, DEFAULTS.maxDepth, HARD_LIMITS.maxDepth, "maxDepth", 0),
		sourceDepth: boundedInteger(options.sourceDepth, DEFAULTS.sourceDepth, HARD_LIMITS.sourceDepth, "sourceDepth"),
		maxEntries: boundedInteger(options.maxEntries, DEFAULTS.maxEntries, HARD_LIMITS.maxEntries, "maxEntries"),
		maxDocuments: boundedInteger(options.maxDocuments, DEFAULTS.maxDocuments, HARD_LIMITS.maxDocuments, "maxDocuments"),
		maxBytes: boundedInteger(options.maxBytes, DEFAULTS.maxBytes, HARD_LIMITS.maxBytes, "maxBytes"),
		maxFileBytes: boundedInteger(options.maxFileBytes, DEFAULTS.maxFileBytes, HARD_LIMITS.maxFileBytes, "maxFileBytes"),
		maxCandidates: boundedInteger(options.maxCandidates, DEFAULTS.maxCandidates, HARD_LIMITS.maxCandidates, "maxCandidates"),
		previewChars: boundedInteger(options.previewChars, DEFAULTS.previewChars, HARD_LIMITS.previewChars, "previewChars", 80)
	});
}
function isNetworkOrDevicePath(value) {
	return /^(?:\\\\|\/\/|\\\\[?.]\\)/.test(value) || /^file:/i.test(value);
}
function comparisonPath$1(value) {
	const normalized = normalize(value);
	return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}
function isWithin$1(rootPath, candidatePath) {
	const relation = relative(comparisonPath$1(rootPath), comparisonPath$1(candidatePath));
	return relation === "" || !relation.startsWith("..") && !isAbsolute(relation);
}
function toPosix(value) {
	return value.split(sep).join("/");
}
function pathRecord(displayPath, realPath) {
	return Object.freeze({
		displayPath: normalize(displayPath),
		realPath: normalize(realPath),
		normalizedPath: normalize(realPath)
	});
}
async function resolveDirectoryRoot(inputPath, label) {
	if (typeof inputPath !== "string" || inputPath.length === 0 || inputPath.length > 2048) throw new DiscoveryPathError(`${label} must be a non-empty local path.`, "INVALID_ROOT");
	if (!isAbsolute(inputPath) || isNetworkOrDevicePath(inputPath)) throw new DiscoveryPathError(`${label} must be an absolute local filesystem path.`, "NON_LOCAL_ROOT");
	const displayPath = normalize(resolve(inputPath));
	if (comparisonPath$1(displayPath) === comparisonPath$1(parse(displayPath).root)) throw new DiscoveryPathError(`${label} cannot be a filesystem root.`, "SYSTEM_ROOT_REJECTED");
	let rootStat;
	let resolvedPath;
	try {
		rootStat = await stat(displayPath);
		resolvedPath = await realpath(displayPath);
	} catch (error) {
		throw new DiscoveryPathError(`${label} is not accessible.`, "ROOT_UNREADABLE", { causeCode: error?.code });
	}
	if (!rootStat.isDirectory()) throw new DiscoveryPathError(`${label} must be a directory.`, "ROOT_NOT_DIRECTORY");
	if (isNetworkOrDevicePath(resolvedPath)) throw new DiscoveryPathError(`${label} resolved to a non-local path.`, "NON_LOCAL_ROOT");
	return pathRecord(displayPath, resolvedPath);
}
function createBudget(preferences) {
	return {
		entries: 0,
		documents: 0,
		bytesRead: 0,
		skippedDirectories: 0,
		limits: /* @__PURE__ */ new Set(),
		preferences
	};
}
function createIssueCollector() {
	const issues = [];
	const keys = /* @__PURE__ */ new Set();
	return {
		issues,
		add(code, severity, message, details = {}) {
			const key = `${code}\0${details.relativePath ?? ""}`;
			if (keys.has(key) || issues.length >= 200) return;
			keys.add(key);
			issues.push(Object.freeze({
				code,
				severity,
				message,
				details: Object.freeze({
					message,
					...details
				})
			}));
		}
	};
}
function noteLimit(budget, collector, limit) {
	if (budget.limits.has(limit)) return;
	budget.limits.add(limit);
	collector.add("SCAN_LIMIT_REACHED", "warning", "The read-only scan stopped at a configured safety limit.", { limit });
}
function safeRelative(root, displayPath) {
	const value = toPosix(relative(root.displayPath, displayPath));
	return value && SAFE_RELATIVE_PATH$1.test(value) ? value : null;
}
async function inspectEntry(root, displayPath, relativePath, collector, blocking = false) {
	try {
		const entryLstat = await lstat(displayPath);
		const resolvedPath = await realpath(displayPath);
		if (!isWithin$1(root.realPath, resolvedPath)) {
			collector.add("PATH_ESCAPE_BLOCKED", blocking ? "blocking" : "warning", "A link or reparse target outside the selected root was skipped.", {
				relativePath,
				entryType: entryLstat.isSymbolicLink() ? "link" : "reparse_or_path"
			});
			return null;
		}
		const resolvedStat = await stat(resolvedPath);
		return {
			displayPath: normalize(displayPath),
			realPath: normalize(resolvedPath),
			normalizedPath: normalize(resolvedPath),
			lstat: entryLstat,
			stat: resolvedStat
		};
	} catch (error) {
		collector.add(error?.code === "EACCES" || error?.code === "EPERM" ? "ENTRY_ACCESS_DENIED" : "ENTRY_UNREADABLE", blocking ? "blocking" : "warning", "An entry could not be read and was skipped.", {
			relativePath,
			causeCode: error?.code ?? "UNKNOWN"
		});
		return null;
	}
}
function decodeText(bytes) {
	if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 254) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
	if (bytes.length >= 2 && bytes[0] === 254 && bytes[1] === 255) {
		if ((bytes.length - 2) % 2 !== 0) throw Object.assign(/* @__PURE__ */ new Error("invalid UTF-16BE byte length"), { code: "INVALID_UTF16_LENGTH" });
		const swapped = Buffer.allocUnsafe(bytes.length - 2);
		for (let index = 2; index + 1 < bytes.length; index += 2) {
			swapped[index - 2] = bytes[index + 1];
			swapped[index - 1] = bytes[index];
		}
		return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
	}
	if (bytes.includes(0)) throw Object.assign(/* @__PURE__ */ new Error("binary content"), { code: "BINARY_CONTENT" });
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
}
function cleanInline(value, maximum = 500) {
	return value.replace(/<!--.*?-->/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim().slice(0, maximum);
}
function cleanSuggestedName(value) {
	return cleanInline(String(value), 200).replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim() || "未命名项目";
}
function extractTitle(text) {
	for (const line of text.split(/\r?\n/, 200)) {
		const match = /^#\s+(.+?)\s*$/.exec(line);
		if (match) return cleanInline(match[1]) || null;
	}
	return null;
}
function makePreview(text, maximum) {
	let body = text;
	if (/^---\s*\r?\n/.test(body)) {
		const end = body.slice(4).search(/\r?\n---\s*(?:\r?\n|$)/);
		if (end >= 0) body = body.slice(end + 8);
	}
	return cleanInline(body.replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*+]\s+/gm, ""), maximum) || null;
}
function confidenceLevel(score) {
	if (score >= 70) return "high";
	if (score >= 40) return "medium";
	if (score > 0) return "low";
	return "low";
}
function addRole(target, role, score, kind, detail) {
	if (!DOCUMENT_ROLES$2.has(role)) return;
	const existing = target.get(role) ?? {
		role,
		score: 0,
		evidence: []
	};
	existing.score = Math.max(existing.score, score);
	existing.evidence.push({
		kind,
		detail
	});
	target.set(role, existing);
}
function classifyDocument(relativePath, title, manifestRoles = []) {
	const roles = /* @__PURE__ */ new Map();
	const fileName = basename(relativePath);
	const normalizedStem = fileName.slice(0, fileName.length - extname(fileName).length).replace(/[.\s_-]+/g, " ").trim().toLocaleLowerCase("en-US");
	const segments = relativePath.toLocaleLowerCase("en-US").split("/");
	const inDecisionDirectory = segments.some((part) => [
		"adr",
		"adrs",
		"decisions",
		"architecture-decision-records"
	].includes(part));
	const fileEvidence = (role, score, detail) => addRole(roles, role, score, "filename", detail);
	if (/^readme(?:\b|\s)/i.test(normalizedStem) || /^(overview|home)$/i.test(normalizedStem)) fileEvidence("readme", 100, fileName);
	if (/^(prd)(?:\b|\s)|product requirements?|product spec|产品需求|需求规格/i.test(normalizedStem)) fileEvidence("prd", 100, fileName);
	if (/^devlog(?:\b|\s)|development log|开发日志/i.test(normalizedStem)) fileEvidence("devlog", 100, fileName);
	if (/^changelog(?:\b|\s)|change log|更新日志/i.test(normalizedStem)) fileEvidence("devlog", 78, fileName);
	if (/^progress(?:\b|\s)|status report|进展|进度/i.test(normalizedStem)) fileEvidence("progress", 100, fileName);
	if (/^next(?:\b|\s)|roadmap|next steps?|下一步|路线图/i.test(normalizedStem)) fileEvidence("next", 100, fileName);
	if (/^architecture(?:\b|\s)|system design|technical design|架构/i.test(normalizedStem)) fileEvidence("current_architecture", 100, fileName);
	if (/^(adr)(?:\b|\s)|architecture decision|架构决策|决策记录/i.test(normalizedStem) || inDecisionDirectory) fileEvidence("decision", 95, fileName);
	if (title) {
		if (/\bPRD\b|product requirements?|产品需求|需求规格/i.test(title)) addRole(roles, "prd", 72, "title", title);
		if (/architecture|system design|架构/i.test(title)) addRole(roles, "current_architecture", 70, "title", title);
		if (/development log|devlog|开发日志/i.test(title)) addRole(roles, "devlog", 70, "title", title);
		if (/progress|进展|进度/i.test(title)) addRole(roles, "progress", 68, "title", title);
		if (/roadmap|next steps?|下一步|路线图/i.test(title)) addRole(roles, "next", 68, "title", title);
	}
	for (const role of manifestRoles) addRole(roles, role, 110, "manifest", `Manifest-locked document binding: ${role}`);
	if (roles.size === 0 && segments.some((part) => DOCUMENT_DIRECTORIES.has(part))) addRole(roles, "other", 35, "document_directory", "Text file under a recognized documentation directory");
	const roleCandidates = [...roles.values()].sort((left, right) => right.score - left.score || left.role.localeCompare(right.role, "en")).map((candidate) => Object.freeze({
		role: candidate.role,
		score: candidate.score,
		confidence: confidenceLevel(candidate.score),
		evidence: Object.freeze(candidate.evidence.map(Object.freeze))
	}));
	const first = roleCandidates[0];
	const second = roleCandidates[1];
	return {
		suggestedRole: first && first.score >= 65 && (!second || first.score - second.score >= 10) ? first.role : null,
		roleCandidates
	};
}
function extractSummaryCandidates(text, relativePath, suggestedRole) {
	const lines = text.split(/\r?\n/);
	const output = [];
	if (lines[0]?.trim() === "---") for (let index = 1; index < Math.min(lines.length, 100); index += 1) {
		if (lines[index].trim() === "---") break;
		const match = /^\s*(summary|goal|objective|目标)\s*:\s*(.+?)\s*$/i.exec(lines[index]);
		if (match) {
			const value = cleanInline(match[2].replace(/^['"]|['"]$/g, ""), 500);
			if (value) output.push({
				value,
				source: {
					relativePath,
					kind: "frontmatter",
					field: match[1],
					line: index + 1
				},
				score: suggestedRole === "prd" ? 95 : 85
			});
		}
	}
	for (let index = 0; index < lines.length; index += 1) {
		const heading = /^#{1,6}\s*(项目目标|目标|Goal|Objective)\s*[:：]?\s*$/i.exec(lines[index]);
		if (!heading) continue;
		for (let next = index + 1; next < Math.min(lines.length, index + 12); next += 1) {
			if (/^#{1,6}\s+/.test(lines[next])) break;
			const value = cleanInline(lines[next].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ""), 500);
			if (value) {
				output.push({
					value,
					source: {
						relativePath,
						kind: "heading",
						heading: heading[1],
						line: next + 1
					},
					score: suggestedRole === "prd" ? 90 : 80
				});
				break;
			}
		}
	}
	return output.slice(0, 2);
}
function shouldReadDocument(relativePath, manifestPaths) {
	if (manifestPaths.has(relativePath)) return true;
	const extension = extname(relativePath).toLocaleLowerCase("en-US");
	if (!TEXT_EXTENSIONS$2.has(extension)) return false;
	const fileName = basename(relativePath).toLocaleLowerCase("en-US");
	const stem = fileName.slice(0, fileName.length - extension.length);
	if (/^(readme|overview|home|prd|devlog|progress|next|roadmap|architecture|changelog|adr)(?:[._ -]|$)/i.test(stem)) return true;
	if (/产品需求|需求规格|开发日志|更新日志|进展|进度|下一步|路线图|架构|决策记录/.test(stem)) return true;
	return relativePath.toLocaleLowerCase("en-US").split("/").some((part) => DOCUMENT_DIRECTORIES.has(part));
}
function parseScalar(value) {
	const trimmed = value.trim();
	if (trimmed === "{}") return {};
	if (trimmed === "[]") return [];
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null" || trimmed === "~") return null;
	if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	if (trimmed.startsWith("\"")) return JSON.parse(trimmed);
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
	if (/^[&*!>|]/.test(trimmed)) throw new Error("Unsupported YAML feature");
	return trimmed;
}
function stripYamlComment(line) {
	let single = false;
	let double = false;
	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (character === "'" && !double) single = !single;
		if (character === "\"" && !single && line[index - 1] !== "\\") double = !double;
		if (character === "#" && !single && !double && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
	}
	return line;
}
function splitYamlPair(content) {
	let single = false;
	let double = false;
	for (let index = 0; index < content.length; index += 1) {
		const character = content[index];
		if (character === "'" && !double) single = !single;
		if (character === "\"" && !single && content[index - 1] !== "\\") double = !double;
		if (character === ":" && !single && !double) {
			const key = content.slice(0, index).trim();
			if (!/^[A-Za-z][A-Za-z0-9.-]*$/.test(key)) throw new Error("Invalid YAML key");
			return [key, content.slice(index + 1).trim()];
		}
	}
	throw new Error("Expected YAML mapping");
}
function parseYamlSubset(text) {
	if (text.trimStart().startsWith("{")) return JSON.parse(text);
	const tokens = [];
	for (const rawLine of text.split(/\r?\n/)) {
		if (/^\s*\t/.test(rawLine)) throw new Error("Tab indentation is not supported");
		const withoutComment = stripYamlComment(rawLine).replace(/\s+$/, "");
		if (!withoutComment.trim() || withoutComment.trim() === "---") continue;
		const indent = withoutComment.length - withoutComment.trimStart().length;
		tokens.push({
			indent,
			content: withoutComment.trimStart()
		});
	}
	if (tokens.length === 0) throw new Error("Empty YAML");
	function parseBlock(start, indent) {
		return tokens[start].content.startsWith("-") ? parseSequence(start, indent) : parseMap(start, indent);
	}
	function parseMap(start, indent) {
		const output = {};
		let index = start;
		while (index < tokens.length && tokens[index].indent === indent && !tokens[index].content.startsWith("-")) {
			const [key, rest] = splitYamlPair(tokens[index].content);
			if (Object.hasOwn(output, key)) throw new Error("Duplicate YAML key");
			index += 1;
			if (rest) output[key] = parseScalar(rest);
			else if (index < tokens.length && tokens[index].indent > indent) {
				const parsed = parseBlock(index, tokens[index].indent);
				output[key] = parsed.value;
				index = parsed.index;
			} else output[key] = null;
		}
		return {
			value: output,
			index
		};
	}
	function parseSequence(start, indent) {
		const output = [];
		let index = start;
		while (index < tokens.length && tokens[index].indent === indent && tokens[index].content.startsWith("-")) {
			const rest = tokens[index].content.slice(1).trim();
			index += 1;
			if (!rest) {
				if (index >= tokens.length || tokens[index].indent <= indent) throw new Error("Empty YAML sequence item");
				const parsed = parseBlock(index, tokens[index].indent);
				output.push(parsed.value);
				index = parsed.index;
				continue;
			}
			if (rest.includes(":")) {
				const item = {};
				const [key, value] = splitYamlPair(rest);
				item[key] = value ? parseScalar(value) : null;
				if (index < tokens.length && tokens[index].indent > indent) {
					const parsed = parseMap(index, tokens[index].indent);
					Object.assign(item, parsed.value);
					index = parsed.index;
				}
				output.push(item);
			} else output.push(parseScalar(rest));
		}
		return {
			value: output,
			index
		};
	}
	const parsed = parseBlock(0, tokens[0].indent);
	if (parsed.index !== tokens.length || !parsed.value || Array.isArray(parsed.value)) throw new Error("Invalid YAML document");
	return parsed.value;
}
function validateManifestObject(value) {
	return validateProjectManifest(value);
}
async function readBytes(info, relativePath, root, budget, collector, blocking = false) {
	if (info.stat.size > budget.preferences.maxFileBytes) {
		collector.add("FILE_TOO_LARGE", blocking ? "blocking" : "warning", "A file exceeded the configured per-file read limit.", {
			relativePath,
			byteSize: info.stat.size,
			maximumBytes: budget.preferences.maxFileBytes
		});
		return null;
	}
	if (budget.bytesRead + info.stat.size > budget.preferences.maxBytes) {
		noteLimit(budget, collector, "maxBytes");
		return null;
	}
	try {
		const before = await realpath(info.displayPath);
		if (!isWithin$1(root.realPath, before)) throw Object.assign(/* @__PURE__ */ new Error("path escape"), { code: "PATH_ESCAPE" });
		const remainingBytes = budget.preferences.maxBytes - budget.bytesRead;
		const maximumRead = Math.min(budget.preferences.maxFileBytes, remainingBytes);
		let handle;
		let bytes;
		try {
			handle = await open(before, "r");
			const initialStat = await handle.stat();
			if (initialStat.size > budget.preferences.maxFileBytes) {
				collector.add("FILE_TOO_LARGE", blocking ? "blocking" : "warning", "A file exceeded the configured per-file read limit.", {
					relativePath,
					byteSize: initialStat.size,
					maximumBytes: budget.preferences.maxFileBytes
				});
				return null;
			}
			if (initialStat.size > remainingBytes) {
				noteLimit(budget, collector, "maxBytes");
				return null;
			}
			const buffer = Buffer.allocUnsafe(maximumRead + 1);
			let total = 0;
			while (total < buffer.length) {
				const result = await handle.read(buffer, total, buffer.length - total, total);
				if (result.bytesRead === 0) break;
				total += result.bytesRead;
			}
			const finalStat = await handle.stat();
			if (total > maximumRead) {
				collector.add("FILE_TOO_LARGE", blocking ? "blocking" : "warning", "A file exceeded a configured read limit while it was being scanned.", {
					relativePath,
					maximumBytes: maximumRead
				});
				return null;
			}
			if (initialStat.size !== finalStat.size || finalStat.size !== total) {
				collector.add("ENTRY_CHANGED_DURING_SCAN", blocking ? "blocking" : "warning", "A file changed while it was being scanned and was discarded.", { relativePath });
				return null;
			}
			bytes = buffer.subarray(0, total);
		} finally {
			await handle?.close();
		}
		const after = await realpath(info.displayPath);
		if (comparisonPath$1(before) !== comparisonPath$1(after) || !isWithin$1(root.realPath, after)) {
			collector.add("ENTRY_CHANGED_DURING_SCAN", blocking ? "blocking" : "warning", "A file changed location during the scan and was discarded.", { relativePath });
			return null;
		}
		if (bytes.length > budget.preferences.maxFileBytes) {
			collector.add("FILE_TOO_LARGE", blocking ? "blocking" : "warning", "A file exceeded the configured per-file read limit.", {
				relativePath,
				byteSize: bytes.length,
				maximumBytes: budget.preferences.maxFileBytes
			});
			return null;
		}
		if (budget.bytesRead + bytes.length > budget.preferences.maxBytes) {
			noteLimit(budget, collector, "maxBytes");
			return null;
		}
		budget.bytesRead += bytes.length;
		return bytes;
	} catch (error) {
		const access = error?.code === "EACCES" || error?.code === "EPERM";
		collector.add(access ? "ENTRY_ACCESS_DENIED" : error?.code === "PATH_ESCAPE" ? "PATH_ESCAPE_BLOCKED" : "FILE_READ_FAILED", blocking ? "blocking" : "warning", "A file could not be safely read and was skipped.", {
			relativePath,
			causeCode: error?.code ?? "UNKNOWN"
		});
		return null;
	}
}
async function scanProjectInternal(root, preferences, budget) {
	const collector = createIssueCollector();
	const documents = [];
	const documentByPath = /* @__PURE__ */ new Map();
	const markers = [];
	const confidenceEvidence = [];
	const summaryCandidates = [];
	const startStats = {
		entries: budget.entries,
		documents: budget.documents,
		bytesRead: budget.bytesRead,
		skippedDirectories: budget.skippedDirectories
	};
	const manifestRelativePath = ".dsh-project/project.yaml";
	let manifest = null;
	let parsedManifest = null;
	let manifestStructurallyValid = false;
	const manifestRoles = /* @__PURE__ */ new Map();
	const manifestRequirements = /* @__PURE__ */ new Map();
	const addMarker = (kind, relativePath, location, weight, detail) => {
		if (markers.some((marker) => marker.kind === kind && marker.relativePath === relativePath)) return;
		const marker = Object.freeze({
			kind,
			relativePath,
			location,
			weight,
			detail
		});
		markers.push(marker);
		if (confidenceEvidence.length < 40) confidenceEvidence.push(Object.freeze({
			kind: "project_marker",
			relativePath,
			detail,
			weight
		}));
	};
	const manifestDisplayPath = join(root.displayPath, ...manifestRelativePath.split("/"));
	try {
		await lstat(manifestDisplayPath);
		const info = await inspectEntry(root, manifestDisplayPath, manifestRelativePath, collector, true);
		if (info?.stat.isFile()) {
			const bytes = await readBytes(info, manifestRelativePath, root, budget, collector, true);
			if (bytes) {
				const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
				try {
					parsedManifest = parseYamlSubset(decodeText(bytes));
					const validation = validateManifestObject(parsedManifest);
					const unsupported = parsedManifest?.apiVersion && parsedManifest.apiVersion !== "project-control.dsh/v1alpha1";
					manifestStructurallyValid = validation.valid;
					manifest = {
						relativePath: manifestRelativePath,
						status: validation.valid ? "validating_bindings" : unsupported ? "unsupported" : "invalid",
						sha256,
						apiVersion: typeof parsedManifest?.apiVersion === "string" ? parsedManifest.apiVersion : null,
						projectId: PROJECT_ID$1.test(parsedManifest?.metadata?.projectId ?? "") ? parsedManifest.metadata.projectId : null,
						name: typeof parsedManifest?.metadata?.name === "string" ? parsedManifest.metadata.name.slice(0, 120) : null,
						origin: parsedManifest?.metadata?.origin && typeof parsedManifest.metadata.origin === "object" ? parsedManifest.metadata.origin : null,
						errors: validation.errors.slice(0, 20)
					};
					addMarker("managed_manifest", manifestRelativePath, "root", validation.valid ? 100 : 90, "Standard Project Control manifest");
					if (!validation.valid) collector.add(unsupported ? "MANIFEST_VERSION_UNSUPPORTED" : "MANIFEST_INVALID", "blocking", "The existing Project Control manifest cannot be trusted for registration.", {
						relativePath: manifestRelativePath,
						errors: validation.errors.slice(0, 10)
					});
					if (validation.valid) for (const entry of parsedManifest.spec.documents.entries) {
						const list = manifestRoles.get(entry.path) ?? [];
						list.push(entry.role);
						manifestRoles.set(entry.path, list);
						manifestRequirements.set(entry.path, manifestRequirements.get(entry.path) === true || entry.required === true);
					}
				} catch (error) {
					manifest = {
						relativePath: manifestRelativePath,
						status: "invalid",
						sha256,
						apiVersion: null,
						projectId: null,
						name: null,
						origin: null,
						errors: [{
							field: "$",
							reason: "parse_failed"
						}]
					};
					addMarker("managed_manifest", manifestRelativePath, "root", 90, "Unreadable Project Control manifest");
					collector.add("MANIFEST_PARSE_FAILED", "blocking", "The existing Project Control manifest could not be parsed.", { relativePath: manifestRelativePath });
				}
			} else {
				manifest = {
					relativePath: manifestRelativePath,
					status: "unreadable",
					sha256: null,
					apiVersion: null,
					projectId: null,
					name: null,
					origin: null,
					errors: []
				};
				addMarker("managed_manifest", manifestRelativePath, "root", 90, "Unreadable Project Control manifest");
			}
		} else {
			manifest = {
				relativePath: manifestRelativePath,
				status: "invalid",
				sha256: null,
				apiVersion: null,
				projectId: null,
				name: null,
				origin: null,
				errors: [{
					field: "$",
					reason: "not_file"
				}]
			};
			addMarker("managed_manifest", manifestRelativePath, "root", 90, "Invalid Project Control manifest entry");
			collector.add("MANIFEST_NOT_FILE", "blocking", "The standard manifest path is not a regular file.", { relativePath: manifestRelativePath });
		}
	} catch (error) {
		if (error?.code !== "ENOENT") collector.add("MANIFEST_ACCESS_FAILED", "blocking", "The standard manifest location could not be inspected.", {
			relativePath: manifestRelativePath,
			causeCode: error?.code ?? "UNKNOWN"
		});
	}
	async function processDocument(info, relativePath, explicit = false) {
		if (documentByPath.has(relativePath)) return documentByPath.get(relativePath);
		if (budget.documents >= preferences.maxDocuments) {
			noteLimit(budget, collector, "maxDocuments");
			return null;
		}
		if (!info.stat.isFile()) return null;
		const bytes = await readBytes(info, relativePath, root, budget, collector, explicit);
		if (!bytes) return null;
		let text;
		try {
			text = decodeText(bytes);
		} catch (error) {
			collector.add(error?.code === "BINARY_CONTENT" ? "BINARY_DOCUMENT_SKIPPED" : "TEXT_ENCODING_UNSUPPORTED", explicit ? "blocking" : "warning", "A candidate document was not safe UTF-8/UTF-16 text and was skipped.", { relativePath });
			return null;
		}
		const title = extractTitle(text);
		const classification = classifyDocument(relativePath, title, manifestRoles.get(relativePath) ?? []);
		const document = {
			relativePath,
			displayPath: info.displayPath,
			realPath: info.realPath,
			normalizedPath: info.normalizedPath,
			suggestedRole: classification.suggestedRole,
			roleCandidates: classification.roleCandidates,
			title,
			preview: makePreview(text, preferences.previewChars),
			sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
			byteSize: bytes.length,
			mtime: info.stat.mtime.toISOString(),
			observedAt: (/* @__PURE__ */ new Date()).toISOString(),
			evidence: Object.freeze({ signals: Object.freeze(classification.roleCandidates.flatMap((candidate) => candidate.evidence.map((evidence) => Object.freeze({
				role: candidate.role,
				score: candidate.score,
				...evidence
			}))).slice(0, 20)) })
		};
		documents.push(Object.freeze(document));
		documentByPath.set(relativePath, document);
		budget.documents += 1;
		summaryCandidates.push(...extractSummaryCandidates(text, relativePath, classification.suggestedRole));
		if (classification.suggestedRole && classification.suggestedRole !== "other" && confidenceEvidence.length < 40) confidenceEvidence.push(Object.freeze({
			kind: "document_role",
			relativePath,
			detail: classification.suggestedRole,
			weight: Math.min(25, classification.roleCandidates[0]?.score / 5)
		}));
		if (!classification.suggestedRole && classification.roleCandidates.length > 1) collector.add("AMBIGUOUS_DOCUMENT_ROLE", "warning", "A document matched multiple roles and needs confirmation.", {
			relativePath,
			roles: classification.roleCandidates.map((item) => item.role)
		});
		return document;
	}
	if (manifestStructurallyValid) {
		let requiredBindingsSafe = true;
		for (const [relativePath, required] of manifestRequirements) {
			const info = await inspectEntry(root, join(root.displayPath, ...relativePath.split("/")), relativePath, collector, required);
			if (!info?.stat.isFile()) {
				if (required) requiredBindingsSafe = false;
				collector.add(required ? "MANIFEST_REQUIRED_DOCUMENT_UNAVAILABLE" : "MANIFEST_OPTIONAL_DOCUMENT_UNAVAILABLE", required ? "blocking" : "warning", required ? "A required manifest document binding could not be resolved to a safe readable file." : "An optional manifest document binding is currently unavailable and will not be indexed.", { relativePath });
				continue;
			}
			if (await processDocument(info, relativePath, required) === null) {
				if (required) requiredBindingsSafe = false;
				collector.add(required ? "MANIFEST_REQUIRED_DOCUMENT_UNAVAILABLE" : "MANIFEST_OPTIONAL_DOCUMENT_UNAVAILABLE", required ? "blocking" : "warning", required ? "A required manifest document binding could not be read and hashed safely." : "An optional manifest document binding could not be read and hashed and will not be indexed.", { relativePath });
			}
		}
		manifest.status = requiredBindingsSafe ? "valid" : "invalid";
		if (!requiredBindingsSafe) manifestStructurallyValid = false;
	}
	const visitedDirectories = new Set([comparisonPath$1(root.realPath)]);
	async function walk(displayDirectory, realDirectory, depth) {
		if (depth > preferences.maxDepth || budget.entries >= preferences.maxEntries) {
			if (budget.entries >= preferences.maxEntries) noteLimit(budget, collector, "maxEntries");
			return;
		}
		let entries;
		try {
			entries = await readdir(realDirectory, { withFileTypes: true });
		} catch (error) {
			collector.add(error?.code === "EACCES" || error?.code === "EPERM" ? "DIRECTORY_ACCESS_DENIED" : "DIRECTORY_READ_FAILED", "warning", "A directory could not be enumerated and was skipped.", {
				relativePath: safeRelative(root, displayDirectory) ?? ".",
				causeCode: error?.code ?? "UNKNOWN"
			});
			return;
		}
		entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
		for (const entry of entries) {
			if (budget.entries >= preferences.maxEntries) {
				noteLimit(budget, collector, "maxEntries");
				return;
			}
			budget.entries += 1;
			const displayPath = join(displayDirectory, entry.name);
			const relativePath = safeRelative(root, displayPath);
			if (!relativePath) {
				collector.add("INVALID_RELATIVE_PATH", "warning", "An entry did not produce a safe project-relative path.", {});
				continue;
			}
			const lowerName = entry.name.toLocaleLowerCase("en-US");
			if (depth === 0 && (lowerName === ".git" || lowerName === ".hg" || lowerName === ".svn")) addMarker("repository", relativePath, "root", 45, `${entry.name} repository marker`);
			if (entry.isDirectory() && isIgnoredDirectoryName(lowerName)) {
				budget.skippedDirectories += 1;
				continue;
			}
			const info = await inspectEntry(root, displayPath, relativePath, collector);
			if (!info) continue;
			if (info.stat.isDirectory()) {
				if (isIgnoredDirectoryName(lowerName)) {
					budget.skippedDirectories += 1;
					continue;
				}
				const key = comparisonPath$1(info.realPath);
				if (visitedDirectories.has(key)) {
					collector.add("DIRECTORY_CYCLE_SKIPPED", "info", "A duplicate directory target was skipped.", { relativePath });
					continue;
				}
				visitedDirectories.add(key);
				if (depth < preferences.maxDepth) await walk(displayPath, info.realPath, depth + 1);
				continue;
			}
			if (!info.stat.isFile()) continue;
			if (relativePath.toLocaleLowerCase("en-US").endsWith("/.dsh-project/project.yaml")) {
				addMarker("nested_managed_manifest", relativePath, "nested", 20, "Nested Project Control manifest");
				collector.add("NESTED_MANIFEST_DETECTED", "warning", "A nested Project Control manifest does not change the selected outer project root.", { relativePath });
				continue;
			}
			const markerKind = PROJECT_MARKERS.get(lowerName) ?? (/\.(?:sln|csproj|fsproj|vbproj)$/i.test(entry.name) ? "dotnet_manifest" : null);
			if (markerKind) addMarker(markerKind, relativePath, depth === 0 ? "root" : "nested", depth === 0 ? 35 : 12, `${entry.name} project marker`);
			if (relativePath !== manifestRelativePath && shouldReadDocument(relativePath, manifestRoles)) await processDocument(info, relativePath, manifestRoles.has(relativePath));
			else if (relativePath === manifestRelativePath && depth > 1) collector.add("NESTED_MANIFEST_DETECTED", "warning", "A nested Project Control manifest does not change the selected outer project root.", { relativePath });
		}
	}
	await walk(root.displayPath, root.realPath, 0);
	documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
	if (manifest === null) for (const role of DOCUMENT_ROLES$2) {
		if (role === "other") continue;
		const matches = documents.filter((document) => document.roleCandidates.some((candidate) => candidate.role === role && candidate.score >= 65));
		if (matches.length > 1) collector.add("MULTIPLE_ROLE_CANDIDATES", "warning", "Multiple documents matched the same role; no primary document was selected.", {
			role,
			count: matches.length,
			relativePaths: matches.slice(0, 10).map((document) => document.relativePath)
		});
	}
	const nameCandidates = [];
	if (manifestStructurallyValid && manifest?.name) nameCandidates.push({
		value: manifest.name,
		kind: "manifest",
		relativePath: manifestRelativePath,
		confidence: "high",
		score: 100
	});
	for (const document of documents) {
		if (!document.title) continue;
		if (document.roleCandidates.some((candidate) => candidate.role === "prd" && candidate.score >= 65)) nameCandidates.push({
			value: document.title,
			kind: "prd_title",
			relativePath: document.relativePath,
			confidence: "high",
			score: 90
		});
		else if (document.roleCandidates.some((candidate) => candidate.role === "readme" && candidate.score >= 65)) nameCandidates.push({
			value: document.title,
			kind: "readme_title",
			relativePath: document.relativePath,
			confidence: "medium",
			score: 80
		});
	}
	nameCandidates.push({
		value: cleanSuggestedName(basename(root.displayPath)),
		kind: "directory",
		relativePath: null,
		confidence: "low",
		score: 50
	});
	const manifestNames = nameCandidates.filter((item) => item.kind === "manifest");
	const prdNames = nameCandidates.filter((item) => item.kind === "prd_title");
	const rootReadmes = nameCandidates.filter((item) => item.kind === "readme_title" && !item.relativePath.includes("/"));
	const selectedNameCandidate = manifestNames.length === 1 ? manifestNames[0] : prdNames.length === 1 ? prdNames[0] : rootReadmes.length === 1 ? rootReadmes[0] : nameCandidates.at(-1);
	const suggestedName = cleanSuggestedName(selectedNameCandidate.value);
	const uniqueSummaries = [];
	const summaryKeys = /* @__PURE__ */ new Set();
	for (const candidate of summaryCandidates.sort((left, right) => right.score - left.score)) {
		const key = candidate.value.toLocaleLowerCase("en-US");
		if (!summaryKeys.has(key)) {
			summaryKeys.add(key);
			uniqueSummaries.push(candidate);
		}
	}
	const selectedSummary = uniqueSummaries.length === 1 ? uniqueSummaries[0] : null;
	if (uniqueSummaries.length > 1) collector.add("MULTIPLE_SUMMARY_CANDIDATES", "warning", "Multiple explicit goal or summary statements were found; none was selected automatically.", {
		count: uniqueSummaries.length,
		sources: uniqueSummaries.slice(0, 10).map((item) => item.source)
	});
	const score = Math.min(100, Math.round(confidenceEvidence.reduce((total, evidence) => total + evidence.weight, 0)));
	const isCandidate = score > 0;
	let manifestDocumentBindings = manifestStructurallyValid ? parsedManifest.spec.documents.entries.map((entry) => ({
		role: entry.role,
		relativePath: entry.path,
		contentHash: documentByPath.get(entry.path)?.sha256 ?? null,
		required: entry.required ?? false
	})) : [];
	let persistedManifest = manifestStructurallyValid ? Object.freeze({
		projectId: manifest.projectId,
		hash: manifest.sha256,
		name: manifest.name,
		relativePath: manifestRelativePath,
		origin: Object.freeze({ ...manifest.origin }),
		documentBindings: Object.freeze(manifestDocumentBindings.map((binding) => Object.freeze({ ...binding })))
	}) : null;
	if (persistedManifest && Buffer.byteLength(JSON.stringify(persistedManifest), "utf8") > 1e4) {
		collector.add("MANIFEST_SNAPSHOT_TOO_LARGE", "blocking", "The verified manifest metadata is too large for a safe restart-persistent intake snapshot.", { relativePath: manifestRelativePath });
		manifestStructurallyValid = false;
		manifest.status = "invalid";
		manifestDocumentBindings = [];
		persistedManifest = null;
	}
	const status = manifest && !manifestStructurallyValid ? "conflict" : "discovered";
	const detectedMode = manifestStructurallyValid ? "managed" : manifest ? "unknown" : isCandidate ? "linked_legacy" : "unknown";
	const endStats = {
		entries: budget.entries,
		documents: budget.documents,
		bytesRead: budget.bytesRead,
		skippedDirectories: budget.skippedDirectories
	};
	const rootCopy = pathRecord(root.displayPath, root.realPath);
	const persistedEvidence = [...confidenceEvidence];
	const confidence = {
		level: confidenceLevel(score),
		score,
		evidence: persistedEvidence,
		nameSource: {
			relativePath: selectedNameCandidate.relativePath,
			label: selectedNameCandidate.kind
		},
		manifest: persistedManifest
	};
	while (persistedEvidence.length > 0 && Buffer.byteLength(JSON.stringify(confidence), "utf8") > 16e3) persistedEvidence.pop();
	confidence.evidence = Object.freeze(persistedEvidence);
	confidence.nameSource = Object.freeze(confidence.nameSource);
	return Object.freeze({
		root: rootCopy,
		displayPath: rootCopy.displayPath,
		realPath: rootCopy.realPath,
		normalizedPath: rootCopy.normalizedPath,
		isCandidate,
		detectedMode,
		status,
		manifestStatus: manifest?.status ?? "absent",
		manifestProjectId: manifestStructurallyValid ? manifest.projectId : null,
		manifestHash: manifestStructurallyValid ? manifest.sha256 : null,
		manifestName: manifestStructurallyValid ? manifest.name : null,
		manifestOrigin: manifestStructurallyValid ? manifest.origin : null,
		manifestDocumentBindings: Object.freeze(manifestDocumentBindings.map(Object.freeze)),
		manifest: manifest ? Object.freeze({
			...manifest,
			errors: Object.freeze(manifest.errors.map(Object.freeze))
		}) : null,
		suggestedName,
		nameCandidates: Object.freeze(nameCandidates.map(Object.freeze)),
		suggestedSummary: selectedSummary?.value ?? null,
		summarySource: selectedSummary ? `${selectedSummary.source.relativePath}:${selectedSummary.source.line}`.slice(0, 512) : null,
		summary: Object.freeze({
			value: selectedSummary?.value ?? null,
			source: selectedSummary ? Object.freeze(selectedSummary.source) : null
		}),
		confidence: Object.freeze(confidence),
		markers: Object.freeze(markers),
		documents: Object.freeze(documents),
		issues: Object.freeze(collector.issues),
		scanStats: Object.freeze({
			entriesVisited: endStats.entries - startStats.entries,
			documentsRead: endStats.documents - startStats.documents,
			bytesRead: endStats.bytesRead - startStats.bytesRead,
			skippedDirectories: endStats.skippedDirectories - startStats.skippedDirectories,
			limitsReached: Object.freeze([...budget.limits])
		})
	});
}
function scanEnvelope(mode, root, preferences, candidates, issues, budget) {
	const rootPath = pathRecord(root.displayPath, root.realPath);
	const scanPreferences = Object.freeze({
		...preferences,
		ignoredDirectories: Object.freeze([...IGNORED_DIRECTORIES$1].sort())
	});
	return Object.freeze({
		mode,
		scannerVersion: SCANNER_VERSION,
		rootPath,
		sourceRoot: Object.freeze({
			...rootPath,
			scanPreferences,
			isEnabled: true
		}),
		scanPreferences,
		status: "completed",
		summary: Object.freeze({
			candidateCount: candidates.length,
			issueCount: issues.length + candidates.reduce((total, candidate) => total + candidate.issues.length, 0),
			entriesVisited: budget.entries,
			documentsRead: budget.documents,
			bytesRead: budget.bytesRead,
			skippedDirectories: budget.skippedDirectories,
			limitsReached: Object.freeze([...budget.limits]),
			projectDirectoriesModified: 0
		}),
		candidates: Object.freeze(candidates),
		issues: Object.freeze(issues)
	});
}
async function scanProjectDirectory$1(rootPath, options = {}) {
	const preferences = normalizeOptions(options);
	const root = await resolveDirectoryRoot(rootPath, "Project root");
	const budget = createBudget(preferences);
	return scanEnvelope("single_project", root, preferences, [await scanProjectInternal(root, preferences, budget)], [], budget);
}
async function scanSourceDirectory$1(rootPath, options = {}) {
	const preferences = normalizeOptions(options);
	const root = await resolveDirectoryRoot(rootPath, "Source root");
	const budget = createBudget(preferences);
	const sourceIssues = createIssueCollector();
	const candidates = [];
	const visited = new Set([comparisonPath$1(root.realPath)]);
	async function visit(displayDirectory, realDirectory, depth) {
		if (depth >= preferences.sourceDepth || candidates.length >= preferences.maxCandidates || budget.entries >= preferences.maxEntries) return;
		let entries;
		try {
			entries = await readdir(realDirectory, { withFileTypes: true });
		} catch (error) {
			sourceIssues.add(error?.code === "EACCES" || error?.code === "EPERM" ? "DIRECTORY_ACCESS_DENIED" : "DIRECTORY_READ_FAILED", "warning", "A source directory could not be enumerated.", {
				relativePath: safeRelative(root, displayDirectory) ?? ".",
				causeCode: error?.code ?? "UNKNOWN"
			});
			return;
		}
		entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
		for (const entry of entries) {
			if (candidates.length >= preferences.maxCandidates) {
				noteLimit(budget, sourceIssues, "maxCandidates");
				return;
			}
			if (budget.entries >= preferences.maxEntries) {
				noteLimit(budget, sourceIssues, "maxEntries");
				return;
			}
			if (isIgnoredDirectoryName(entry.name.toLocaleLowerCase("en-US"))) {
				budget.skippedDirectories += 1;
				continue;
			}
			const displayPath = join(displayDirectory, entry.name);
			const relativePath = safeRelative(root, displayPath);
			if (!relativePath) continue;
			budget.entries += 1;
			const info = await inspectEntry(root, displayPath, relativePath, sourceIssues);
			if (!info?.stat.isDirectory()) continue;
			const key = comparisonPath$1(info.realPath);
			if (visited.has(key)) continue;
			visited.add(key);
			const candidate = await scanProjectInternal(pathRecord(displayPath, info.realPath), preferences, budget);
			if (candidate.isCandidate) candidates.push(candidate);
			else if (depth + 1 < preferences.sourceDepth) await visit(displayPath, info.realPath, depth + 1);
		}
	}
	await visit(root.displayPath, root.realPath, 0);
	candidates.sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath, "en"));
	return scanEnvelope("source_root", root, preferences, candidates, sourceIssues.issues, budget);
}
//#endregion
//#region src/discovery/index.ts
const scanProjectDirectory = scanProjectDirectory$1;
const scanSourceDirectory = scanSourceDirectory$1;
//#endregion
//#region src/lifecycle-validator.ts
const COMMAND_SCHEMA_PATH$1 = fileURLToPath(new URL("../../../protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-envelope.schema.json", import.meta.url));
const RESULT_SCHEMA_PATH = fileURLToPath(new URL("../../../protocol/project-control/v1alpha1/lifecycle/schemas/lifecycle-command-result.schema.json", import.meta.url));
let commandValidator$1;
let commandValidatorUnavailable$1 = false;
let resultValidator;
let resultValidatorUnavailable = false;
/** Validate the canonical command envelope without maintaining a second schema copy in runtime code. */
function validateLifecycleCommand(value) {
	const validateCommand = getCommandValidator$1();
	if (validateCommand === null) return {
		ok: false,
		reason: "validation_unavailable",
		errors: []
	};
	if (validateCommand(value)) return {
		ok: true,
		value
	};
	return {
		ok: false,
		reason: "schema_invalid",
		errors: (validateCommand.errors ?? []).map(publicValidationIssue$1)
	};
}
/** Validate storage output against the canonical result conditions before exposing it over HTTP. */
function validateLifecycleResult(value) {
	const validateResult = getResultValidator();
	if (validateResult === null) return {
		ok: false,
		reason: "validation_unavailable",
		errors: []
	};
	if (validateResult(value)) return {
		ok: true,
		value
	};
	return {
		ok: false,
		reason: "schema_invalid",
		errors: (validateResult.errors ?? []).map(publicValidationIssue$1)
	};
}
function getCommandValidator$1() {
	if (commandValidator$1 !== void 0) return commandValidator$1;
	if (commandValidatorUnavailable$1) return null;
	try {
		commandValidator$1 = compileSchema$1(COMMAND_SCHEMA_PATH$1);
		return commandValidator$1;
	} catch {
		commandValidatorUnavailable$1 = true;
		return null;
	}
}
function getResultValidator() {
	if (resultValidator !== void 0) return resultValidator;
	if (resultValidatorUnavailable) return null;
	try {
		resultValidator = compileSchema$1(RESULT_SCHEMA_PATH);
		return resultValidator;
	} catch {
		resultValidatorUnavailable = true;
		return null;
	}
}
function compileSchema$1(schemaPath) {
	const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
	const ajv = new import__2020.default({
		allErrors: true,
		strict: true
	});
	(0, import_dist.default)(ajv);
	return ajv.compile(schema);
}
function publicValidationIssue$1(error) {
	return {
		instancePath: error.instancePath,
		keyword: error.keyword,
		message: error.message ?? "schema validation failed"
	};
}
//#endregion
//#region src/external-update-validator.ts
const COMMAND_SCHEMA_PATH = fileURLToPath(new URL("../../../protocol/project-control/v1alpha1/schemas/command-envelope.schema.json", import.meta.url));
let commandValidator;
let commandValidatorUnavailable = false;
/** Validate the canonical external update envelope without a second schema copy in runtime code. */
function validateExternalUpdateCommand(value) {
	const validateCommand = getCommandValidator();
	if (validateCommand === null) return {
		ok: false,
		reason: "validation_unavailable",
		errors: []
	};
	if (validateCommand(value)) return {
		ok: true,
		value
	};
	return {
		ok: false,
		reason: "schema_invalid",
		errors: (validateCommand.errors ?? []).map(publicValidationIssue)
	};
}
function getCommandValidator() {
	if (commandValidator !== void 0) return commandValidator;
	if (commandValidatorUnavailable) return null;
	try {
		commandValidator = compileSchema(COMMAND_SCHEMA_PATH);
		return commandValidator;
	} catch {
		commandValidatorUnavailable = true;
		return null;
	}
}
function compileSchema(schemaPath) {
	const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
	const ajv = new import__2020.default({
		allErrors: true,
		strict: true
	});
	(0, import_dist.default)(ajv);
	return ajv.compile(schema);
}
function publicValidationIssue(error) {
	return {
		instancePath: error.instancePath,
		keyword: error.keyword,
		message: error.message ?? "schema validation failed"
	};
}
const PROJECT_WORKSPACE_MAX_TEXT_BYTES = 262144;
const IGNORED_DIRECTORIES = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	"dist",
	"build",
	"out",
	"target",
	"coverage",
	".next",
	"artifacts",
	".cache",
	"cache",
	"__pycache__",
	".pnpm-store",
	".yarn",
	"tmp",
	"$recycle.bin",
	"lib",
	"分发包"
]);
const TEXT_EXTENSIONS$1 = new Set([
	".md",
	".markdown",
	".mdx",
	".txt",
	".rst",
	".json",
	".jsonc",
	".yml",
	".yaml",
	".toml",
	".ini",
	".cfg",
	".env",
	".gitignore",
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".css",
	".html",
	".htm",
	".xml",
	".csv",
	".log",
	".sql",
	".sh",
	".ps1",
	".bat",
	".cmd",
	".py",
	".rs",
	".go",
	".java",
	".c",
	".h",
	".cpp",
	".hpp",
	".cs",
	".rb",
	".php",
	".swift",
	".kt",
	".vue",
	".svelte",
	".scss",
	".less"
]);
function workspaceHttpError(code, message, status) {
	return projectControlHttpError(code, message, status);
}
function safeRelativePath(_root, relativePath) {
	if (typeof relativePath !== "string" || relativePath.length > 2048) throw workspaceHttpError("PATH_INVALID", "工作区路径无效。", 400);
	if (relativePath.includes("\0") || relativePath.startsWith("/") || relativePath.startsWith("\\") || isAbsolute(relativePath)) throw workspaceHttpError("PATH_INVALID", "工作区路径无效。", 400);
	return relativePath;
}
async function resolveInside(root, relativePath) {
	const absolute = resolve(root, safeRelativePath(root, relativePath));
	if (!(absolute === root || absolute.startsWith(root + sep))) throw workspaceHttpError("PATH_OUTSIDE_WORKSPACE", "路径超出工作区。", 403);
	const realRoot = await realpath(root);
	const real = await realpath(absolute).catch(() => null);
	if (real !== null && real !== realRoot && !real.startsWith(realRoot + sep)) throw workspaceHttpError("SYMLINK_ESCAPE", "路径通过符号链接逃出了工作区。", 403);
	return absolute;
}
function sha256$3(buffer) {
	return "sha256:" + createHash("sha256").update(buffer).digest("hex");
}
function mimeFor(relativePath) {
	switch (relativePath.slice(relativePath.lastIndexOf(".")).toLowerCase()) {
		case ".png": return "image/png";
		case ".jpg":
		case ".jpeg": return "image/jpeg";
		case ".webp": return "image/webp";
		case ".gif": return "image/gif";
		case ".svg": return "image/svg+xml";
		case ".pdf": return "application/pdf";
		case ".txt":
		case ".md":
		case ".log": return "text/plain; charset=utf-8";
		default: return "application/octet-stream";
	}
}
async function listProjectWorkspaceTree(root, relativePath) {
	const target = await resolveInside(root, relativePath);
	const info = await stat(target).catch(() => null);
	if (info === null || !info.isDirectory()) throw workspaceHttpError("NOT_A_DIRECTORY", "目标不是目录。", 404);
	const names = await readdir(target, { withFileTypes: true });
	return {
		entries: names.filter((entry) => !entry.name.startsWith(".dsh-staging.") && !IGNORED_DIRECTORIES.has(entry.name.toLowerCase())).slice(0, 200).map((entry) => ({
			name: entry.name,
			kind: entry.isDirectory() ? "directory" : "file",
			...entry.isDirectory() ? {} : { byteSize: 0 }
		})).sort((left, right) => {
			if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
			return left.name.localeCompare(right.name, "en");
		}),
		truncated: names.length > 200
	};
}
async function readProjectWorkspaceFile(root, relativePath) {
	const target = await resolveInside(root, relativePath);
	const info = await stat(target).catch(() => null);
	if (info === null || !info.isFile()) throw workspaceHttpError("NOT_A_FILE", "目标不是文件。", 404);
	if (info.size > 5242880) return {
		kind: "binary",
		byteSize: info.size,
		tooLarge: true,
		mime: mimeFor(target)
	};
	const extension = target.slice(target.lastIndexOf(".")).toLowerCase();
	if (!TEXT_EXTENSIONS$1.has(extension)) return {
		kind: "binary",
		byteSize: info.size,
		mime: mimeFor(target)
	};
	const buffer = await readFile(target);
	if (buffer.includes(0)) return {
		kind: "binary",
		byteSize: info.size,
		mime: mimeFor(target)
	};
	const truncated = buffer.length > PROJECT_WORKSPACE_MAX_TEXT_BYTES;
	return {
		kind: "text",
		content: buffer.subarray(0, PROJECT_WORKSPACE_MAX_TEXT_BYTES).toString("utf8"),
		truncated,
		byteSize: info.size,
		sha256: sha256$3(buffer)
	};
}
async function searchProjectWorkspaceFiles(root, query) {
	const results = [];
	const queue = [""];
	while (queue.length > 0 && results.length < 100) {
		const dirPath = queue.shift() ?? "";
		if ((dirPath === "" ? 0 : dirPath.split("/").length) >= 8) continue;
		const target = await resolveInside(root, dirPath);
		const info = await stat(target).catch(() => null);
		if (info === null || !info.isDirectory()) continue;
		const names = await readdir(target, { withFileTypes: true });
		for (const entry of names) {
			if (entry.name.startsWith(".dsh-staging.") || IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
			const child = dirPath === "" ? entry.name : dirPath + "/" + entry.name;
			if (entry.isDirectory()) {
				if (queue.length < 1600) queue.push(child);
			} else if (entry.name.toLowerCase().includes(query)) {
				results.push({
					path: child,
					name: entry.name
				});
				if (results.length >= 100) break;
			}
		}
	}
	return results;
}
async function streamProjectWorkspaceBlob(response, root, relativePath) {
	const target = await resolveInside(root, relativePath);
	const info = await stat(target).catch(() => null);
	if (info === null || !info.isFile()) throw workspaceHttpError("NOT_A_FILE", "目标不是文件。", 404);
	if (info.size > 5242880) throw workspaceHttpError("BLOB_TOO_LARGE", "文件超过预览上限。", 413);
	response.writeHead(200, {
		"content-type": mimeFor(target),
		"content-length": String(info.size),
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	await new Promise((resolveStream, rejectStream) => {
		const stream = createReadStream(target);
		stream.once("error", rejectStream);
		stream.once("end", () => {
			resolveStream();
		});
		stream.pipe(response);
	});
}
//#endregion
//#region src/http.ts
const PROJECT_CONTROL_API_PREFIX = "/__personal/project-control/v1alpha1";
const MAX_BODY_BYTES = 262144;
const PROJECT_CONTROL_API_VERSION = "project-control-host/v1alpha1";
const PROJECT_PROTOCOL_VERSION = "project-control.dsh/v1alpha1";
/** Create a deliberately public HTTP error; arbitrary storage errors remain private. */
function projectControlHttpError(code, message, status = 400, headers) {
	return Object.assign(new Error(message), {
		code,
		status,
		expose: true,
		...headers === void 0 ? {} : { headers }
	});
}
/** Standalone loopback JSON handler used by the Harness Host route and focused tests. */
function createProjectControlRequestHandler(service, options = {}) {
	return async (request, response) => {
		try {
			if (request.headers["x-dsh-personal-client"] !== "1") throw projectControlHttpError("PROJECT_CONTROL_CLIENT_REQUIRED", "此接口只供个人桌面项目控制台使用。", 403);
			const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
			if (parsed.pathname !== "/__personal/project-control/v1alpha1" && !parsed.pathname.startsWith(`/__personal/project-control/v1alpha1/`)) throw projectControlHttpError("NOT_FOUND", "项目控制台接口不存在。", 404);
			const resource = parsed.pathname.slice(36);
			if (resource === "/status") {
				requireGetWithoutBody(request);
				const status = normalizeStatus(await service.getStatus());
				sendJson(response, 200, {
					ok: true,
					data: {
						apiVersion: PROJECT_CONTROL_API_VERSION,
						protocolVersion: PROJECT_PROTOCOL_VERSION,
						storage: {
							state: status.state,
							schemaVersion: status.schemaVersion,
							writable: status.writable
						},
						counts: { projects: status.projectCount },
						capabilities: [
							"status.read",
							"projects.read",
							...options.lifecycle === void 0 ? [] : ["lifecycle.command.submit"],
							...options.intake === void 0 ? [] : [
								"intake.directory.scan",
								"intake.candidates.read",
								"intake.candidates.review",
								"project.documents.read",
								"project.workspace.read",
								"project.documents.refresh",
								"project.document-rebind.resolve"
							],
							...options.external === void 0 ? [] : [
								"external.handshake",
								"external.update.submit",
								"workitems.read",
								"runs.read",
								"progress.read",
								"reviews.read",
								"review-actions.read",
								"decisions.read",
								"quarantine.read",
								"quarantine.resolve",
								"events.read"
							],
							...options.console === void 0 ? [] : [
								"workitems.write",
								"workitems.status.write",
								"reviews.request",
								"reviews.decide",
								"reviews.comment",
								"runs.start"
							]
						]
					}
				});
				return;
			}
			if (resource === "/projects") {
				requireGetWithoutBody(request);
				sendJson(response, 200, {
					ok: true,
					data: normalizeProjectList(await service.listProjects())
				});
				return;
			}
			if (resource === "/lifecycle") {
				requireMethod(request, "POST");
				const validation = validateLifecycleCommand(await readJsonBody(request));
				if (!validation.ok) {
					if (validation.reason === "validation_unavailable") throw projectControlHttpError("COMMAND_VALIDATION_UNAVAILABLE", "生命周期合同校验器暂不可用；只读项目状态仍可使用。", 503);
					throw projectControlHttpError("SCHEMA_INVALID", "生命周期指令不符合 project-control.dsh/v1alpha1 合同。", 400);
				}
				const resultValidation = validateLifecycleResult(await executeLifecycleCommand(validation.value, options));
				if (!resultValidation.ok) {
					if (resultValidation.reason === "validation_unavailable") throw projectControlHttpError("RESULT_VALIDATION_UNAVAILABLE", "生命周期结果校验器暂不可用；只读项目状态仍可使用。", 503);
					throw new TypeError("lifecycle service returned a result outside the canonical contract");
				}
				sendJson(response, 200, {
					ok: true,
					data: normalizeLifecycleResult(resultValidation.value)
				});
				return;
			}
			if (resource === "/intake/source-roots") {
				requireGetWithoutBody(request);
				const sourceRoots = normalizeSourceRoots(await requireIntake(options).listSourceRoots());
				sendJson(response, 200, {
					ok: true,
					data: {
						sourceRoots,
						total: sourceRoots.length
					}
				});
				return;
			}
			if (resource === "/intake/scan") {
				requireMethod(request, "POST");
				const intake = requireIntake(options);
				const input = normalizeIntakeScanRequest(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeImportScan(await intake.scan(input))
				});
				return;
			}
			if (resource === "/intake/candidates") {
				requireGetWithoutBody(request);
				const intake = requireIntake(options);
				const jobId = optionalSingleQuery(parsed, "jobId", IMPORT_JOB_ID);
				rejectUnexpectedQuery(parsed, new Set(["jobId"]));
				const candidates = normalizeCandidateList(await intake.listCandidates({ ...jobId === void 0 ? {} : { jobId } }));
				sendJson(response, 200, {
					ok: true,
					data: {
						candidates,
						total: candidates.length
					}
				});
				return;
			}
			if (resource === "/handshake") {
				requireMethod(request, "POST");
				const external = requireExternal(options);
				const input = normalizeHandshakeRequest(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeHandshakeResult(await external.handshake(input))
				});
				return;
			}
			if (resource === "/external-updates") {
				requireMethod(request, "POST");
				const external = requireExternal(options);
				const validation = validateExternalUpdateCommand(await readJsonBody(request));
				if (!validation.ok) {
					if (validation.reason === "validation_unavailable") throw projectControlHttpError("COMMAND_VALIDATION_UNAVAILABLE", "外部更新合同校验器暂不可用；只读状态仍可使用。", 503);
					throw projectControlHttpError("SCHEMA_INVALID", "外部运行更新不符合 command-envelope/v1alpha1 合同。", 400);
				}
				sendJson(response, 200, {
					ok: true,
					data: normalizeExternalResult(await external.submitExternalUpdate(validation.value))
				});
				return;
			}
			if (resource === "/quarantine") {
				requireGetWithoutBody(request);
				const external = requireExternal(options);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const result = normalizeQuarantineList(await external.listQuarantineItems());
				sendJson(response, 200, {
					ok: true,
					data: {
						quarantineItems: result,
						total: result.length
					}
				});
				return;
			}
			const quarantineResolveRoute = /^\/quarantine\/(qtn_[0-9a-f-]+)\/resolve$/u.exec(resource);
			if (quarantineResolveRoute !== null) {
				requireMethod(request, "POST");
				const external = requireExternal(options);
				const quarantineId = quarantineResolveRoute[1];
				if (quarantineId === void 0 || !QUARANTINE_ID.test(quarantineId)) throw projectControlHttpError("NOT_FOUND", "隔离项不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const input = normalizeQuarantineResolveRequest(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeQuarantineItem(await external.resolveQuarantineItem(quarantineId, input))
				});
				return;
			}
			const consoleWorkItemsRoute = /^\/projects\/(prj_[0-9a-f-]+)\/work-items$/u.exec(resource);
			if (consoleWorkItemsRoute !== null && (request.method ?? "GET").toUpperCase() === "POST") {
				requireMethod(request, "POST");
				const consoleService = requireConsole(options);
				const projectId = consoleWorkItemsRoute[1];
				if (projectId === void 0 || !PROJECT_ID.test(projectId)) throw projectControlHttpError("NOT_FOUND", "项目不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const input = normalizeCreateWorkItemRequest(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeWorkItem(await consoleService.createWorkItem(projectId, input))
				});
				return;
			}
			const workItemStatusRoute = /^\/projects\/(prj_[0-9a-f-]+)\/work-items\/(wrk_[0-9a-f-]+)\/status$/u.exec(resource);
			if (workItemStatusRoute !== null) {
				requireMethod(request, "POST");
				const consoleService = requireConsole(options);
				const projectId = workItemStatusRoute[1];
				const workItemId = workItemStatusRoute[2];
				if (projectId === void 0 || workItemId === void 0 || !PROJECT_ID.test(projectId) || !WORK_ITEM_ID.test(workItemId)) throw projectControlHttpError("NOT_FOUND", "任务不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const input = normalizeWorkItemStatusRequest(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeWorkItem(await consoleService.setWorkItemStatus(projectId, workItemId, input))
				});
				return;
			}
			const reviewRequestRoute = /^\/projects\/(prj_[0-9a-f-]+)\/work-items\/(wrk_[0-9a-f-]+)\/review-request$/u.exec(resource);
			if (reviewRequestRoute !== null) {
				requireMethod(request, "POST");
				const consoleService = requireConsole(options);
				const projectId = reviewRequestRoute[1];
				const workItemId = reviewRequestRoute[2];
				if (projectId === void 0 || workItemId === void 0 || !PROJECT_ID.test(projectId) || !WORK_ITEM_ID.test(workItemId)) throw projectControlHttpError("NOT_FOUND", "任务不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const input = normalizeReviewRequestRequest(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeReview(await consoleService.requestReview(projectId, workItemId, input))
				});
				return;
			}
			const reviewDecideRoute = /^\/projects\/(prj_[0-9a-f-]+)\/reviews\/(rev_[0-9a-f-]+)\/decide$/u.exec(resource);
			if (reviewDecideRoute !== null) {
				requireMethod(request, "POST");
				const consoleService = requireConsole(options);
				const projectId = reviewDecideRoute[1];
				const reviewId = reviewDecideRoute[2];
				if (projectId === void 0 || reviewId === void 0 || !PROJECT_ID.test(projectId) || !REVIEW_ID.test(reviewId)) throw projectControlHttpError("NOT_FOUND", "审阅不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const input = normalizeReviewDecisionRequest(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeReview(await consoleService.decideReview(projectId, reviewId, input))
				});
				return;
			}
			const reviewCommentRoute = /^\/projects\/(prj_[0-9a-f-]+)\/reviews\/(rev_[0-9a-f-]+)\/comment$/u.exec(resource);
			if (reviewCommentRoute !== null) {
				requireMethod(request, "POST");
				const consoleService = requireConsole(options);
				const projectId = reviewCommentRoute[1];
				const reviewId = reviewCommentRoute[2];
				if (projectId === void 0 || reviewId === void 0 || !PROJECT_ID.test(projectId) || !REVIEW_ID.test(reviewId)) throw projectControlHttpError("NOT_FOUND", "审阅不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const input = normalizeReviewCommentRequest(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeReviewAction(await consoleService.commentReview(projectId, reviewId, input))
				});
				return;
			}
			const reviewActionsRoute = /^\/projects\/(prj_[0-9a-f-]+)\/reviews\/(rev_[0-9a-f-]+)\/actions$/u.exec(resource);
			if (reviewActionsRoute !== null) {
				requireGetWithoutBody(request);
				const external = requireExternal(options);
				const reviewId = reviewActionsRoute[2];
				if (reviewId === void 0 || !REVIEW_ID.test(reviewId)) throw projectControlHttpError("NOT_FOUND", "审阅不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const result = normalizeReviewActionList(await external.listReviewActions(reviewId));
				sendJson(response, 200, {
					ok: true,
					data: {
						actions: result,
						total: result.length
					}
				});
				return;
			}
			const runStartRoute = /^\/projects\/(prj_[0-9a-f-]+)\/runs\/(run_[0-9a-f-]+)\/start$/u.exec(resource);
			if (runStartRoute !== null) {
				requireMethod(request, "POST");
				const consoleService = requireConsole(options);
				const projectId = runStartRoute[1];
				const runId = runStartRoute[2];
				if (projectId === void 0 || runId === void 0 || !PROJECT_ID.test(projectId) || !RUN_ID.test(runId)) throw projectControlHttpError("NOT_FOUND", "运行不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const input = normalizeRunStartRequest(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeRun(await consoleService.startRun(projectId, runId, input))
				});
				return;
			}
			const projectExternalRoute = /^\/projects\/(prj_[0-9a-f-]+)\/(work-items|runs|progress-updates|reviews|decisions|events|sessions)$/u.exec(resource);
			if (projectExternalRoute !== null) {
				requireGetWithoutBody(request);
				const external = requireExternal(options);
				const projectId = projectExternalRoute[1];
				const kind = projectExternalRoute[2];
				if (projectId === void 0 || !PROJECT_ID.test(projectId)) throw projectControlHttpError("NOT_FOUND", "项目不存在。", 404);
				const workItemId = optionalSingleQuery(parsed, "workItemId", /^wrk_[0-9a-f-]{36}$/u);
				const afterSequence = kind === "events" ? optionalSingleQuery(parsed, "afterSequence", /^(?:0|[1-9]\d{0,9})$/u) : void 0;
				rejectUnexpectedQuery(parsed, new Set(kind === "runs" ? ["workItemId"] : kind === "events" ? ["afterSequence"] : []));
				const items = kind === "work-items" ? normalizeWorkItemList(await external.listWorkItems(projectId)) : kind === "runs" ? normalizeRunList(await external.listRuns(projectId, workItemId)) : kind === "progress-updates" ? normalizeProgressList(await external.listProgressUpdates(projectId)) : kind === "reviews" ? normalizeReviewList(await external.listReviews(projectId)) : kind === "events" ? normalizeEventList(await external.listEvents(projectId, afterSequence === void 0 ? void 0 : Number(afterSequence))) : kind === "sessions" ? normalizeSessionList(await external.listSessions(projectId)) : normalizeDecisionList(await external.listDecisions(projectId));
				sendJson(response, 200, {
					ok: true,
					data: {
						items,
						total: items.length
					}
				});
				return;
			}
			if (resource === "/templates") {
				requireGetWithoutBody(request);
				const templates = normalizeTemplateList(await requireIntake(options).listTemplates());
				sendJson(response, 200, {
					ok: true,
					data: {
						templates,
						total: templates.length
					}
				});
				return;
			}
			if (resource === "/intake/prepare-create") {
				requireMethod(request, "POST");
				const intake = requireIntake(options);
				const input = normalizeCreatePreparation(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeCreatePreparationResult(await intake.prepareCreate(input))
				});
				return;
			}
			const documentsRefreshRoute = /^\/projects\/(prj_[0-9a-f-]+)\/documents\/refresh$/u.exec(resource);
			if (documentsRefreshRoute !== null) {
				requireMethod(request, "POST");
				const intake = requireIntake(options);
				const projectId = documentsRefreshRoute[1];
				if (projectId === void 0 || !PROJECT_ID.test(projectId)) throw projectControlHttpError("NOT_FOUND", "项目不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				requireEmptyBody(request);
				sendJson(response, 200, {
					ok: true,
					data: normalizeDocumentIndex(await intake.refreshProjectDocuments(projectId))
				});
				return;
			}
			const rebindResolveRoute = /^\/projects\/(prj_[0-9a-f-]+)\/document-rebinds\/(rbd_[0-9a-f-]+)\/resolve$/u.exec(resource);
			if (rebindResolveRoute !== null) {
				requireMethod(request, "POST");
				const intake = requireIntake(options);
				const projectId = rebindResolveRoute[1];
				const proposalId = rebindResolveRoute[2];
				if (projectId === void 0 || !PROJECT_ID.test(projectId) || proposalId === void 0 || !REBIND_PROPOSAL_ID.test(proposalId)) throw projectControlHttpError("NOT_FOUND", "重绑提案不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const input = normalizeRebindResolution(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeRebindResolutionResult(await intake.resolveDocumentRebind(projectId, proposalId, input))
				});
				return;
			}
			if (/^\/projects\/workspace-index$/u.exec(resource) !== null) {
				requireGetWithoutBody(request);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const projects = await service.listProjectWorkspaces();
				const etag = "\"wsidx-" + projects.map((item) => item.projectId + "@" + item.updatedAt).join("|") + "\"";
				if (request.headers["if-none-match"] === etag) {
					response.writeHead(304);
					response.end();
					return;
				}
				response.setHeader("etag", etag);
				sendJson(response, 200, {
					ok: true,
					data: { projects }
				});
				return;
			}
			const workspaceStatusRoute = /^\/projects\/(prj_[0-9a-f-]+)\/workspace\/status$/u.exec(resource);
			if (workspaceStatusRoute !== null) {
				requireGetWithoutBody(request);
				const projectId = workspaceStatusRoute[1];
				if (projectId === void 0 || !PROJECT_ID.test(projectId)) throw projectControlHttpError("NOT_FOUND", "项目不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const workspace = await service.getProjectWorkspace(projectId);
				if (workspace === null) throw projectControlHttpError("PROJECT_WORKSPACE_UNAVAILABLE", "项目没有可用的活动工作区位置。", 404);
				sendJson(response, 200, {
					ok: true,
					data: {
						projectId: workspace.projectId,
						root: workspace.root
					}
				});
				return;
			}
			const workspaceSearchRoute = /^\/projects\/(prj_[0-9a-f-]+)\/workspace\/search$/u.exec(resource);
			if (workspaceSearchRoute !== null) {
				requireGetWithoutBody(request);
				const projectId = workspaceSearchRoute[1];
				if (projectId === void 0 || !PROJECT_ID.test(projectId)) throw projectControlHttpError("NOT_FOUND", "项目不存在。", 404);
				rejectUnexpectedQuery(parsed, new Set(["q"]));
				const query = (parsed.searchParams.get("q") ?? "").trim().toLowerCase();
				if (query === "" || query.length > 200) throw projectControlHttpError("INVALID_QUERY", "搜索词无效。", 400);
				const workspace = await service.getProjectWorkspace(projectId);
				if (workspace === null) throw projectControlHttpError("PROJECT_WORKSPACE_UNAVAILABLE", "项目没有可用的活动工作区位置。", 404);
				const results = await searchProjectWorkspaceFiles(workspace.root, query);
				sendJson(response, 200, {
					ok: true,
					data: {
						results,
						truncated: results.length >= 100
					}
				});
				return;
			}
			const workspaceTreeRoute = /^\/projects\/(prj_[0-9a-f-]+)\/workspace\/tree$/u.exec(resource);
			if (workspaceTreeRoute !== null) {
				requireGetWithoutBody(request);
				const projectId = workspaceTreeRoute[1];
				if (projectId === void 0 || !PROJECT_ID.test(projectId)) throw projectControlHttpError("NOT_FOUND", "项目不存在。", 404);
				rejectUnexpectedQuery(parsed, new Set(["path"]));
				const workspace = await service.getProjectWorkspace(projectId);
				if (workspace === null) throw projectControlHttpError("PROJECT_WORKSPACE_UNAVAILABLE", "项目没有可用的活动工作区位置。", 404);
				sendJson(response, 200, {
					ok: true,
					data: await listProjectWorkspaceTree(workspace.root, parsed.searchParams.get("path") ?? "")
				});
				return;
			}
			const workspaceBlobRoute = /^\/projects\/(prj_[0-9a-f-]+)\/workspace\/blob$/u.exec(resource);
			if (workspaceBlobRoute !== null) {
				requireGetWithoutBody(request);
				const projectId = workspaceBlobRoute[1];
				if (projectId === void 0 || !PROJECT_ID.test(projectId)) throw projectControlHttpError("NOT_FOUND", "项目不存在。", 404);
				rejectUnexpectedQuery(parsed, new Set(["path"]));
				const workspace = await service.getProjectWorkspace(projectId);
				if (workspace === null) throw projectControlHttpError("PROJECT_WORKSPACE_UNAVAILABLE", "项目没有可用的活动工作区位置。", 404);
				await streamProjectWorkspaceBlob(response, workspace.root, parsed.searchParams.get("path") ?? "");
				return;
			}
			const workspaceFileRoute = /^\/projects\/(prj_[0-9a-f-]+)\/workspace\/file$/u.exec(resource);
			if (workspaceFileRoute !== null) {
				requireGetWithoutBody(request);
				const projectId = workspaceFileRoute[1];
				if (projectId === void 0 || !PROJECT_ID.test(projectId)) throw projectControlHttpError("NOT_FOUND", "项目不存在。", 404);
				rejectUnexpectedQuery(parsed, new Set(["path"]));
				const workspace = await service.getProjectWorkspace(projectId);
				if (workspace === null) throw projectControlHttpError("PROJECT_WORKSPACE_UNAVAILABLE", "项目没有可用的活动工作区位置。", 404);
				sendJson(response, 200, {
					ok: true,
					data: await readProjectWorkspaceFile(workspace.root, parsed.searchParams.get("path") ?? "")
				}, {}, 512 * 1024);
				return;
			}
			const documentsRoute = /^\/projects\/(prj_[0-9a-f-]+)\/documents$/u.exec(resource);
			if (documentsRoute !== null) {
				requireGetWithoutBody(request);
				const intake = requireIntake(options);
				const projectId = documentsRoute[1];
				if (projectId === void 0 || !PROJECT_ID.test(projectId)) throw projectControlHttpError("NOT_FOUND", "项目不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				sendJson(response, 200, {
					ok: true,
					data: normalizeDocumentIndex(await intake.getProjectDocuments(projectId))
				});
				return;
			}
			const upgradeRoute = /^\/intake\/projects\/(prj_[0-9a-f-]+)\/prepare-upgrade$/u.exec(resource);
			if (upgradeRoute !== null) {
				requireMethod(request, "POST");
				const intake = requireIntake(options);
				const projectId = upgradeRoute[1];
				if (projectId === void 0 || !PROJECT_ID.test(projectId)) throw projectControlHttpError("NOT_FOUND", "项目不存在。", 404);
				const input = normalizeUpgradePreparation(await readJsonBody(request));
				sendJson(response, 200, {
					ok: true,
					data: normalizeUpgradePreparationResult(await intake.prepareUpgrade(projectId, input))
				});
				return;
			}
			const candidateRoute = /^\/intake\/candidates\/(can_[0-9a-f-]+)(?:\/(ignore|prepare))?$/u.exec(resource);
			if (candidateRoute !== null) {
				const candidateId = candidateRoute[1];
				if (candidateId === void 0 || !IMPORT_CANDIDATE_ID.test(candidateId)) throw projectControlHttpError("NOT_FOUND", "项目候选不存在。", 404);
				rejectUnexpectedQuery(parsed, /* @__PURE__ */ new Set());
				const action = candidateRoute[2];
				const intake = requireIntake(options);
				if (action === void 0) {
					requireGetWithoutBody(request);
					sendJson(response, 200, {
						ok: true,
						data: normalizeCandidate(await intake.getCandidate(candidateId))
					});
					return;
				}
				requireMethod(request, "POST");
				if (action === "ignore") {
					const input = normalizeIgnoreRequest(await readJsonBody(request));
					sendJson(response, 200, {
						ok: true,
						data: normalizeCandidate(await intake.setCandidateIgnored(candidateId, input))
					});
					return;
				}
				const input = normalizeCandidatePreparation(await readJsonBody(request));
				const validation = validateLifecycleCommand(await intake.prepareCandidate(candidateId, input));
				if (!validation.ok) throw new TypeError("intake service returned a lifecycle command outside the canonical contract");
				sendJson(response, 200, {
					ok: true,
					data: { command: validation.value }
				});
				return;
			}
			throw projectControlHttpError("NOT_FOUND", "项目控制台接口不存在。", 404);
		} catch (error) {
			const exposed = exposedError(error);
			sendJson(response, exposed.status, {
				ok: false,
				error: {
					code: exposed.code,
					message: exposed.message
				}
			}, exposed.headers);
		}
	};
}
function requireGetWithoutBody(request) {
	requireMethod(request, "GET");
	const rawLength = request.headers["content-length"];
	if (rawLength !== void 0) {
		const declared = Number(rawLength);
		if (!Number.isSafeInteger(declared) || declared < 0) throw projectControlHttpError("INVALID_CONTENT_LENGTH", "请求长度无效。");
		if (declared > 262144) throw projectControlHttpError("BODY_TOO_LARGE", "项目控制台请求内容过大。", 413);
		if (declared !== 0) throw projectControlHttpError("BODY_NOT_ALLOWED", "读取接口不接受请求正文。");
	}
	if (request.headers["transfer-encoding"] !== void 0) throw projectControlHttpError("BODY_NOT_ALLOWED", "读取接口不接受请求正文。");
}
function requireEmptyBody(request) {
	const rawLength = request.headers["content-length"];
	if (rawLength !== void 0) {
		const declared = Number(rawLength);
		if (!Number.isSafeInteger(declared) || declared < 0) throw projectControlHttpError("INVALID_CONTENT_LENGTH", "请求长度无效。");
		if (declared > 262144) throw projectControlHttpError("BODY_TOO_LARGE", "项目控制台请求内容过大。", 413);
		if (declared !== 0) throw projectControlHttpError("BODY_NOT_ALLOWED", "该接口不接受请求正文。");
	}
	if (request.headers["transfer-encoding"] !== void 0) throw projectControlHttpError("BODY_NOT_ALLOWED", "该接口不接受请求正文。");
}
function requireMethod(request, expected) {
	if ((request.method ?? "GET").toUpperCase() === expected) return;
	throw projectControlHttpError("METHOD_NOT_ALLOWED", expected === "GET" ? "此项目控制台接口只支持读取。" : "此项目控制台接口只接受指令提交。", 405, { allow: expected });
}
function requireConsole(options) {
	if (options.console === void 0) throw projectControlHttpError("CONSOLE_UNAVAILABLE", "项目控制台指令服务暂不可用。", 503);
	return options.console;
}
function requireExternal(options) {
	if (options.external === void 0) throw projectControlHttpError("EXTERNAL_UNAVAILABLE", "外部运行更新服务暂不可用。", 503);
	return options.external;
}
function requireIntake(options) {
	if (options.intake === void 0) throw projectControlHttpError("INTAKE_UNAVAILABLE", "项目扫描与导入服务暂不可用。", 503);
	return options.intake;
}
function normalizeIntakeScanRequest(value) {
	const candidate = requestObject(value, "扫描请求");
	requireExactKeys(candidate, new Set([
		"mode",
		"selection",
		"maxDepth"
	]), "扫描请求");
	if (!["source-root", "project-root"].includes(String(candidate.mode))) throw projectControlHttpError("INVALID_BODY", "扫描模式无效。");
	const mode = candidate.mode;
	const selection = requestObject(candidate.selection, "目录选择结果");
	requireExactKeys(selection, new Set(["path", "authorization"]), "目录选择结果");
	const path = requestText(selection.path, "目录路径", 32767);
	if (!/^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\") || path.startsWith("//") || /[\u0000-\u001f\u007f]/u.test(path)) throw projectControlHttpError("INVALID_BODY", "目录选择结果不是可用的本地绝对路径。");
	const authorization = requestObject(selection.authorization, "目录授权");
	requireExactKeys(authorization, new Set([
		"version",
		"kind",
		"expiresAt",
		"nonce",
		"signature"
	]), "目录授权");
	if (authorization.version !== 1 || authorization.kind !== mode || typeof authorization.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(authorization.expiresAt) || typeof authorization.nonce !== "string" || !UUID.test(authorization.nonce) || typeof authorization.signature !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(authorization.signature)) throw projectControlHttpError("INVALID_BODY", "目录授权无效。");
	let maxDepth;
	if (candidate.maxDepth !== void 0) {
		maxDepth = requestRevision(candidate.maxDepth, "扫描深度", 1);
		if (maxDepth > 3) throw projectControlHttpError("INVALID_BODY", "扫描深度超出允许范围。");
	}
	return {
		mode,
		selection: {
			path,
			authorization: {
				version: 1,
				kind: mode,
				expiresAt: authorization.expiresAt,
				nonce: authorization.nonce,
				signature: authorization.signature
			}
		},
		...maxDepth === void 0 ? {} : { maxDepth }
	};
}
function normalizeIgnoreRequest(value) {
	const candidate = requestObject(value, "候选忽略请求");
	requireExactKeys(candidate, new Set(["ignored", "expectedRevision"]), "候选忽略请求");
	if (typeof candidate.ignored !== "boolean") throw projectControlHttpError("INVALID_BODY", "候选忽略状态无效。");
	return {
		ignored: candidate.ignored,
		expectedRevision: requestRevision(candidate.expectedRevision, "候选修订", 1)
	};
}
function normalizeCandidatePreparation(value) {
	const candidate = requestObject(value, "候选确认请求");
	requireExactKeys(candidate, new Set([
		"registrationMode",
		"name",
		"expectedRevision",
		"documentBindings"
	]), "候选确认请求");
	if (!["linked_legacy", "managed"].includes(String(candidate.registrationMode))) throw projectControlHttpError("INVALID_BODY", "项目关联模式无效。");
	const name = requestText(candidate.name, "项目名称", 120).trim();
	if (/\p{Cc}/u.test(name)) throw projectControlHttpError("INVALID_BODY", "项目名称包含无效字符。");
	if (!Array.isArray(candidate.documentBindings) || candidate.documentBindings.length > 64) throw projectControlHttpError("INVALID_BODY", "文档映射数量无效。");
	const seenRoles = /* @__PURE__ */ new Set();
	const seenPaths = /* @__PURE__ */ new Set();
	const documentBindings = candidate.documentBindings.map((raw, index) => {
		const binding = requestObject(raw, `文档映射 ${String(index + 1)}`);
		requireExactKeys(binding, new Set([
			"role",
			"relativePath",
			"contentHash"
		]), "文档映射");
		if (typeof binding.role !== "string" || !DOCUMENT_ROLES$1.has(binding.role)) throw projectControlHttpError("INVALID_BODY", "文档角色无效。");
		const relativePath = requestText(binding.relativePath, "文档相对路径", 512);
		if (!isCanonicalRelativePath(relativePath)) throw projectControlHttpError("INVALID_BODY", "文档相对路径必须是规范化的项目内 POSIX 路径。");
		if (typeof binding.contentHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(binding.contentHash)) throw projectControlHttpError("INVALID_BODY", "文档内容哈希无效。");
		if (seenRoles.has(binding.role) || seenPaths.has(relativePath.toLowerCase())) throw projectControlHttpError("INVALID_BODY", "文档角色或路径不能重复。");
		seenRoles.add(binding.role);
		seenPaths.add(relativePath.toLowerCase());
		return {
			role: binding.role,
			relativePath,
			contentHash: binding.contentHash
		};
	});
	return {
		registrationMode: candidate.registrationMode,
		name,
		expectedRevision: requestRevision(candidate.expectedRevision, "候选修订", 1),
		documentBindings
	};
}
const DIRECTORY_NAME = /^(?!\.{1,2}$)(?!.*[ .]$)[^<>:"/\\|?*\u0000-\u001F]+$/u;
const TEMPLATE_ID$1 = /^[a-z][a-z0-9.-]{1,127}$/u;
const TEMPLATE_VERSION$1 = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
function normalizeCreatePreparation(value) {
	const candidate = requestObject(value, "新建项目请求");
	requireExactKeys(candidate, new Set([
		"selection",
		"directoryName",
		"name",
		"templateId",
		"templateVersion"
	]), "新建项目请求");
	const selection = requestObject(candidate.selection, "目录选择结果");
	requireExactKeys(selection, new Set(["path", "authorization"]), "目录选择结果");
	const path = requestText(selection.path, "目录路径", 32767);
	if (!/^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\") || path.startsWith("//") || /[\u0000-\u001f\u007f]/u.test(path)) throw projectControlHttpError("INVALID_BODY", "目录选择结果不是可用的本地绝对路径。");
	const authorization = requestObject(selection.authorization, "目录授权");
	requireExactKeys(authorization, new Set([
		"version",
		"kind",
		"expiresAt",
		"nonce",
		"signature"
	]), "目录授权");
	if (authorization.version !== 1 || authorization.kind !== "create-parent" || typeof authorization.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(authorization.expiresAt) || typeof authorization.nonce !== "string" || !UUID.test(authorization.nonce) || typeof authorization.signature !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(authorization.signature)) throw projectControlHttpError("INVALID_BODY", "目录授权无效。");
	const directoryName = requestText(candidate.directoryName, "目录名", 120);
	if (!DIRECTORY_NAME.test(directoryName)) throw projectControlHttpError("INVALID_BODY", "目录名包含不允许的字符。");
	const name = requestText(candidate.name, "项目名称", 120).trim();
	if (/\p{Cc}/u.test(name)) throw projectControlHttpError("INVALID_BODY", "项目名称包含无效字符。");
	const templateId = requestText(candidate.templateId, "模板标识", 128);
	const templateVersion = requestText(candidate.templateVersion, "模板版本", 64);
	if (!TEMPLATE_ID$1.test(templateId) || !TEMPLATE_VERSION$1.test(templateVersion)) throw projectControlHttpError("INVALID_BODY", "模板身份或版本无效。");
	return {
		selection: {
			path,
			authorization: {
				version: 1,
				kind: "create-parent",
				expiresAt: authorization.expiresAt,
				nonce: authorization.nonce,
				signature: authorization.signature
			}
		},
		directoryName,
		name,
		templateId,
		templateVersion
	};
}
function normalizeTemplateList(value) {
	if (!Array.isArray(value) || value.length > 50) throw new TypeError("intake service returned an invalid template list");
	return value.map((raw, index) => {
		const candidate = responseObject(raw, `template ${String(index)}`);
		return {
			templateId: boundedText(candidate.templateId, "templateId", 128),
			templateVersion: boundedText(candidate.templateVersion, "templateVersion", 64),
			displayName: boundedText(candidate.displayName, "displayName", 120),
			description: candidate.description === null ? null : boundedText(candidate.description, "description", 2e3),
			protocolVersion: boundedText(candidate.protocolVersion, "protocolVersion", 80),
			templateHash: boundedText(candidate.templateHash, "templateHash", 80)
		};
	});
}
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/u;
const WORK_ITEM_ID = /^wrk_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROGRESS_UPDATE_ID = /^upd_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REVIEW_ID = /^rev_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DECISION_ID = /^dec_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const QUARANTINE_ID = /^qtn_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REVIEW_ACTION_ID = /^rva_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EVENT_ID = /^evt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function normalizeHandshakeRequest(value) {
	const candidate = requestObject(value, "能力握手请求");
	requireExactKeys(candidate, new Set([
		"instanceId",
		"appVersion",
		"protocolVersions",
		"capabilities"
	]), "能力握手请求");
	const instanceId = requestText(candidate.instanceId, "实例标识", 127);
	if (!INSTANCE_ID_PATTERN.test(instanceId)) throw projectControlHttpError("INVALID_BODY", "实例标识无效。");
	const protocolVersions = requestTextList(candidate.protocolVersions, "协议版本", 50, 127);
	if (protocolVersions.length < 1) throw projectControlHttpError("INVALID_BODY", "协议版本至少需要一项。");
	return {
		instanceId,
		appVersion: requestText(candidate.appVersion, "应用版本", 64),
		protocolVersions,
		capabilities: requestTextList(candidate.capabilities, "能力列表", 100, 127)
	};
}
function normalizeHandshakeResult(value) {
	const candidate = responseObject(value, "handshake result");
	const protocolVersions = candidate.protocolVersions;
	const capabilities = candidate.capabilities;
	if (!Array.isArray(protocolVersions) || protocolVersions.length > 50 || protocolVersions.some((item) => typeof item !== "string" || item.length < 1 || item.length > 127) || !Array.isArray(capabilities) || capabilities.length > 100 || capabilities.some((item) => typeof item !== "string" || item.length < 1 || item.length > 127)) throw new TypeError("external service returned an invalid handshake result");
	return {
		instanceId: boundedText(candidate.instanceId, "instanceId", 127),
		appVersion: boundedText(candidate.appVersion, "appVersion", 64),
		protocolVersions,
		capabilities,
		heartbeatAt: responseTimestamp(candidate.heartbeatAt, "heartbeatAt"),
		startedAt: responseTimestamp(candidate.startedAt, "startedAt"),
		revision: requiredRevision(candidate.revision, "revision", 1),
		createdAt: responseTimestamp(candidate.createdAt, "createdAt"),
		updatedAt: responseTimestamp(candidate.updatedAt, "updatedAt")
	};
}
function normalizeExternalResult(value) {
	const candidate = responseObject(value, "external update result");
	const status = boundedText(candidate.status, "status", 40);
	if (![
		"accepted",
		"replayed",
		"rejected"
	].includes(status)) throw new TypeError("external service returned an invalid update result");
	const base = {
		protocolVersion: boundedText(candidate.protocolVersion, "protocolVersion", 80),
		schemaVersion: boundedText(candidate.schemaVersion, "schemaVersion", 80),
		commandId: boundedText(candidate.commandId, "commandId", 200),
		correlationId: boundedNullableText(candidate.correlationId, "correlationId", 200),
		kind: boundedText(candidate.kind, "kind", 100),
		status,
		recordedAt: responseTimestamp(candidate.recordedAt, "recordedAt")
	};
	if (status === "rejected") {
		const error = responseObject(candidate.error, "error");
		return {
			...base,
			...candidate.currentRevision === void 0 ? {} : { currentRevision: requiredRevision(candidate.currentRevision, "currentRevision", 0) },
			error: {
				code: boundedText(error.code, "error.code", 100),
				message: boundedText(error.message, "error.message", 500)
			}
		};
	}
	return {
		...base,
		aggregateType: boundedText(candidate.aggregateType, "aggregateType", 40),
		aggregateId: boundedText(candidate.aggregateId, "aggregateId", 100),
		aggregateRevision: requiredRevision(candidate.aggregateRevision, "aggregateRevision", 1),
		eventId: responseId(candidate.eventId, EVENT_ID, "eventId")
	};
}
function normalizeWorkItem(value) {
	const item = responseObject(value, "work item");
	const executionStatus = boundedText(item.executionStatus, "executionStatus", 40);
	const reviewStatus = boundedText(item.reviewStatus, "reviewStatus", 40);
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
	].includes(reviewStatus)) throw new TypeError("external service returned an invalid work item status");
	const acceptance = item.acceptance;
	if (!Array.isArray(acceptance) || acceptance.length > 50 || acceptance.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 1e3)) throw new TypeError("external service returned invalid work item acceptance");
	const priority = requiredRevision(item.priority, "priority", 0);
	if (priority > 100) throw new TypeError("external service returned an invalid work item priority");
	return {
		workItemId: responseId(item.workItemId, WORK_ITEM_ID, "workItemId"),
		projectId: responseId(item.projectId, PROJECT_ID, "projectId"),
		title: boundedText(item.title, "title", 500),
		instruction: boundedNullableText(item.instruction, "instruction", 2e4),
		acceptance,
		executionStatus,
		reviewStatus,
		priority,
		revision: requiredRevision(item.revision, "revision", 1),
		createdAt: responseTimestamp(item.createdAt, "createdAt"),
		updatedAt: responseTimestamp(item.updatedAt, "updatedAt"),
		archivedAt: item.archivedAt === null || item.archivedAt === void 0 ? null : responseTimestamp(item.archivedAt, "archivedAt")
	};
}
function normalizeWorkItemList(value) {
	if (!Array.isArray(value) || value.length > 500) throw new TypeError("external service returned an invalid work item list");
	return value.map((raw) => normalizeWorkItem(raw));
}
function normalizeRun(value) {
	const run = responseObject(value, "run");
	const status = boundedText(run.status, "status", 40);
	if (![
		"queued",
		"running",
		"completed",
		"blocked",
		"failed",
		"cancelled"
	].includes(status)) throw new TypeError("external service returned an invalid run status");
	return {
		runId: responseId(run.runId, RUN_ID, "runId"),
		projectId: responseId(run.projectId, PROJECT_ID, "projectId"),
		workItemId: responseId(run.workItemId, WORK_ITEM_ID, "workItemId"),
		attemptNo: requiredRevision(run.attemptNo, "attemptNo", 1),
		status,
		instructionSnapshot: boundedNullableText(run.instructionSnapshot, "instructionSnapshot", 2e4),
		acceptanceSnapshot: run.acceptanceSnapshot,
		revision: requiredRevision(run.revision, "revision", 1),
		createdAt: responseTimestamp(run.createdAt, "createdAt"),
		startedAt: run.startedAt === null || run.startedAt === void 0 ? null : responseTimestamp(run.startedAt, "startedAt"),
		completedAt: run.completedAt === null || run.completedAt === void 0 ? null : responseTimestamp(run.completedAt, "completedAt"),
		updatedAt: responseTimestamp(run.updatedAt, "updatedAt")
	};
}
function normalizeRunList(value) {
	if (!Array.isArray(value) || value.length > 500) throw new TypeError("external service returned an invalid run list");
	return value.map((raw) => normalizeRun(raw));
}
function normalizeProgressList(value) {
	if (!Array.isArray(value) || value.length > 500) throw new TypeError("external service returned an invalid progress update list");
	return value.map((raw, index) => {
		const update = responseObject(raw, `progress update ${String(index)}`);
		const kind = boundedText(update.kind, "kind", 40);
		const aggregateType = boundedText(update.aggregateType, "aggregateType", 40);
		if (![
			"progress",
			"blocker",
			"completion_declared"
		].includes(kind) || !["work_item", "run"].includes(aggregateType)) throw new TypeError("external service returned an invalid progress update");
		return {
			progressUpdateId: responseId(update.progressUpdateId, PROGRESS_UPDATE_ID, "progressUpdateId"),
			projectId: responseId(update.projectId, PROJECT_ID, "projectId"),
			workItemId: responseId(update.workItemId, WORK_ITEM_ID, "workItemId"),
			runId: responseId(update.runId, RUN_ID, "runId"),
			kind,
			summary: boundedText(update.summary, "summary", 500),
			needs: update.needs,
			acceptanceClaims: update.acceptanceClaims,
			evidence: update.evidence,
			completionPercent: update.completionPercent === null || update.completionPercent === void 0 ? null : requiredRevision(update.completionPercent, "completionPercent", 0),
			details: boundedNullableText(update.details, "details", 2e4),
			threadId: boundedText(update.threadId, "threadId", 127),
			sourceEventId: update.sourceEventId === null || update.sourceEventId === void 0 ? null : responseId(update.sourceEventId, EVENT_ID, "sourceEventId"),
			commandId: boundedText(update.commandId, "commandId", 200),
			aggregateType,
			aggregateId: boundedText(update.aggregateId, "aggregateId", 100),
			aggregateRevision: requiredRevision(update.aggregateRevision, "aggregateRevision", 1),
			generatedBy: update.generatedBy,
			createdAt: responseTimestamp(update.createdAt, "createdAt")
		};
	});
}
function normalizeReview(value) {
	const review = responseObject(value, "review");
	const status = boundedText(review.status, "status", 40);
	if (![
		"requested",
		"in_review",
		"approved",
		"rejected",
		"superseded"
	].includes(status)) throw new TypeError("external service returned an invalid review status");
	return {
		reviewId: responseId(review.reviewId, REVIEW_ID, "reviewId"),
		projectId: responseId(review.projectId, PROJECT_ID, "projectId"),
		workItemId: review.workItemId === null || review.workItemId === void 0 ? null : responseId(review.workItemId, WORK_ITEM_ID, "workItemId"),
		reviewedWorkItemRevision: review.reviewedWorkItemRevision === null || review.reviewedWorkItemRevision === void 0 ? null : requiredRevision(review.reviewedWorkItemRevision, "reviewedWorkItemRevision", 1),
		artifactRefs: review.artifactRefs,
		status,
		risk: boundedNullableText(review.risk, "risk", 100),
		requestedBy: review.requestedBy,
		decidedBy: review.decidedBy === null || review.decidedBy === void 0 ? null : review.decidedBy,
		revision: requiredRevision(review.revision, "revision", 1),
		createdAt: responseTimestamp(review.createdAt, "createdAt"),
		updatedAt: responseTimestamp(review.updatedAt, "updatedAt"),
		decidedAt: review.decidedAt === null || review.decidedAt === void 0 ? null : responseTimestamp(review.decidedAt, "decidedAt")
	};
}
function normalizeReviewList(value) {
	if (!Array.isArray(value) || value.length > 500) throw new TypeError("external service returned an invalid review list");
	return value.map((raw) => normalizeReview(raw));
}
function normalizeDecisionList(value) {
	if (!Array.isArray(value) || value.length > 500) throw new TypeError("external service returned an invalid decision list");
	return value.map((raw, index) => {
		const decision = responseObject(raw, `decision ${String(index)}`);
		const status = boundedText(decision.status, "status", 40);
		if (![
			"open",
			"decided",
			"voided"
		].includes(status)) throw new TypeError("external service returned an invalid decision status");
		return {
			decisionId: responseId(decision.decisionId, DECISION_ID, "decisionId"),
			projectId: responseId(decision.projectId, PROJECT_ID, "projectId"),
			workItemId: responseId(decision.workItemId, WORK_ITEM_ID, "workItemId"),
			title: boundedText(decision.title, "title", 500),
			context: boundedNullableText(decision.context, "context", 2e4),
			options: decision.options,
			status,
			rationale: boundedNullableText(decision.rationale, "rationale", 2e4),
			proposedBy: decision.proposedBy,
			decidedBy: decision.decidedBy === null || decision.decidedBy === void 0 ? null : decision.decidedBy,
			revision: requiredRevision(decision.revision, "revision", 1),
			createdAt: responseTimestamp(decision.createdAt, "createdAt"),
			updatedAt: responseTimestamp(decision.updatedAt, "updatedAt"),
			decidedAt: decision.decidedAt === null || decision.decidedAt === void 0 ? null : responseTimestamp(decision.decidedAt, "decidedAt")
		};
	});
}
function normalizeQuarantineItem(value) {
	const item = responseObject(value, "quarantine item");
	const status = boundedText(item.status, "status", 40);
	if (![
		"open",
		"resolved",
		"ignored"
	].includes(status)) throw new TypeError("external service returned an invalid quarantine status");
	return {
		quarantineId: responseId(item.quarantineId, QUARANTINE_ID, "quarantineId"),
		projectId: item.projectId === null || item.projectId === void 0 ? null : responseId(item.projectId, PROJECT_ID, "projectId"),
		sourceKind: boundedText(item.sourceKind, "sourceKind", 100),
		sourceRef: boundedText(item.sourceRef, "sourceRef", 512),
		reasonCode: boundedText(item.reasonCode, "reasonCode", 100),
		payloadRef: boundedNullableText(item.payloadRef, "payloadRef", 512),
		status,
		details: item.details,
		revision: requiredRevision(item.revision, "revision", 1),
		createdAt: responseTimestamp(item.createdAt, "createdAt"),
		updatedAt: responseTimestamp(item.updatedAt, "updatedAt"),
		resolvedAt: item.resolvedAt === null || item.resolvedAt === void 0 ? null : responseTimestamp(item.resolvedAt, "resolvedAt")
	};
}
function normalizeQuarantineResolveRequest(value) {
	const candidate = requestObject(value, "隔离处置请求");
	requireExactKeys(candidate, new Set(["expectedRevision", "decision"]), "隔离处置请求");
	const decision = candidate.decision;
	if (decision !== "resolved" && decision !== "ignored") throw projectControlHttpError("INVALID_BODY", "隔离处置决定无效。");
	return {
		expectedRevision: requestRevision(candidate.expectedRevision, "隔离修订", 1),
		decision
	};
}
function normalizeQuarantineList(value) {
	if (!Array.isArray(value) || value.length > 500) throw new TypeError("external service returned an invalid quarantine list");
	return value.map((raw) => normalizeQuarantineItem(raw));
}
function normalizeEventList(value) {
	if (!Array.isArray(value) || value.length > 500) throw new TypeError("external service returned an invalid event list");
	return value.map((raw, index) => {
		const event = responseObject(raw, `event ${String(index)}`);
		const aggregateType = boundedText(event.aggregateType, "aggregateType", 40);
		if (![
			"project",
			"work_item",
			"run"
		].includes(aggregateType)) throw new TypeError("external service returned an invalid event aggregate");
		return {
			eventId: responseId(event.eventId, EVENT_ID, "eventId"),
			sequence: requiredRevision(event.sequence, "sequence", 1),
			projectId: responseId(event.projectId, PROJECT_ID, "projectId"),
			aggregateType,
			aggregateId: boundedText(event.aggregateId, "aggregateId", 100),
			beforeRevision: requiredRevision(event.beforeRevision, "beforeRevision", 0),
			afterRevision: requiredRevision(event.afterRevision, "afterRevision", 1),
			eventType: boundedText(event.eventType, "eventType", 100),
			schemaVersion: boundedText(event.schemaVersion, "schemaVersion", 80),
			data: event.data,
			actor: event.actor,
			provenance: event.provenance,
			commandId: boundedText(event.commandId, "commandId", 200),
			correlationId: boundedNullableText(event.correlationId, "correlationId", 200),
			causationId: boundedNullableText(event.causationId, "causationId", 200),
			occurredAt: responseTimestamp(event.occurredAt, "occurredAt"),
			recordedAt: responseTimestamp(event.recordedAt, "recordedAt")
		};
	});
}
function normalizeCreateWorkItemRequest(value) {
	const candidate = requestObject(value, "新建任务请求");
	rejectUnknownKeys(candidate, new Set([
		"title",
		"instruction",
		"acceptance",
		"executionStatus",
		"reviewStatus",
		"priority"
	]), "新建任务请求");
	const title = requestText(candidate.title, "任务标题", 500);
	const instruction = candidate.instruction === void 0 || candidate.instruction === null ? void 0 : requestText(candidate.instruction, "任务说明", 2e4);
	const acceptance = candidate.acceptance === void 0 ? void 0 : requestTextList(candidate.acceptance, "验收标准", 50, 1e3);
	const executionStatus = candidate.executionStatus === void 0 ? void 0 : requestText(candidate.executionStatus, "执行状态", 40);
	if (executionStatus !== void 0 && ![
		"draft",
		"ready",
		"running",
		"paused",
		"blocked",
		"completed",
		"cancelled"
	].includes(executionStatus)) throw projectControlHttpError("INVALID_BODY", "执行状态无效。");
	const reviewStatus = candidate.reviewStatus === void 0 ? void 0 : requestText(candidate.reviewStatus, "审核状态", 40);
	if (reviewStatus !== void 0 && ![
		"not_requested",
		"pending",
		"changes_requested",
		"approved",
		"rejected"
	].includes(reviewStatus)) throw projectControlHttpError("INVALID_BODY", "审核状态无效。");
	const priority = candidate.priority === void 0 ? void 0 : requestRevision(candidate.priority, "优先级", 0);
	if (priority !== void 0 && priority > 100) throw projectControlHttpError("INVALID_BODY", "优先级无效。");
	return {
		title,
		...instruction === void 0 ? {} : { instruction },
		...acceptance === void 0 ? {} : { acceptance },
		...executionStatus === void 0 ? {} : { executionStatus },
		...reviewStatus === void 0 ? {} : { reviewStatus },
		...priority === void 0 ? {} : { priority }
	};
}
function normalizeWorkItemStatusRequest(value) {
	const candidate = requestObject(value, "任务状态请求");
	requireExactKeys(candidate, new Set(["expectedRevision", "status"]), "任务状态请求");
	const status = requestText(candidate.status, "目标状态", 40);
	if (![
		"draft",
		"ready",
		"running",
		"paused",
		"blocked",
		"completed",
		"cancelled"
	].includes(status)) throw projectControlHttpError("INVALID_BODY", "目标状态无效。");
	return {
		expectedRevision: requestRevision(candidate.expectedRevision, "任务修订", 1),
		status
	};
}
function normalizeReviewRequestRequest(value) {
	const candidate = requestObject(value, "审阅请求");
	rejectUnknownKeys(candidate, new Set(["expectedRevision", "risk"]), "审阅请求");
	const risk = candidate.risk === void 0 || candidate.risk === null ? void 0 : requestText(candidate.risk, "风险等级", 40);
	if (risk !== void 0 && ![
		"unrated",
		"low",
		"medium",
		"high"
	].includes(risk)) throw projectControlHttpError("INVALID_BODY", "风险等级无效。");
	return {
		expectedRevision: requestRevision(candidate.expectedRevision, "任务修订", 1),
		...risk === void 0 ? {} : { risk }
	};
}
function normalizeReviewDecisionRequest(value) {
	const candidate = requestObject(value, "审阅决定请求");
	rejectUnknownKeys(candidate, new Set([
		"expectedRevision",
		"decision",
		"rationale"
	]), "审阅决定请求");
	const decision = candidate.decision;
	if (decision !== "approve" && decision !== "reject" && decision !== "request_changes") throw projectControlHttpError("INVALID_BODY", "审阅决定无效。");
	const rationale = candidate.rationale === void 0 || candidate.rationale === null || candidate.rationale === "" ? void 0 : requestText(candidate.rationale, "审阅意见", 4e3);
	return {
		expectedRevision: requestRevision(candidate.expectedRevision, "审阅修订", 1),
		decision,
		...rationale === void 0 ? {} : { rationale }
	};
}
function normalizeReviewCommentRequest(value) {
	const candidate = requestObject(value, "审阅评论请求");
	requireExactKeys(candidate, new Set(["comment"]), "审阅评论请求");
	return { comment: requestText(candidate.comment, "评论内容", 4e3) };
}
function normalizeRunStartRequest(value) {
	const candidate = requestObject(value, "启动运行请求");
	requireExactKeys(candidate, new Set(["expectedRevision"]), "启动运行请求");
	return { expectedRevision: requestRevision(candidate.expectedRevision, "运行修订", 1) };
}
function normalizeReviewAction(value) {
	const action = responseObject(value, "review action");
	const kind = boundedText(action.action, "action", 40);
	if (![
		"comment",
		"request_changes",
		"approve",
		"reject",
		"supersede"
	].includes(kind)) throw new TypeError("external service returned an invalid review action");
	return {
		reviewActionId: responseId(action.reviewActionId, REVIEW_ACTION_ID, "reviewActionId"),
		reviewId: responseId(action.reviewId, REVIEW_ID, "reviewId"),
		action: kind,
		actor: action.actor,
		comment: boundedNullableText(action.comment, "comment", 4e3),
		createdAt: responseTimestamp(action.createdAt, "createdAt")
	};
}
const THREAD_BINDING_ID = /^atb_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function normalizeSessionList(value) {
	if (!Array.isArray(value) || value.length > 500) throw new TypeError("external service returned an invalid session binding list");
	return value.map((raw) => {
		const binding = responseObject(raw, "session binding");
		return {
			bindingId: responseId(binding.bindingId, THREAD_BINDING_ID, "bindingId"),
			projectId: responseId(binding.projectId, PROJECT_ID, "projectId"),
			runId: responseId(binding.runId, RUN_ID, "runId"),
			harnessInstanceRef: boundedText(binding.harnessInstanceRef, "harnessInstanceRef", 127),
			sessionId: boundedText(binding.sessionId, "sessionId", 200),
			threadId: boundedText(binding.threadId, "threadId", 127),
			createdAt: responseTimestamp(binding.createdAt, "createdAt")
		};
	});
}
function normalizeReviewActionList(value) {
	if (!Array.isArray(value) || value.length > 500) throw new TypeError("external service returned an invalid review action list");
	return value.map((raw) => normalizeReviewAction(raw));
}
function requestTextList(value, field, maxLength, maxItemLength) {
	if (!Array.isArray(value) || value.length > maxLength || value.some((item) => typeof item !== "string" || item.length < 1 || item.length > maxItemLength)) throw projectControlHttpError("INVALID_BODY", `${field}无效。`);
	return value;
}
function normalizeCreatePreparationResult(value) {
	const candidate = responseObject(value, "create preparation");
	const template = responseObject(candidate.template, "template");
	const writePlan = responseObject(candidate.writePlan, "writePlan");
	const command = responseObject(candidate.command, "command");
	return {
		template: {
			templateId: boundedText(template.templateId, "templateId", 128),
			templateVersion: boundedText(template.templateVersion, "templateVersion", 64),
			displayName: boundedText(template.displayName, "displayName", 120),
			templateHash: boundedText(template.templateHash, "templateHash", 80)
		},
		projectId: boundedText(candidate.projectId, "projectId", 80),
		targetDisplayPath: boundedText(candidate.targetDisplayPath, "targetDisplayPath", 2048),
		directoryName: boundedText(candidate.directoryName, "directoryName", 120),
		expiresAt: boundedText(candidate.expiresAt, "expiresAt", 80),
		writePlan: {
			planId: boundedText(writePlan.planId, "planId", 80),
			planHash: boundedText(writePlan.planHash, "planHash", 80),
			manifestHash: boundedText(writePlan.manifestHash, "manifestHash", 80),
			syncPolicy: boundedText(writePlan.syncPolicy, "syncPolicy", 40),
			operations: writePlan.operations
		},
		command
	};
}
function normalizeDocumentIndex(value) {
	const candidate = responseObject(value, "document index");
	const documents = candidate.documents;
	const proposals = candidate.proposals;
	if (!Array.isArray(documents) || documents.length > 200 || !Array.isArray(proposals) || proposals.length > 50) throw new TypeError("intake service returned an invalid document index");
	return {
		projectId: responseId(candidate.projectId, PROJECT_ID, "projectId"),
		mode: boundedText(candidate.mode, "project mode", 40),
		name: boundedText(candidate.name, "project name", 240),
		revision: requiredRevision(candidate.revision, "project revision", 1),
		locationDisplayPath: boundedNullableText(candidate.locationDisplayPath, "locationDisplayPath", 32767),
		documents: documents.map((raw) => {
			const document = responseObject(raw, "document state");
			const state = boundedText(document.state, "document state", 40);
			const bindingSource = boundedText(document.bindingSource, "binding source", 40);
			if (![
				"ok",
				"changed",
				"missing",
				"unreadable"
			].includes(state) || !["user_confirmed", "manifest"].includes(bindingSource)) throw new TypeError("intake service returned an invalid document state");
			const parseIssues = document.parseIssues;
			if (!Array.isArray(parseIssues) || parseIssues.length > 20) throw new TypeError("intake service returned invalid parse issues");
			return {
				role: boundedText(document.role, "document role", 40),
				relativePath: responseRelativePath(document.relativePath, "relativePath"),
				bindingSource,
				state,
				contentHash: boundedNullableText(document.contentHash, "contentHash", 80),
				byteSize: document.byteSize === null || document.byteSize === void 0 ? null : requiredRevision(document.byteSize, "byteSize", 0),
				parseIssues: parseIssues.map((rawIssue) => {
					const issue = responseObject(rawIssue, "parse issue");
					const severity = boundedText(issue.severity, "parse issue severity", 20);
					if (![
						"info",
						"warning",
						"error",
						"blocking"
					].includes(severity)) throw new TypeError("intake service returned an invalid parse issue severity");
					return {
						code: boundedText(issue.code, "parse issue code", 100),
						severity,
						message: boundedText(issue.message, "parse issue message", 1e3),
						line: issue.line === null || issue.line === void 0 ? null : requiredRevision(issue.line, "parse issue line", 1)
					};
				}),
				revision: requiredRevision(document.revision, "document revision", 1),
				firstSeenAt: responseTimestamp(document.firstSeenAt, "firstSeenAt"),
				lastVerifiedAt: responseTimestamp(document.lastVerifiedAt, "lastVerifiedAt")
			};
		}),
		proposals: proposals.map(normalizeRebindProposal)
	};
}
function normalizeRebindProposal(value) {
	const proposal = responseObject(value, "rebind proposal");
	const status = boundedText(proposal.status, "proposal status", 40);
	if (![
		"proposed",
		"accepted",
		"rejected",
		"superseded"
	].includes(status)) throw new TypeError("intake service returned an invalid rebind proposal status");
	const candidates = proposal.candidateRelativePaths;
	if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 50) throw new TypeError("intake service returned invalid rebind candidates");
	return {
		proposalId: responseId(proposal.proposalId, REBIND_PROPOSAL_ID, "proposalId"),
		role: boundedText(proposal.role, "proposal role", 40),
		missingRelativePath: responseRelativePath(proposal.missingRelativePath, "missingRelativePath"),
		contentHash: boundedText(proposal.contentHash, "contentHash", 80),
		candidateRelativePaths: candidates.map((item) => responseRelativePath(item, "candidateRelativePath")),
		candidateCount: requiredRevision(proposal.candidateCount, "candidateCount", 1),
		unambiguous: proposal.unambiguous === true,
		status,
		resolvedRelativePath: boundedNullableText(proposal.resolvedRelativePath, "resolvedRelativePath", 2048),
		revision: requiredRevision(proposal.revision, "proposal revision", 1),
		createdAt: responseTimestamp(proposal.createdAt, "createdAt"),
		updatedAt: responseTimestamp(proposal.updatedAt, "updatedAt"),
		resolvedAt: boundedNullableText(proposal.resolvedAt, "resolvedAt", 80),
		applicable: proposal.applicable === true
	};
}
function normalizeRebindResolution(value) {
	const candidate = requestObject(value, "重绑处理请求");
	for (const key of Object.keys(candidate)) if (![
		"expectedRevision",
		"decision",
		"candidateRelativePath"
	].includes(key)) throw projectControlHttpError("INVALID_BODY", "重绑处理请求包含未知字段。");
	if (candidate.decision !== "accept" && candidate.decision !== "reject") throw projectControlHttpError("INVALID_BODY", "重绑处理决定无效。");
	const input = {
		expectedRevision: requestRevision(candidate.expectedRevision, "提案修订", 1),
		decision: candidate.decision
	};
	if (candidate.candidateRelativePath !== void 0) {
		const relativePath = requestText(candidate.candidateRelativePath, "重绑目标路径", 512);
		if (!isCanonicalRelativePath(relativePath)) throw projectControlHttpError("INVALID_BODY", "重绑目标路径无效。");
		input.candidateRelativePath = relativePath;
	}
	return input;
}
function normalizeRebindResolutionResult(value) {
	const candidate = responseObject(value, "rebind resolution");
	return {
		proposal: candidate.proposal === void 0 || candidate.proposal === null ? null : normalizeRebindProposal(candidate.proposal),
		projectRevision: requiredRevision(candidate.projectRevision, "projectRevision", 1)
	};
}
function normalizeUpgradePreparation(value) {
	const candidate = requestObject(value, "升级预检请求");
	requireExactKeys(candidate, new Set(["expectedRevision"]), "升级预检请求");
	return { expectedRevision: requestRevision(candidate.expectedRevision, "项目修订", 1) };
}
function normalizeUpgradePreparationResult(value) {
	const candidate = responseObject(value, "upgrade preparation");
	const writePlan = responseObject(candidate.writePlan, "writePlan");
	const command = responseObject(candidate.command, "command");
	return {
		projectId: boundedText(candidate.projectId, "projectId", 80),
		name: boundedText(candidate.name, "name", 120),
		targetDisplayPath: boundedText(candidate.targetDisplayPath, "targetDisplayPath", 2048),
		documentCount: boundedText(String(candidate.documentCount), "documentCount", 40),
		fingerprintHash: boundedText(candidate.fingerprintHash, "fingerprintHash", 80),
		expiresAt: boundedText(candidate.expiresAt, "expiresAt", 80),
		writePlan: {
			planId: boundedText(writePlan.planId, "planId", 80),
			planHash: boundedText(writePlan.planHash, "planHash", 80),
			manifestHash: boundedText(writePlan.manifestHash, "manifestHash", 80),
			syncPolicy: boundedText(writePlan.syncPolicy, "syncPolicy", 40),
			operations: writePlan.operations
		},
		command
	};
}
function normalizeImportScan(value) {
	const candidate = responseObject(value, "scan");
	const job = normalizeImportJob(candidate.job);
	return {
		sourceRoot: normalizeSourceRoot(candidate.sourceRoot),
		job,
		candidates: normalizeCandidateList(candidate.candidates),
		summary: job.summary,
		issues: job.issues
	};
}
function normalizeSourceRoots(value) {
	if (!Array.isArray(value) || value.length > 200) throw new TypeError("intake service returned an invalid source root list");
	return value.map(normalizeSourceRoot);
}
function normalizeSourceRoot(value) {
	const candidate = responseObject(value, "source root");
	const kind = boundedText(candidate.kind, "source root kind", 40);
	if (![
		"source_root",
		"single_project",
		"source-root",
		"project-root"
	].includes(kind)) throw new TypeError("intake service returned an invalid source root kind");
	return {
		sourceRootId: responseId(candidate.sourceRootId, SOURCE_ROOT_ID, "sourceRootId"),
		kind: kind === "source_root" || kind === "source-root" ? "source-root" : "project-root",
		path: boundedText(candidate.path ?? candidate.displayPath, "source root path", 32767),
		revision: requiredRevision(candidate.revision, "source root revision", 1),
		updatedAt: responseTimestamp(candidate.updatedAt, "source root updatedAt")
	};
}
function normalizeImportJob(value) {
	const candidate = responseObject(value, "import job");
	const mode = boundedText(candidate.mode, "import job mode", 40);
	const status = boundedText(candidate.status, "import job status", 40);
	if (![
		"source_root",
		"single_project",
		"source-root",
		"project-root"
	].includes(mode) || ![
		"completed",
		"failed",
		"cancelled"
	].includes(status)) throw new TypeError("intake service returned an invalid import job state");
	return {
		jobId: responseId(candidate.jobId ?? candidate.importJobId, IMPORT_JOB_ID, "jobId"),
		sourceRootId: responseId(candidate.sourceRootId, SOURCE_ROOT_ID, "sourceRootId"),
		mode: mode === "source_root" || mode === "source-root" ? "source-root" : "project-root",
		status,
		scannerVersion: boundedText(candidate.scannerVersion, "scannerVersion", 80),
		startedAt: responseTimestamp(candidate.startedAt, "startedAt"),
		completedAt: responseTimestamp(candidate.completedAt, "completedAt"),
		summary: safeJsonObject(candidate.summary, "import job summary"),
		issues: normalizeImportJobIssues(candidate.issues ?? [])
	};
}
function normalizeImportJobIssues(value) {
	if (!Array.isArray(value) || value.length > 500) throw new TypeError("intake service returned an invalid import job issue list");
	return value.map((raw) => {
		const candidate = responseObject(raw, "import job issue");
		const severity = boundedText(candidate.severity, "job issue severity", 20);
		const status = boundedText(candidate.status, "job issue status", 20);
		if (![
			"info",
			"warning",
			"error",
			"blocking"
		].includes(severity) || !["open", "resolved"].includes(status)) throw new TypeError("intake service returned an invalid import job issue state");
		const details = safeJsonObject(candidate.details ?? {}, "job issue details");
		return {
			issueId: responseId(candidate.issueId ?? candidate.importJobIssueId, IMPORT_JOB_ISSUE_ID, "jobIssueId"),
			code: boundedText(candidate.code, "job issue code", 100),
			severity,
			status,
			message: boundedText(candidate.message ?? details.message ?? candidate.code, "job issue message", 500)
		};
	});
}
function normalizeCandidateList(value) {
	if (!Array.isArray(value) || value.length > 500) throw new TypeError("intake service returned an invalid candidate list");
	return value.map((candidate) => normalizeCandidate(candidate, false));
}
function normalizeCandidate(value, includeDetails = true) {
	const candidate = responseObject(value, "candidate");
	const root = candidate.root === void 0 ? void 0 : responseObject(candidate.root, "candidate root");
	const confidence = candidate.confidence === void 0 ? {} : responseObject(candidate.confidence, "candidate confidence");
	const detectedMode = boundedText(candidate.detectedMode, "detectedMode", 40);
	const status = boundedText(candidate.status, "candidate status", 40);
	const evidenceLevel = String(candidate.evidenceLevel ?? confidence.level ?? "low");
	if (![
		"unknown",
		"linked_legacy",
		"managed"
	].includes(detectedMode) || ![
		"discovered",
		"conflict",
		"relocation_candidate",
		"ignored",
		"imported"
	].includes(status) || ![
		"high",
		"medium",
		"low"
	].includes(evidenceLevel)) throw new TypeError("intake service returned an invalid candidate state");
	const documents = candidate.documents;
	const issues = candidate.issues;
	if (!Array.isArray(documents) || documents.length > 200 || !Array.isArray(issues) || issues.length > 200) throw new TypeError("intake service returned invalid candidate evidence");
	return {
		candidateId: responseId(candidate.candidateId, IMPORT_CANDIDATE_ID, "candidateId"),
		jobId: responseId(candidate.jobId ?? candidate.importJobId, IMPORT_JOB_ID, "jobId"),
		revision: requiredRevision(candidate.revision, "candidate revision", 1),
		rootPath: boundedText(candidate.rootPath ?? root?.displayPath, "candidate rootPath", 32767),
		suggestedName: boundedText(candidate.suggestedName, "suggestedName", 240),
		nameSource: normalizeValueSource(candidate.nameSource ?? confidence.nameSource, "nameSource"),
		summary: boundedNullableText(candidate.summary ?? candidate.suggestedSummary, "summary", 1e3),
		summarySource: normalizeValueSource(candidate.summarySource, "summarySource"),
		evidenceLevel,
		status,
		detectedMode,
		manifestProjectId: boundedNullableText(candidate.manifestProjectId, "manifestProjectId", 80),
		documentCount: documents.length,
		issueCount: issues.length,
		evidence: includeDetails ? normalizeEvidenceStrings(candidate.evidence ?? confidence.evidence ?? []) : [],
		documents: includeDetails ? documents.map(normalizeCandidateDocument) : [],
		issues: includeDetails ? issues.map(normalizeImportIssue) : []
	};
}
function normalizeCandidateDocument(value) {
	const candidate = responseObject(value, "candidate document");
	const suggestedRole = candidate.suggestedRole;
	if (suggestedRole !== null && suggestedRole !== void 0 && (typeof suggestedRole !== "string" || !DOCUMENT_ROLES$1.has(suggestedRole))) throw new TypeError("intake service returned an invalid document role");
	const contentHash = candidate.contentHash ?? candidate.sha256;
	if (contentHash !== null && contentHash !== void 0 && (typeof contentHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(contentHash))) throw new TypeError("intake service returned an invalid document hash");
	return {
		documentId: responseId(candidate.documentId ?? candidate.candidateDocumentId, CANDIDATE_DOCUMENT_ID, "documentId"),
		relativePath: responseRelativePath(candidate.relativePath, "relativePath"),
		suggestedRole: suggestedRole ?? null,
		contentHash: contentHash ?? null,
		title: boundedNullableText(candidate.title, "document title", 240),
		preview: boundedNullableText(candidate.preview, "document preview", 1e3),
		evidence: normalizeEvidenceStrings(candidate.evidence ?? [])
	};
}
function normalizeImportIssue(value) {
	const candidate = responseObject(value, "import issue");
	const severity = boundedText(candidate.severity, "issue severity", 20);
	const status = boundedText(candidate.status, "issue status", 20);
	if (![
		"info",
		"warning",
		"error",
		"blocking"
	].includes(severity) || !["open", "resolved"].includes(status)) throw new TypeError("intake service returned an invalid issue state");
	return {
		issueId: responseId(candidate.issueId ?? candidate.importIssueId, IMPORT_ISSUE_ID, "issueId"),
		code: boundedText(candidate.code, "issue code", 80),
		severity,
		status,
		details: safeJsonObject(candidate.details ?? {}, "issue details")
	};
}
function requestObject(value, field) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw projectControlHttpError("INVALID_BODY", `${field}必须是对象。`);
	return value;
}
function responseObject(value, field) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`intake service returned an invalid ${field}`);
	return value;
}
function rejectUnknownKeys(value, allowed, field) {
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw projectControlHttpError("INVALID_BODY", `${field}包含未知字段。`);
}
function requireExactKeys(value, allowed, field) {
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw projectControlHttpError("INVALID_BODY", `${field}包含未知字段。`);
	for (const required of allowed) {
		if (required === "maxDepth") continue;
		if (!(required in value)) throw projectControlHttpError("INVALID_BODY", `${field}缺少必需字段。`);
	}
}
function requestText(value, field, maxLength) {
	if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) throw projectControlHttpError("INVALID_BODY", `${field}无效。`);
	return value;
}
function requestRevision(value, field, minimum) {
	if (!Number.isSafeInteger(value) || value < minimum) throw projectControlHttpError("INVALID_BODY", `${field}无效。`);
	return value;
}
function optionalSingleQuery(parsed, key, pattern) {
	const values = parsed.searchParams.getAll(key);
	if (values.length === 0) return void 0;
	if (values.length !== 1 || !pattern.test(values[0] ?? "")) throw projectControlHttpError("INVALID_QUERY", "项目候选筛选条件无效。");
	return values[0];
}
function rejectUnexpectedQuery(parsed, allowed) {
	for (const key of parsed.searchParams.keys()) if (!allowed.has(key)) throw projectControlHttpError("INVALID_QUERY", "项目控制台查询参数无效。");
}
function responseId(value, pattern, field) {
	if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`intake service returned an invalid ${field}`);
	return value;
}
function responseTimestamp(value, field) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError(`intake service returned an invalid ${field}`);
	return value;
}
function boundedNullableText(value, field, maxLength) {
	if (value === void 0 || value === null) return null;
	if (typeof value !== "string" || value.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new TypeError(`intake service returned an invalid ${field}`);
	return value;
}
function normalizeValueSource(value, field) {
	if (value === void 0 || value === null) return null;
	if (typeof value === "string") {
		const text = boundedNullableText(value, field, 512);
		if (text === null || text === "") return null;
		return text.includes("/") || text.includes("\\") || /\.[A-Za-z0-9_-]{1,12}$/u.test(text) ? { relativePath: text.replaceAll("\\", "/") } : { label: text };
	}
	const candidate = responseObject(value, field);
	const relativePath = boundedNullableText(candidate.relativePath, `${field}.relativePath`, 512);
	const label = boundedNullableText(candidate.label, `${field}.label`, 240);
	if (relativePath === null && label === null) return null;
	return {
		...relativePath === null ? {} : { relativePath: responseRelativePath(relativePath, field) },
		...label === null ? {} : { label }
	};
}
function normalizeEvidenceStrings(value) {
	if (Array.isArray(value)) {
		if (value.length > 100) throw new TypeError("intake service returned oversized evidence");
		return value.map((item, index) => {
			if (typeof item === "string" && item.length > 0 && item.length <= 500) return item;
			if (item !== null && typeof item === "object" && !Array.isArray(item)) {
				const evidence = item;
				const kind = typeof evidence.kind === "string" ? evidence.kind : "evidence";
				const detail = typeof evidence.detail === "string" ? evidence.detail : typeof evidence.message === "string" ? evidence.message : typeof evidence.relativePath === "string" ? evidence.relativePath : "";
				const rendered = detail === "" ? kind : `${kind}: ${detail}`;
				if (rendered.length > 0 && rendered.length <= 500) return rendered;
			}
			throw new TypeError(`intake service returned invalid evidence at ${String(index)}`);
		});
	}
	if (value !== null && typeof value === "object") {
		const candidate = value;
		for (const key of [
			"signals",
			"evidence",
			"reasons"
		]) if (Array.isArray(candidate[key])) return normalizeEvidenceStrings(candidate[key]);
		return normalizeEvidenceStrings(Object.entries(candidate).filter((entry) => typeof entry[1] === "string").map(([key, item]) => `${key}: ${item}`));
	}
	throw new TypeError("intake service returned invalid evidence");
}
function responseRelativePath(value, field) {
	if (typeof value !== "string" || !isCanonicalRelativePath(value)) throw new TypeError(`intake service returned an invalid ${field}`);
	return value;
}
function isCanonicalRelativePath(value) {
	return value.length > 0 && value.length <= 512 && !value.startsWith("/") && !value.startsWith("./") && !value.endsWith("/") && !value.includes("\\") && !value.includes(":") && !value.includes("//") && !/[\u0000-\u001f\u007f]/u.test(value) && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
function safeJsonObject(value, field) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`intake service returned an invalid ${field}`);
	return safeJsonValue(value, field, 0);
}
function safeJsonValue(value, field, depth) {
	if (depth > 5) throw new TypeError(`intake service returned an oversized ${field}`);
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError(`intake service returned an invalid ${field}`);
		return value;
	}
	if (typeof value === "string") {
		if (value.length > 1e3 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new TypeError(`intake service returned an invalid ${field}`);
		return value;
	}
	if (Array.isArray(value)) {
		if (value.length > 100) throw new TypeError(`intake service returned an oversized ${field}`);
		return value.map((item) => safeJsonValue(item, field, depth + 1));
	}
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value);
		if (entries.length > 100) throw new TypeError(`intake service returned an oversized ${field}`);
		return Object.fromEntries(entries.map(([key, item]) => {
			if (key.length === 0 || key.length > 100 || /[\u0000-\u001f\u007f]/u.test(key)) throw new TypeError(`intake service returned an invalid ${field}`);
			return [key, safeJsonValue(item, field, depth + 1)];
		}));
	}
	throw new TypeError(`intake service returned an invalid ${field}`);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_ID = /^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SOURCE_ROOT_ID = /^src_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IMPORT_JOB_ID = /^job_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IMPORT_CANDIDATE_ID = /^can_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANDIDATE_DOCUMENT_ID = /^doc_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IMPORT_ISSUE_ID = /^iss_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IMPORT_JOB_ISSUE_ID = /^jis_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REBIND_PROPOSAL_ID = /^rbd_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DOCUMENT_ROLES$1 = new Set([
	"readme",
	"prd",
	"devlog",
	"progress",
	"next",
	"current_architecture",
	"decision",
	"other"
]);
async function readJsonBody(request) {
	const contentType = request.headers["content-type"];
	if (typeof contentType !== "string" || contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw projectControlHttpError("UNSUPPORTED_MEDIA_TYPE", "项目控制台写入请求必须使用 application/json。", 415);
	const contentEncoding = request.headers["content-encoding"];
	if (contentEncoding !== void 0 && contentEncoding !== "identity") throw projectControlHttpError("UNSUPPORTED_CONTENT_ENCODING", "项目控制台写入请求不接受压缩正文。", 415);
	const rawLength = request.headers["content-length"];
	if (rawLength !== void 0) {
		const declared = Number(rawLength);
		if (!Number.isSafeInteger(declared) || declared < 0) throw projectControlHttpError("INVALID_CONTENT_LENGTH", "请求长度无效。");
		if (declared > 262144) throw projectControlHttpError("BODY_TOO_LARGE", "项目控制台请求内容过大。", 413);
	}
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > 262144) throw projectControlHttpError("BODY_TOO_LARGE", "项目控制台请求内容过大。", 413);
		chunks.push(buffer);
	}
	if (size === 0) throw projectControlHttpError("INVALID_JSON", "项目控制台写入请求正文不能为空。");
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw projectControlHttpError("INVALID_JSON", "项目控制台写入请求不是有效的 JSON。");
	}
}
async function executeLifecycleCommand(command, options) {
	const lifecycle = options.lifecycle;
	if (lifecycle === void 0) throw projectControlHttpError("LIFECYCLE_UNAVAILABLE", "生命周期指令服务暂不可用。", 503);
	const now = options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
	let storedReplayAuthorized = false;
	try {
		if ((command.kind === "project.registerLegacy" || command.kind === "project.registerManaged" || command.kind === "project.rebindLocation") && options.referenceResolver?.authorizeStoredReplay !== void 0 && lifecycle.replayCommandReceipt !== void 0 && await options.referenceResolver.authorizeStoredReplay(command)) {
			storedReplayAuthorized = true;
			const replay = await lifecycle.replayCommandReceipt(command);
			if (replay !== null) return replay;
		}
		if (command.kind === "project.createFromTemplate") {
			if (options.referenceResolver?.resolveCreate === void 0 || lifecycle.createProject === void 0) return lifecycle.recordRejectedCommand(command, lifecycleRejection(command, "CAPABILITY_NOT_NEGOTIATED", "此 Host 尚未开放标准项目快速新建。", now(), {
				currentRevision: command.expectedRevision,
				fileSync: plannedFileSync(command)
			}));
			const resolution = await options.referenceResolver.resolveCreate(command);
			if (resolution === null || resolution === void 0) return lifecycle.recordRejectedCommand(command, lifecycleRejection(command, "REFERENCE_UNRESOLVED", "新建授权或写入计划已失效，请重新准备。", now(), {
				currentRevision: command.expectedRevision,
				fileSync: plannedFileSync(command)
			}));
			return await lifecycle.createProject(command, resolution);
		}
		if (command.kind === "project.upgradeManaged") {
			if (options.referenceResolver?.resolveUpgrade === void 0 || lifecycle.upgradeProject === void 0) return lifecycle.recordRejectedCommand(command, lifecycleRejection(command, "CAPABILITY_NOT_NEGOTIATED", "此 Host 尚未开放 legacy 升级。", now(), {
				currentRevision: command.expectedRevision,
				fileSync: plannedFileSync(command)
			}));
			const resolution = await options.referenceResolver.resolveUpgrade(command);
			if (resolution === null || resolution === void 0) return lifecycle.recordRejectedCommand(command, lifecycleRejection(command, "REFERENCE_UNRESOLVED", "升级授权或写入计划已失效，请重新准备。", now(), {
				currentRevision: command.expectedRevision,
				fileSync: plannedFileSync(command)
			}));
			return await lifecycle.upgradeProject(command, resolution);
		}
		if (command.kind === "project.registerLegacy" || command.kind === "project.registerManaged") {
			const resolution = await options.referenceResolver?.resolveRegistration(command);
			if (resolution === void 0 || resolution === null) return lifecycle.recordRejectedCommand(command, lifecycleRejection(command, "REFERENCE_UNRESOLVED", "此 Host 尚未签发或解析项目位置引用；请等待 Gate 2C。", now()));
			return lifecycle.registerProject(command, resolution);
		}
		const resolution = await options.referenceResolver?.resolveRebind(command);
		if (resolution === void 0 || resolution === null) return lifecycle.recordRejectedCommand(command, lifecycleRejection(command, "REFERENCE_UNRESOLVED", "此 Host 尚未签发或解析新的项目位置引用；请等待 Gate 2C。", now()));
		return lifecycle.rebindProject(command, resolution);
	} catch (error) {
		let effectiveError = error;
		if (storedReplayAuthorized && lifecycle.replayCommandReceipt !== void 0) try {
			const replay = await lifecycle.replayCommandReceipt(command);
			if (replay !== null) return replay;
		} catch (replayError) {
			effectiveError = replayError;
		}
		const code = lifecycleBusinessErrorCode(effectiveError);
		if (code === null) throw effectiveError;
		const currentRevision = lifecycleBusinessErrorRevision(effectiveError);
		return lifecycleRejection(command, code, publicLifecycleErrorMessage(code), now(), {
			...currentRevision === void 0 ? {} : { currentRevision },
			...command.kind === "project.createFromTemplate" || command.kind === "project.upgradeManaged" ? { fileSync: plannedFileSync(command) } : {}
		});
	}
}
function lifecycleRejection(command, code, message, recordedAt, details = {}) {
	return {
		protocolVersion: PROJECT_PROTOCOL_VERSION,
		schemaVersion: "lifecycle-command-result/v1alpha1",
		commandId: command.commandId,
		correlationId: command.correlationId,
		kind: command.kind,
		status: "rejected",
		recordedAt,
		...details.currentRevision === void 0 ? {} : { currentRevision: details.currentRevision },
		error: {
			code,
			message
		},
		...details.fileSync === void 0 ? {} : { fileSync: details.fileSync }
	};
}
function plannedFileSync(command) {
	const writePlan = objectValue(command.payload.writePlan, "command.payload.writePlan");
	return {
		status: "planned",
		planId: boundedText(writePlan.planId, "command.payload.writePlan.planId", 80),
		planHash: boundedText(writePlan.planHash, "command.payload.writePlan.planHash", 80),
		manifestHash: boundedText(writePlan.manifestHash, "command.payload.writePlan.manifestHash", 80)
	};
}
function lifecycleBusinessErrorCode(error) {
	if (!(error instanceof Error)) return null;
	const code = error.code;
	return typeof code === "string" && LIFECYCLE_ERROR_CODES.has(code) ? code : null;
}
function lifecycleBusinessErrorRevision(error) {
	if (!(error instanceof Error)) return void 0;
	const details = error.details;
	if (details === null || typeof details !== "object" || Array.isArray(details)) return void 0;
	const currentRevision = details.currentRevision;
	return Number.isSafeInteger(currentRevision) && currentRevision >= 0 ? currentRevision : void 0;
}
function normalizeLifecycleResult(value) {
	const candidate = objectValue(value, "lifecycle result");
	const protocolVersion = boundedText(candidate.protocolVersion, "protocolVersion", 80);
	const schemaVersion = boundedText(candidate.schemaVersion, "schemaVersion", 80);
	const kind = boundedText(candidate.kind, "kind", 80);
	const status = boundedText(candidate.status, "status", 20);
	if (protocolVersion !== "project-control.dsh/v1alpha1" || schemaVersion !== "lifecycle-command-result/v1alpha1" || !LIFECYCLE_KINDS.has(kind) || ![
		"accepted",
		"replayed",
		"rejected"
	].includes(status)) throw new TypeError("lifecycle service returned an invalid result envelope");
	const common = {
		protocolVersion,
		schemaVersion,
		commandId: boundedText(candidate.commandId, "commandId", 80),
		correlationId: boundedText(candidate.correlationId, "correlationId", 200),
		kind,
		status,
		recordedAt: boundedText(candidate.recordedAt, "recordedAt", 80)
	};
	if (status === "rejected") {
		const code = boundedText(objectValue(candidate.error, "error").code, "error.code", 80);
		if (!LIFECYCLE_ERROR_CODES.has(code)) throw new TypeError("lifecycle service returned an unsupported error code");
		return {
			...common,
			...optionalRevision(candidate.currentRevision) === void 0 ? {} : { currentRevision: optionalRevision(candidate.currentRevision) },
			error: {
				code,
				message: publicLifecycleErrorMessage(code)
			},
			...candidate.fileSync === void 0 ? {} : { fileSync: normalizeFileSync(candidate.fileSync) }
		};
	}
	const projectMode = boundedText(candidate.projectMode, "projectMode", 30);
	const outcome = boundedText(candidate.outcome, "outcome", 80);
	const aggregateRevision = requiredRevision(candidate.aggregateRevision, "aggregateRevision", 1);
	if (!["linked_legacy", "managed"].includes(projectMode) || !LIFECYCLE_OUTCOMES.has(outcome)) throw new TypeError("lifecycle service returned invalid project outcome fields");
	return {
		...common,
		projectId: boundedText(candidate.projectId, "projectId", 80),
		projectMode,
		aggregateRevision,
		eventId: boundedText(candidate.eventId, "eventId", 80),
		outcome,
		fileSync: normalizeFileSync(candidate.fileSync)
	};
}
function publicLifecycleErrorMessage(code) {
	switch (code) {
		case "CAPABILITY_NOT_NEGOTIATED": return "当前 Host 尚未开放这项生命周期能力。";
		case "REFERENCE_UNRESOLVED": return "项目或位置引用当前无法解析。";
		case "IDEMPOTENCY_CONFLICT": return "相同命令标识已对应另一份请求。";
		case "REVISION_CONFLICT": return "项目已发生变化，请刷新后重新确认。";
		case "PROJECT_ALREADY_EXISTS": return "目标项目已经存在。";
		case "LOCATION_CONFLICT": return "项目位置与现有登记冲突。";
		case "MODE_CONFLICT": return "项目管理模式与当前指令不一致。";
		default: return "生命周期指令未被接受。";
	}
}
const LIFECYCLE_KINDS = new Set([
	"project.registerLegacy",
	"project.registerManaged",
	"project.createFromTemplate",
	"project.rebindLocation",
	"project.upgradeManaged"
]);
const LIFECYCLE_OUTCOMES = new Set([
	"legacy_registered",
	"managed_registered",
	"managed_created",
	"location_rebound",
	"managed_upgraded"
]);
const LIFECYCLE_ERROR_CODES = new Set([
	"PROTOCOL_VERSION_UNSUPPORTED",
	"SCHEMA_INVALID",
	"CAPABILITY_NOT_NEGOTIATED",
	"REFERENCE_UNRESOLVED",
	"IDEMPOTENCY_CONFLICT",
	"REVISION_CONFLICT",
	"PATH_OUTSIDE_WORKSPACE",
	"CREDENTIAL_DATA_REJECTED",
	"QUARANTINED",
	"PROJECT_ALREADY_EXISTS",
	"LOCATION_CONFLICT",
	"MODE_CONFLICT",
	"MANIFEST_INVALID",
	"MANIFEST_HASH_MISMATCH",
	"WRITE_PLAN_STALE",
	"TARGET_NOT_EMPTY",
	"FILE_SYNC_FAILED"
]);
function normalizeFileSync(value) {
	const candidate = objectValue(value, "fileSync");
	const status = boundedText(candidate.status, "fileSync.status", 40);
	if (![
		"not_required",
		"verified_existing",
		"committed",
		"planned",
		"rolled_back",
		"failed_recovery_required"
	].includes(status)) throw new TypeError("lifecycle service returned an unsupported file sync status");
	return {
		status,
		...candidate.planId === void 0 ? {} : { planId: boundedText(candidate.planId, "fileSync.planId", 80) },
		...candidate.planHash === void 0 ? {} : { planHash: boundedText(candidate.planHash, "fileSync.planHash", 80) },
		...candidate.manifestHash === void 0 ? {} : { manifestHash: boundedText(candidate.manifestHash, "fileSync.manifestHash", 80) }
	};
}
function objectValue(value, field) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`lifecycle service returned an invalid ${field}`);
	return value;
}
function optionalRevision(value) {
	return value === void 0 ? void 0 : requiredRevision(value, "currentRevision", 0);
}
function requiredRevision(value, field, minimum) {
	if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`lifecycle service returned an invalid ${field}`);
	return value;
}
function normalizeStatus(value) {
	if (![
		"ready",
		"read_only_newer_schema",
		"migration_failed",
		"unavailable"
	].includes(value.state)) throw new TypeError("storage returned an unsupported state");
	if (value.schemaVersion !== null && (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 0)) throw new TypeError("storage returned an invalid schema version");
	if (typeof value.writable !== "boolean") throw new TypeError("storage returned an invalid writable flag");
	if (value.projectCount !== null && (!Number.isSafeInteger(value.projectCount) || value.projectCount < 0)) throw new TypeError("storage returned an invalid project count");
	return {
		state: value.state,
		schemaVersion: value.schemaVersion,
		writable: value.writable,
		projectCount: value.projectCount
	};
}
function normalizeProjectList(value) {
	if (!Array.isArray(value.projects) || !Number.isSafeInteger(value.total) || value.total < value.projects.length) throw new TypeError("storage returned an invalid project list");
	return {
		projects: value.projects.map((item) => ({
			projectId: boundedText(item.projectId, "projectId", 200),
			name: boundedText(item.name, "name", 240),
			registrationMode: ["linked_legacy", "managed"].includes(item.registrationMode) ? item.registrationMode : "unknown",
			lifecycle: boundedText(item.lifecycle, "lifecycle", 80),
			updatedAt: boundedText(item.updatedAt, "updatedAt", 80)
		})),
		total: value.total
	};
}
function boundedText(value, field, maxLength) {
	if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) throw new TypeError(`storage returned an invalid ${field}`);
	return value;
}
function exposedError(error) {
	const candidate = error;
	if (candidate?.expose === true && typeof candidate.code === "string" && typeof candidate.status === "number" && candidate.status >= 400 && candidate.status <= 599 && error instanceof Error) return {
		status: candidate.status,
		code: candidate.code,
		message: error.message,
		...candidate.headers === void 0 ? {} : { headers: candidate.headers }
	};
	return {
		status: 500,
		code: "INTERNAL_ERROR",
		message: "项目控制台服务请求失败。"
	};
}
function sendJson(response, status, value, extraHeaders = {}, maxBytes = MAX_BODY_BYTES) {
	if (response.headersSent) return;
	let payload = JSON.stringify(value);
	if (Buffer.byteLength(payload, "utf8") > maxBytes) {
		status = 500;
		payload = JSON.stringify({
			ok: false,
			error: {
				code: "RESPONSE_TOO_LARGE",
				message: "项目控制台响应超过安全上限；请缩小扫描范围后重试。"
			}
		});
	}
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
		...extraHeaders
	});
	response.end(payload);
}
/** Verify the short-lived HMAC capability issued by the Electron main process. */
function verifyProjectControlSelectionTicket(options) {
	try {
		const path = requirePath(options.path);
		const secret = requireSecret(options.secret);
		const authorization = requireAuthorization(options.authorization);
		if (authorization.kind !== options.kind) return false;
		const nowMs = options.nowMs ?? Date.now();
		if (!Number.isSafeInteger(nowMs) || nowMs < 0) return false;
		const expiresMs = Date.parse(authorization.expiresAt);
		if (!Number.isFinite(expiresMs) || expiresMs < nowMs || expiresMs - nowMs > 3e5) return false;
		const expected = signSelectionTicket({
			kind: authorization.kind,
			path,
			expiresAt: authorization.expiresAt,
			nonce: authorization.nonce,
			secret
		});
		const actualBytes = Buffer.from(authorization.signature, "utf8");
		const expectedBytes = Buffer.from(expected, "utf8");
		return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
	} catch {
		return false;
	}
}
function signSelectionTicket(options) {
	return createHmac("sha256", options.secret).update(`${String(1)}\0${options.kind}\0${options.expiresAt}\0${options.nonce}\0${options.path}`, "utf8").digest("base64url");
}
function requireAuthorization(value) {
	if (typeof value !== "object" || value === null || value.version !== 1 || ![
		"source-root",
		"project-root",
		"create-parent"
	].includes(value.kind) || typeof value.expiresAt !== "string" || typeof value.nonce !== "string" || typeof value.signature !== "string" || value.signature.length !== 43) throw new TypeError("Selection ticket authorization is invalid.");
	return value;
}
function requirePath(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > 32767 || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError("Selection ticket path is invalid.");
	return value;
}
function requireSecret(value) {
	if (typeof value !== "string" || value.length < 32 || value.length > 256) throw new TypeError("Selection ticket secret is invalid.");
	return value;
}
//#endregion
//#region src/filesync/plan-executor.js
const RELATIVE_PATH = /^(?!\/)(?!.*[:\\])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\u0000-\u001F\u007F])(?!.*\/\/)(?!.*\/$)[^/]+(?:\/[^/]+)*$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const LEGACY_MANIFEST_PATH = ".dsh-project/project.yaml";
const PROJECT_HOME_MANIFEST_PATH$1 = "workspace/.dsh-project/project.yaml";
const PROJECT_HOME_MARKER_PATH$1 = ".project-home/project-home.json";
const PROJECT_HOME_TOP_LEVEL = new Set([
	".project-home",
	"workspace",
	"worktrees",
	"local"
]);
const STAGING_PREFIX = ".dsh-staging.";
var FileSyncPlanError = class extends Error {
	constructor(code, message, details) {
		super(message);
		this.name = "FileSyncPlanError";
		this.code = code;
		if (details !== void 0) this.details = details;
	}
};
function fail$1(code, message, details) {
	throw new FileSyncPlanError(code, message, details);
}
function sha256$2(bytes) {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function windowsKey(path) {
	return resolve(path).replaceAll("/", "\\").replace(/[\\]+$/, "").toLocaleLowerCase("en-US");
}
function pathIsWithin(rootPath, candidatePath) {
	const rootKey = windowsKey(rootPath);
	const candidateKey = windowsKey(candidatePath);
	const prefix = rootKey.endsWith("\\") ? rootKey : `${rootKey}\\`;
	return candidateKey === rootKey || candidateKey.startsWith(prefix);
}
/** Canonical staging location: sibling of the target for whole-tree creates,
* inside the authorized root for additive syncs. Both stay on the same volume. */
function stagingRootForPlan(plan, targetRoot) {
	if (plan.syncPolicy === "atomic_create") return join(dirname(resolve(targetRoot)), `${STAGING_PREFIX}${plan.planId}`);
	return join(resolve(targetRoot), `${STAGING_PREFIX}${plan.planId}`);
}
/** Host domain rules on top of the lifecycle schema. Returns the canonical
* execution order: directories in ascending path order, then files. */
function validateWritePlanDomain(plan) {
	if (!plan || typeof plan !== "object") fail$1("WRITE_PLAN_STALE", "The write plan is missing.");
	if (!["atomic_create", "atomic_additive"].includes(plan.syncPolicy)) fail$1("WRITE_PLAN_STALE", "The write plan sync policy is unsupported.");
	if (!CONTENT_HASH.test(String(plan.manifestHash ?? ""))) fail$1("WRITE_PLAN_STALE", "The write plan manifest hash uses an unsupported format.");
	if (!Array.isArray(plan.operations) || plan.operations.length < 1 || plan.operations.length > 500) fail$1("WRITE_PLAN_STALE", "The write plan must carry 1..500 operations.");
	const byPath = /* @__PURE__ */ new Map();
	const directories = [];
	const files = [];
	for (const raw of plan.operations) {
		const operation = raw && typeof raw === "object" ? raw : {};
		const kind = operation.kind;
		const relativePath = String(operation.relativePath ?? "");
		if (!["create_directory", "create_file"].includes(kind)) fail$1("WRITE_PLAN_STALE", "The write plan contains an unsupported operation.");
		if (!RELATIVE_PATH.test(relativePath)) fail$1("PATH_OUTSIDE_WORKSPACE", "A write plan path is not a safe project-relative path.", { relativePath });
		if (operation.expectedState !== "absent") fail$1("WRITE_PLAN_STALE", "Write plans may only create absent paths.", { relativePath });
		if (byPath.has(relativePath)) fail$1("WRITE_PLAN_STALE", "The write plan repeats a relative path.", { relativePath });
		const contentHash = operation.contentHash ?? null;
		if (kind === "create_file") {
			if (typeof contentHash !== "string" || !CONTENT_HASH.test(contentHash)) fail$1("WRITE_PLAN_STALE", "A write plan file operation lacks a valid content hash.", { relativePath });
			files.push({
				kind,
				relativePath,
				contentHash
			});
		} else {
			if (contentHash !== null && contentHash !== void 0) fail$1("WRITE_PLAN_STALE", "A directory operation cannot carry a content hash.", { relativePath });
			directories.push({
				kind,
				relativePath,
				contentHash: null
			});
		}
		byPath.set(relativePath, kind);
	}
	const requiredDirectories = /* @__PURE__ */ new Set();
	for (const file of files) {
		const segments = file.relativePath.split("/");
		for (let length = 1; length < segments.length; length += 1) requiredDirectories.add(segments.slice(0, length).join("/"));
	}
	for (const directory of directories) if (!requiredDirectories.has(directory.relativePath)) fail$1("WRITE_PLAN_STALE", "The write plan declares a directory no file needs.", { relativePath: directory.relativePath });
	const markerEntries = files.filter((operation) => operation.relativePath === PROJECT_HOME_MARKER_PATH$1);
	const isProjectHome = markerEntries.length > 0;
	if (markerEntries.length > 1) fail$1("MANIFEST_INVALID", "The write plan repeats the Project Home marker.");
	if (isProjectHome) {
		if (plan.syncPolicy !== "atomic_create") fail$1("MANIFEST_INVALID", "Project Home plans must create the whole Home atomically.");
		if (files.some((operation) => operation.relativePath === LEGACY_MANIFEST_PATH)) fail$1("MANIFEST_INVALID", "A Project Home plan cannot also create a legacy root manifest.");
		for (const operation of [...directories, ...files]) if (!PROJECT_HOME_TOP_LEVEL.has(operation.relativePath.split("/")[0])) fail$1("PATH_OUTSIDE_WORKSPACE", "A Project Home plan writes outside the fixed zones.", { relativePath: operation.relativePath });
		for (const zone of PROJECT_HOME_TOP_LEVEL) if (!directories.some((operation) => operation.relativePath === zone)) fail$1("MANIFEST_INVALID", "A Project Home plan is missing a fixed zone.", { zone });
	} else if (files.some((operation) => operation.relativePath === PROJECT_HOME_MANIFEST_PATH$1)) fail$1("MANIFEST_INVALID", "A workspace manifest under Project Home requires its Host marker.");
	const manifestPath = isProjectHome ? PROJECT_HOME_MANIFEST_PATH$1 : LEGACY_MANIFEST_PATH;
	const manifestEntries = files.filter((operation) => operation.relativePath === manifestPath);
	if (manifestEntries.length !== 1) fail$1("MANIFEST_INVALID", `The write plan must create exactly one ${manifestPath} file.`);
	if (manifestEntries[0].contentHash !== plan.manifestHash) fail$1("MANIFEST_INVALID", "The manifest hash does not match the project.yaml operation.");
	const canonical = [...directories.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0), ...files.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0)];
	return Object.freeze(canonical);
}
function computePlanHash(plan) {
	const operations = validateWritePlanDomain(plan).map((operation) => ({
		kind: operation.kind,
		relativePath: operation.relativePath,
		...operation.kind === "create_file" ? { contentHash: operation.contentHash } : {}
	}));
	return `sha256:${createHash("sha256").update(canonicalJson({
		manifestHash: plan.manifestHash,
		syncPolicy: plan.syncPolicy,
		operations
	}), "utf8").digest("hex")}`;
}
/** The Host re-computes the plan hash and never trusts the self-reported value. */
function verifyWritePlanHashes(plan) {
	if (!CONTENT_HASH.test(String(plan.planHash ?? ""))) fail$1("WRITE_PLAN_STALE", "The write plan hash uses an unsupported format.");
	if (computePlanHash(plan) !== plan.planHash) fail$1("WRITE_PLAN_STALE", "The write plan hash does not match its contents.");
	return true;
}
function topLevelOperations(canonical) {
	return canonical.filter((operation) => {
		const segments = operation.relativePath.split("/");
		for (let length = 1; length < segments.length; length += 1) if (canonical.some((candidate) => candidate.relativePath === segments.slice(0, length).join("/"))) return false;
		return true;
	});
}
async function requireAbsent(displayPath, code, details) {
	try {
		const info = await lstat(displayPath);
		fail$1(code, `The target path already exists: ${displayPath}`, {
			...details,
			occupied: true,
			entryKind: info.isDirectory() ? "directory" : info.isSymbolicLink() ? "link" : "file"
		});
	} catch (error) {
		if (error?.code === "ENOENT") return;
		if (error instanceof FileSyncPlanError) throw error;
		fail$1(code, `The target path cannot be checked: ${displayPath}`, {
			...details,
			causeCode: error?.code ?? "UNKNOWN"
		});
	}
}
async function writeStagedFile(stagingRoot, relativePath, content, expectedHash) {
	if (!Buffer.isBuffer(content)) content = Buffer.from(String(content), "utf8");
	if (sha256$2(content) !== expectedHash) fail$1("FILE_SYNC_FAILED", "Staged content does not match the write plan hash.", { relativePath });
	const stagedPath = join(stagingRoot, ...relativePath.split("/"));
	let handle;
	try {
		handle = await open(stagedPath, "wx");
		await handle.writeFile(content);
		await handle.sync();
	} catch (error) {
		fail$1("FILE_SYNC_FAILED", "A staged file could not be written.", {
			relativePath,
			causeCode: error?.code ?? "UNKNOWN"
		});
	} finally {
		try {
			await handle?.close();
		} catch {}
	}
}
async function syncDirectoryBestEffort(displayPath) {
	try {
		const handle = await open(displayPath, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch {}
}
async function stagePlan(options) {
	const { plan, canonical, targetRoot, stagingRoot, authorizedRoot, contents } = options;
	if (!isAbsolute(targetRoot) || !isAbsolute(stagingRoot) || !isAbsolute(authorizedRoot)) fail$1("PATH_OUTSIDE_WORKSPACE", "File sync paths must be absolute local paths.");
	if (pathIsWithin(authorizedRoot, targetRoot) === false) fail$1("PATH_OUTSIDE_WORKSPACE", "The target root escapes the authorized root.");
	if (pathIsWithin(authorizedRoot, stagingRoot) === false || !pathIsWithin(dirname(resolve(targetRoot)), stagingRoot) && pathIsWithin(resolve(targetRoot), stagingRoot) === false) fail$1("PATH_OUTSIDE_WORKSPACE", "The staging directory is not inside an authorized same-volume location.");
	const rootInfo = await (async () => {
		try {
			return await lstat(targetRoot);
		} catch (error) {
			if (error?.code === "ENOENT") return null;
			throw error;
		}
	})();
	let rootPreexistedEmpty = false;
	if (plan.syncPolicy === "atomic_create") {
		if (rootInfo !== null && (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())) fail$1("TARGET_NOT_EMPTY", "The new project target is occupied by a non-directory entry.");
		if (rootInfo !== null) {
			if ((await readdir(targetRoot)).length > 0) fail$1("TARGET_NOT_EMPTY", "The new project target directory is not empty.");
			rootPreexistedEmpty = true;
		}
	} else {
		if (rootInfo === null || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail$1("WRITE_PLAN_STALE", "The project root for an additive sync no longer exists.");
		for (const file of canonical.filter((operation) => operation.kind === "create_file")) {
			const segments = file.relativePath.split("/");
			for (let length = 1; length < segments.length; length += 1) {
				const ancestor = segments.slice(0, length).join("/");
				if (canonical.some((operation) => operation.kind === "create_directory" && operation.relativePath === ancestor)) continue;
				const info = await (async () => {
					try {
						return await lstat(join(targetRoot, ...ancestor.split("/")));
					} catch (error) {
						if (error?.code === "ENOENT") return null;
						throw error;
					}
				})();
				if (info === null || !info.isDirectory() || info.isSymbolicLink()) fail$1("WRITE_PLAN_STALE", "A file ancestor is neither declared nor present on disk.", { relativePath: ancestor });
			}
		}
	}
	if (plan.syncPolicy === "atomic_create") for (const file of canonical.filter((operation) => operation.kind === "create_file")) {
		const segments = file.relativePath.split("/");
		for (let length = 1; length < segments.length; length += 1) {
			const ancestor = segments.slice(0, length).join("/");
			if (!canonical.some((operation) => operation.kind === "create_directory" && operation.relativePath === ancestor)) fail$1("WRITE_PLAN_STALE", "A file ancestor is missing from the write plan.", { relativePath: ancestor });
		}
	}
	for (const operation of canonical) await requireAbsent(join(targetRoot, ...operation.relativePath.split("/")), "WRITE_PLAN_STALE", { relativePath: operation.relativePath });
	await requireAbsent(stagingRoot, "FILE_SYNC_FAILED", { reason: "staging_leftover" });
	await mkdir(stagingRoot);
	await syncDirectoryBestEffort(dirname(stagingRoot));
	for (const operation of canonical) {
		const stagedPath = join(stagingRoot, ...operation.relativePath.split("/"));
		if (operation.kind === "create_directory") await mkdir(stagedPath);
		else {
			const content = contents.get(operation.relativePath);
			if (content === void 0) fail$1("FILE_SYNC_FAILED", "The renderer did not provide staged content.", { relativePath: operation.relativePath });
			await mkdir(dirname(stagedPath), { recursive: true });
			await writeStagedFile(stagingRoot, operation.relativePath, content, operation.contentHash);
		}
	}
	for (const operation of canonical) await syncDirectoryBestEffort(join(stagingRoot, ...operation.relativePath.split("/")));
	return Object.freeze({
		rootPreexistedEmpty,
		stagedPaths: canonical.map((operation) => operation.relativePath)
	});
}
async function commitPlan(options) {
	const { plan, canonical, targetRoot, stagingRoot, rootPreexistedEmpty } = options;
	if (plan.syncPolicy === "atomic_create" && !rootPreexistedEmpty) {
		await requireAbsent(targetRoot, "TARGET_NOT_EMPTY", { reason: "target_appeared" });
		try {
			await rename(stagingRoot, targetRoot);
		} catch (error) {
			if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY" || error?.code === "EPERM") fail$1("TARGET_NOT_EMPTY", "The new project target appeared during commit.", { causeCode: error.code });
			throw error;
		}
	} else {
		const renamed = [];
		try {
			for (const operation of topLevelOperations(canonical)) {
				await requireAbsent(join(targetRoot, ...operation.relativePath.split("/")), "WRITE_PLAN_STALE", { relativePath: operation.relativePath });
				await rename(join(stagingRoot, ...operation.relativePath.split("/")), join(targetRoot, ...operation.relativePath.split("/")));
				renamed.push(operation.relativePath);
			}
		} catch (error) {
			fail$1("WRITE_PLAN_STALE", "A write plan target appeared during commit.", {
				renamed,
				causeCode: error?.code ?? "UNKNOWN"
			});
		}
		try {
			await rm(stagingRoot, {
				recursive: true,
				force: false
			});
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	}
	return Object.freeze({ createdPaths: canonical.map((operation) => operation.relativePath) });
}
async function verifyCommittedPlan(options) {
	const { plan, canonical, targetRoot } = options;
	const mismatches = [];
	for (const operation of canonical) {
		if (operation.kind !== "create_file") continue;
		const finalPath = join(targetRoot, ...operation.relativePath.split("/"));
		let bytes;
		try {
			bytes = await readFile(finalPath);
		} catch (error) {
			mismatches.push({
				relativePath: operation.relativePath,
				reason: "missing",
				causeCode: error?.code ?? "UNKNOWN"
			});
			continue;
		}
		if (sha256$2(bytes) !== operation.contentHash) mismatches.push({
			relativePath: operation.relativePath,
			reason: "hash_mismatch"
		});
	}
	return Object.freeze({
		ok: mismatches.length === 0,
		mismatches
	});
}
async function rollbackCreated(options) {
	const { plan, canonical, targetRoot, stagingRoot, createdPaths, removeTargetRoot } = options;
	const failures = [];
	const remove = async (displayPath) => {
		try {
			await rm(displayPath, {
				recursive: true,
				force: false
			});
		} catch (error) {
			if (error?.code !== "ENOENT") failures.push({
				displayPath,
				causeCode: error?.code ?? "UNKNOWN"
			});
		}
	};
	const reversed = [...canonical.filter((operation) => createdPaths.includes(operation.relativePath))].sort((a, b) => {
		const depthA = a.relativePath.split("/").length;
		const depthB = b.relativePath.split("/").length;
		if (depthA !== depthB) return depthB - depthA;
		const kindA = a.kind === "create_file" ? 0 : 1;
		const kindB = b.kind === "create_file" ? 0 : 1;
		if (kindA !== kindB) return kindA - kindB;
		return a.relativePath < b.relativePath ? 1 : a.relativePath > b.relativePath ? -1 : 0;
	});
	for (const operation of reversed) await remove(join(targetRoot, ...operation.relativePath.split("/")));
	if (removeTargetRoot === true) await remove(targetRoot);
	await remove(stagingRoot);
	return Object.freeze({
		complete: failures.length === 0,
		failures
	});
}
/** Startup recovery for one journaled plan. */
async function recoverPlan(options) {
	const { plan, canonical, targetRoot, stagingRoot, journal } = options;
	if (plan.state === "staging" || plan.state === "staged") {
		if (basename(stagingRoot) !== `${STAGING_PREFIX}${plan.planId}`) fail$1("FILE_SYNC_FAILED", "The staging directory name does not belong to this plan.", { stagingRoot });
		try {
			await rm(stagingRoot, {
				recursive: true,
				force: false
			});
		} catch (error) {
			if (error?.code !== "ENOENT") fail$1("FILE_SYNC_FAILED", "A staging residue could not be removed during recovery.", { causeCode: error?.code ?? "UNKNOWN" });
		}
		await journal.transition(plan.state, "rolled_back", {
			createdPaths: [],
			errorCode: "CRASH_RECOVERED"
		});
		return Object.freeze({ outcome: "rolled_back" });
	}
	if (plan.state === "files_committed") {
		const verification = await verifyCommittedPlan({
			plan,
			canonical,
			targetRoot
		});
		if (verification.ok) return Object.freeze({ outcome: "resumable" });
		await journal.transition(plan.state, "recovery_required", {
			createdPaths: plan.createdPaths,
			errorCode: "FILE_SYNC_VERIFY_FAILED"
		});
		return Object.freeze({
			outcome: "quarantined",
			mismatches: verification.mismatches
		});
	}
	fail$1("FILE_SYNC_FAILED", "The plan is not in a recoverable state.", { state: plan.state });
}
/** End-to-end executor: stage -> commit -> verify, with journal transitions and rollback. */
async function executeFileSyncPlan(options) {
	const { plan, targetRoot, stagingRoot, authorizedRoot, contents, journal } = options;
	const canonical = validateWritePlanDomain(plan);
	const stage = async () => stagePlan({
		plan,
		canonical,
		targetRoot,
		stagingRoot,
		authorizedRoot,
		contents
	});
	if (plan.state !== "planned" && plan.state !== "rolled_back") fail$1("FILE_SYNC_FAILED", "The plan is not in an executable state.", { state: plan.state });
	await journal.transition(plan.state, "staging", {});
	let staged = null;
	try {
		staged = await stage();
		await journal.transition("staging", "staged", {});
		const commit = await commitPlan({
			plan,
			canonical,
			targetRoot,
			stagingRoot,
			rootPreexistedEmpty: staged.rootPreexistedEmpty
		});
		const verification = await verifyCommittedPlan({
			plan,
			canonical,
			targetRoot
		});
		if (!verification.ok) {
			const rollback = await rollbackCreated({
				plan,
				canonical,
				targetRoot,
				stagingRoot,
				createdPaths: commit.createdPaths,
				removeTargetRoot: !staged.rootPreexistedEmpty
			});
			await journal.transition("staged", rollback.complete ? "rolled_back" : "recovery_required", {
				createdPaths: [],
				errorCode: "FILE_SYNC_VERIFY_FAILED"
			});
			fail$1("FILE_SYNC_FAILED", "Committed files failed the write plan re-verification.", { verification });
		}
		await journal.transition("staged", "files_committed", { createdPaths: commit.createdPaths });
		return Object.freeze({
			createdPaths: commit.createdPaths,
			rootPreexistedEmpty: staged.rootPreexistedEmpty
		});
	} catch (error) {
		if (journal) {
			const currentState = staged === null ? "staging" : "staged";
			const renamed = Array.isArray(error?.details?.renamed) ? error.details.renamed : [];
			try {
				const rollback = await rollbackCreated({
					plan,
					canonical,
					targetRoot,
					stagingRoot,
					createdPaths: renamed,
					removeTargetRoot: false
				});
				await journal.transition(currentState, rollback.complete ? "rolled_back" : "recovery_required", {
					createdPaths: [],
					errorCode: error instanceof FileSyncPlanError ? error.code : "FILE_SYNC_FAILED"
				});
			} catch {
				try {
					await journal.transition(currentState, "recovery_required", {
						createdPaths: renamed,
						errorCode: "ROLLBACK_INCOMPLETE"
					});
				} catch {}
			}
		}
		throw error;
	}
}
//#endregion
//#region src/project-home.ts
const PROJECT_HOME_MARKER_PATH = ".project-home/project-home.json";
const PROJECT_HOME_WORKSPACE_PATH = "workspace";
const PROJECT_HOME_MANIFEST_PATH = "workspace/.dsh-project/project.yaml";
Object.freeze({
	workspace: "workspace",
	worktrees: "worktrees",
	local: "local"
});
const PROJECT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u;
function existingFile$1(candidates) {
	for (const candidate of candidates) if (existsSync(candidate)) return candidate;
	const fallback = candidates.at(-1);
	if (fallback === void 0) throw new Error("Project Home schema path candidates are required.");
	return fallback;
}
const SCHEMA_PATH = existingFile$1([fileURLToPath(new URL("../../../protocol/project-control/v1alpha1/project-home/schemas/project-home.schema.json", import.meta.url)), fileURLToPath(new URL("../../../../protocol/project-control/v1alpha1/project-home/schemas/project-home.schema.json", import.meta.url))]);
var ProjectHomeContractError = class extends Error {
	code;
	details;
	constructor(code, message, details) {
		super(message);
		this.name = "ProjectHomeContractError";
		this.code = code;
		if (details !== void 0) this.details = details;
	}
};
let markerValidator;
function validator() {
	if (markerValidator !== void 0) return markerValidator;
	const ajv = new import__2020.default({
		allErrors: true,
		strict: true
	});
	(0, import_dist.default)(ajv);
	markerValidator = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, "utf8")));
	return markerValidator;
}
function validateProjectHomeMarker(value) {
	const validate = validator();
	const valid = validate(value) === true;
	return {
		valid,
		errors: valid ? [] : (validate.errors ?? []).slice(0, 20).map((error) => ({
			path: error.instancePath,
			keyword: error.keyword
		}))
	};
}
function validateProjectHomeIdentity(marker, manifest) {
	const markerResult = validateProjectHomeMarker(marker);
	if (!markerResult.valid) throw new ProjectHomeContractError("PROJECT_HOME_MARKER_INVALID", "Project Home marker is invalid.", { errors: markerResult.errors });
	const markerProjectId = marker.projectId;
	const manifestProjectId = manifest?.metadata?.projectId;
	if (markerProjectId !== manifestProjectId) throw new ProjectHomeContractError("PROJECT_ID_MISMATCH", "Project Home marker and workspace manifest disagree on projectId.", {
		markerProjectId,
		manifestProjectId
	});
	return true;
}
function isProjectHomeSlug(value) {
	return typeof value === "string" && PROJECT_SLUG.test(value);
}
//#endregion
//#region src/templates/registry.js
/** The registry is bundled into lib/index.js, so import.meta.url differs between
* source runs (src/templates/registry.js) and built runs (lib/index.js). Resolve
* against the first candidate that actually carries template.json assets. */
const TEMPLATE_ID = /^[a-z][a-z0-9.-]{1,127}$/;
const TEMPLATE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
function hasTemplateFiles(directory) {
	try {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory() || !TEMPLATE_ID.test(entry.name)) continue;
			for (const version of readdirSync(join(directory, entry.name), { withFileTypes: true })) if (version.isDirectory() && TEMPLATE_VERSION.test(version.name) && existsSync(join(directory, entry.name, version.name, "template.json"))) return true;
		}
	} catch {
		return false;
	}
	return false;
}
function existingFile(candidates) {
	for (const candidate of candidates) if (existsSync(candidate)) return candidate;
	return candidates[candidates.length - 1];
}
const TEMPLATE_DIRECTORY_CANDIDATES = [fileURLToPath(new URL("../templates/", import.meta.url)), fileURLToPath(new URL("../../templates/", import.meta.url))];
const TEMPLATES_DIRECTORY = TEMPLATE_DIRECTORY_CANDIDATES.find(hasTemplateFiles) ?? TEMPLATE_DIRECTORY_CANDIDATES[TEMPLATE_DIRECTORY_CANDIDATES.length - 1];
const TEMPLATE_SCHEMA_PATH = existingFile([fileURLToPath(new URL("../../../protocol/project-control/v1alpha1/templates/schemas/template-manifest.schema.json", import.meta.url)), fileURLToPath(new URL("../../../../protocol/project-control/v1alpha1/templates/schemas/template-manifest.schema.json", import.meta.url))]);
const LEGACY_PROJECT_MANIFEST_PATH = ".dsh-project/project.yaml";
const COMMON_PLACEHOLDERS = Object.freeze([
	"{{PROJECT_ID}}",
	"{{PROJECT_NAME}}",
	"{{CREATED_AT}}",
	"{{TEMPLATE_ID}}",
	"{{TEMPLATE_VERSION}}"
]);
const PROJECT_HOME_PLACEHOLDERS = Object.freeze([...COMMON_PLACEHOLDERS, "{{PROJECT_SLUG}}"]);
var TemplateRegistryError = class extends Error {
	constructor(code, message, details) {
		super(message);
		this.name = "TemplateRegistryError";
		this.code = code;
		if (details !== void 0) this.details = details;
	}
};
function fail(code, message, details) {
	throw new TemplateRegistryError(code, message, details);
}
let templateValidator;
function compileTemplateSchema() {
	const schema = JSON.parse(readFileSync(TEMPLATE_SCHEMA_PATH, "utf8"));
	const ajv = new import__2020.default({
		allErrors: true,
		strict: true
	});
	(0, import_dist.default)(ajv);
	return ajv.compile(schema);
}
function listTemplateVersions() {
	const versions = [];
	for (const entry of readdirSync(TEMPLATES_DIRECTORY, { withFileTypes: true })) {
		if (!entry.isDirectory() || !TEMPLATE_ID.test(entry.name)) continue;
		for (const versionEntry of readdirSync(join(TEMPLATES_DIRECTORY, entry.name), { withFileTypes: true })) {
			if (!versionEntry.isDirectory() || !TEMPLATE_VERSION.test(versionEntry.name)) continue;
			const template = loadTemplate(entry.name, versionEntry.name);
			if (template.layout !== "project-home") continue;
			versions.push(Object.freeze({
				templateId: template.templateId,
				templateVersion: template.templateVersion,
				displayName: template.displayName,
				description: template.description,
				protocolVersion: template.protocolVersion,
				templateHash: template.templateHash
			}));
		}
	}
	return Object.freeze(versions.sort((left, right) => `${left.templateId}@${left.templateVersion}` < `${right.templateId}@${right.templateVersion}` ? -1 : 1));
}
function loadTemplate(templateId, templateVersion) {
	if (!TEMPLATE_ID.test(String(templateId ?? "")) || !TEMPLATE_VERSION.test(String(templateVersion ?? ""))) fail("TEMPLATE_NOT_FOUND", "模板身份或版本无效。", {
		templateId,
		templateVersion
	});
	const templatePath = join(TEMPLATES_DIRECTORY, templateId, templateVersion, "template.json");
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(templatePath, "utf8"));
	} catch (error) {
		fail("TEMPLATE_NOT_FOUND", "模板不存在或不可读。", {
			templateId,
			templateVersion,
			causeCode: error?.code ?? "UNKNOWN"
		});
	}
	const validate = templateValidator ??= compileTemplateSchema();
	if (!validate(parsed)) fail("TEMPLATE_INVALID", "模板内容没有通过模板 Schema。", {
		templateId,
		templateVersion,
		errors: (validate.errors ?? []).slice(0, 20).map((error) => ({
			path: error.instancePath,
			keyword: error.keyword
		}))
	});
	return freezeTemplate(parsed);
}
function freezeTemplate(parsed) {
	const files = parsed.files.map((entry) => {
		if (entry.kind === "directory") return Object.freeze({
			kind: "directory",
			relativePath: entry.relativePath,
			content: null
		});
		return Object.freeze({
			kind: "file",
			relativePath: entry.relativePath,
			content: entry.content
		});
	});
	const layout = detectTemplateLayout(files);
	const manifestPath = layout === "project-home" ? PROJECT_HOME_MANIFEST_PATH : LEGACY_PROJECT_MANIFEST_PATH;
	validateTemplateHostRules(parsed.metadata, files, layout, manifestPath);
	return Object.freeze({
		templateId: parsed.metadata.templateId,
		templateVersion: parsed.metadata.templateVersion,
		displayName: parsed.metadata.displayName,
		description: parsed.metadata.description ?? null,
		protocolVersion: parsed.metadata.protocolVersion,
		layout,
		manifestPath,
		files: Object.freeze(files),
		templateHash: computeTemplateHash(parsed.metadata, files)
	});
}
function detectTemplateLayout(files) {
	const filePaths = new Set(files.filter((entry) => entry.kind === "file").map((entry) => entry.relativePath));
	const hasLegacyManifest = filePaths.has(LEGACY_PROJECT_MANIFEST_PATH);
	const hasProjectHomeManifest = filePaths.has(PROJECT_HOME_MANIFEST_PATH);
	const hasProjectHomeMarker = filePaths.has(PROJECT_HOME_MARKER_PATH);
	if (hasProjectHomeMarker && hasProjectHomeManifest && !hasLegacyManifest) return "project-home";
	if (!hasProjectHomeMarker && !hasProjectHomeManifest && hasLegacyManifest) return "legacy-workspace";
	fail("TEMPLATE_INVALID", "模板必须完整选择 legacy workspace 或 Project Home 布局，不能混用。");
}
function validateTemplateHostRules(metadata, files, layout, manifestPath) {
	if (metadata.templateId !== void 0 && files.length === 0) fail("TEMPLATE_INVALID", "模板不包含任何文件。", { templateId: metadata.templateId });
	const paths = /* @__PURE__ */ new Set();
	const directorySet = /* @__PURE__ */ new Set();
	const fileEntries = [];
	for (const entry of files) {
		if (paths.has(entry.relativePath)) fail("TEMPLATE_INVALID", "模板包含重复路径。", { relativePath: entry.relativePath });
		paths.add(entry.relativePath);
		if (entry.kind === "directory") directorySet.add(entry.relativePath);
		else fileEntries.push(entry);
	}
	const requiredDirectories = /* @__PURE__ */ new Set();
	for (const file of fileEntries) {
		const segments = file.relativePath.split("/");
		for (let length = 1; length < segments.length; length += 1) requiredDirectories.add(segments.slice(0, length).join("/"));
	}
	for (const directory of directorySet) if (!requiredDirectories.has(directory)) fail("TEMPLATE_INVALID", "模板声明了任何文件都不需要的目录。", { relativePath: directory });
	for (const directory of requiredDirectories) if (!directorySet.has(directory)) fail("TEMPLATE_INVALID", "模板缺少文件所需的目录声明。", { relativePath: directory });
	const manifestEntries = fileEntries.filter((entry) => entry.relativePath === manifestPath);
	if (manifestEntries.length !== 1) fail("TEMPLATE_INVALID", `模板必须恰好包含一个 ${manifestPath} 文件条目。`);
	const manifestContent = manifestEntries[0].content;
	for (const token of COMMON_PLACEHOLDERS) if (!manifestContent.includes(token)) fail("TEMPLATE_INVALID", "project.yaml 模板必须使用全部五个占位符。", { missing: token });
	if (layout === "project-home") {
		const markerEntries = fileEntries.filter((entry) => entry.relativePath === PROJECT_HOME_MARKER_PATH);
		if (markerEntries.length !== 1) fail("TEMPLATE_INVALID", `Project Home 模板必须恰好包含一个 ${PROJECT_HOME_MARKER_PATH} 文件条目。`);
		for (const token of [
			"{{PROJECT_ID}}",
			"{{PROJECT_SLUG}}",
			"{{CREATED_AT}}"
		]) if (!markerEntries[0].content.includes(token)) fail("TEMPLATE_INVALID", "Project Home marker 必须使用身份、slug 与创建时间占位符。", { missing: token });
	}
	const placeholders = layout === "project-home" ? PROJECT_HOME_PLACEHOLDERS : COMMON_PLACEHOLDERS;
	for (const entry of fileEntries) {
		const stripped = placeholders.reduce((text, token) => text.split(token).join(""), entry.content);
		if (/\{\{|\}\}/.test(stripped)) fail("TEMPLATE_INVALID", "模板包含未定义的占位符片段。", { relativePath: entry.relativePath });
	}
	for (const entry of files) if (/\{\{|\}\}/.test(entry.relativePath)) fail("TEMPLATE_INVALID", "模板路径不允许包含占位符。", { relativePath: entry.relativePath });
	if (fileEntries.reduce((sum, entry) => sum + Buffer.byteLength(entry.content, "utf8"), 0) > 256 * 1024) fail("TEMPLATE_INVALID", "模板内容超过总字节上限。");
}
function computeTemplateHash(metadata, files) {
	const input = {
		templateId: metadata.templateId,
		templateVersion: metadata.templateVersion,
		files: files.map((entry) => entry.kind === "directory" ? {
			relativePath: entry.relativePath,
			kind: "directory"
		} : {
			relativePath: entry.relativePath,
			kind: "file",
			content: entry.content
		}).sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)
	};
	return `sha256:${createHash("sha256").update(canonicalJson(input), "utf8").digest("hex")}`;
}
/** Pure placeholder substitution; unknown tokens or leftover braces are rejected. */
function renderTemplate(template, params) {
	const values = {
		"{{PROJECT_ID}}": requireParam(params, "projectId"),
		"{{PROJECT_NAME}}": requireParam(params, "name"),
		"{{CREATED_AT}}": requireParam(params, "createdAt"),
		"{{TEMPLATE_ID}}": template.templateId,
		"{{TEMPLATE_VERSION}}": template.templateVersion
	};
	if (template.layout === "project-home") values["{{PROJECT_SLUG}}"] = requireParam(params, "slug");
	const placeholders = template.layout === "project-home" ? PROJECT_HOME_PLACEHOLDERS : COMMON_PLACEHOLDERS;
	const rendered = /* @__PURE__ */ new Map();
	for (const entry of template.files) {
		if (entry.kind === "directory") continue;
		const content = placeholders.reduce((text, token) => text.split(token).join(values[token]), entry.content);
		if (/\{\{|\}\}/.test(content)) fail("TEMPLATE_RENDER_FAILED", "渲染后仍残留占位符片段。", { relativePath: entry.relativePath });
		rendered.set(entry.relativePath, Buffer.from(content, "utf8"));
	}
	const manifestBytes = rendered.get(template.manifestPath);
	if (manifestBytes === void 0) fail("TEMPLATE_RENDER_FAILED", "渲染结果缺少 project.yaml。", { manifestPath: template.manifestPath });
	const manifestText = manifestBytes.toString("utf8");
	let manifestObject;
	try {
		manifestObject = parseYamlSubset(manifestText);
	} catch (error) {
		fail("TEMPLATE_RENDER_FAILED", "渲染后的 project.yaml 无法解析。", { cause: String(error) });
	}
	const validation = validateProjectManifest(manifestObject);
	if (!validation.valid) fail("TEMPLATE_RENDER_FAILED", "渲染后的 project.yaml 没有通过 manifest Schema。", { errors: validation.errors });
	let markerObject = null;
	if (template.layout === "project-home") {
		const markerBytes = rendered.get(PROJECT_HOME_MARKER_PATH);
		if (markerBytes === void 0) fail("TEMPLATE_RENDER_FAILED", "渲染结果缺少 Project Home marker。");
		try {
			markerObject = JSON.parse(markerBytes.toString("utf8"));
		} catch (error) {
			fail("TEMPLATE_RENDER_FAILED", "渲染后的 Project Home marker 无法解析。", { cause: String(error) });
		}
		const markerValidation = validateProjectHomeMarker(markerObject);
		if (!markerValidation.valid) fail("TEMPLATE_RENDER_FAILED", "渲染后的 Project Home marker 没有通过 Schema。", { errors: markerValidation.errors });
		try {
			validateProjectHomeIdentity(markerObject, manifestObject);
		} catch (error) {
			fail("TEMPLATE_RENDER_FAILED", "Project Home marker 与 workspace manifest 身份不一致。", { causeCode: error?.code ?? "UNKNOWN" });
		}
		if (markerObject.slug !== params.slug) fail("TEMPLATE_RENDER_FAILED", "Project Home marker slug 与目标目录不一致。");
	}
	return Object.freeze({
		contents: rendered,
		manifestObject,
		markerObject
	});
}
function requireParam(params, field) {
	const value = params?.[field];
	if (typeof value !== "string" || value.length < 1 || value.length > 2048) fail("TEMPLATE_RENDER_FAILED", `渲染参数 ${field} 无效。`);
	return value;
}
//#endregion
//#region src/document-index.ts
const LIMITS = Object.freeze({
	maxDocumentBytes: 8 * 1024 * 1024,
	maxTotalBytes: 64 * 1024 * 1024,
	maxWalkEntries: 5e3,
	maxWalkDepth: 6,
	maxCandidatesPerBinding: 50
});
const TEXT_EXTENSIONS = new Set([
	".md",
	".markdown",
	".mdx",
	".txt",
	".rst",
	".yaml",
	".yml"
]);
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*[:\\])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\u0000-\u001F\u007F])(?!.*\/\/)(?!.*\/$)[^/]+(?:\/[^/]+)*$/;
function comparisonPath(value) {
	const normalized = normalize(value);
	return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}
function isWithin(rootPath, candidatePath) {
	const relation = relative(comparisonPath(rootPath), comparisonPath(candidatePath));
	return relation === "" || !relation.startsWith("..") && !isAbsolute(relation);
}
function sha256$1(bytes) {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function cleanMessage(value, maximum = 1e3) {
	return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, maximum);
}
function analyzeParseIssues(bytes, relativePath) {
	const extension = extname(relativePath).toLocaleLowerCase("en-US");
	if (!TEXT_EXTENSIONS.has(extension)) return [];
	const issues = [];
	let text;
	try {
		text = decodeText(bytes);
	} catch (error) {
		issues.push({
			code: "TEXT_ENCODING_UNSUPPORTED",
			severity: "warning",
			message: cleanMessage(`文档不是可安全解析的 UTF-8/UTF-16 文本（${String(error?.code ?? "DECODE_FAILED")}）。`),
			line: null
		});
		return issues;
	}
	const lines = text.split(/\r?\n/);
	if (lines[0]?.trim() === "---") {
		const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
		if (end <= 0) issues.push({
			code: "FRONTMATTER_UNTERMINATED",
			severity: "warning",
			message: "文档开头的 frontmatter 块没有闭合。",
			line: null
		});
		else try {
			parseYamlSubset(lines.slice(1, end).join("\n"));
		} catch (error) {
			issues.push({
				code: "FRONTMATTER_PARSE_FAILED",
				severity: "warning",
				message: cleanMessage(`frontmatter 解析失败：${error instanceof Error ? error.message : "UNKNOWN"}`),
				line: null
			});
		}
	} else if (extension === ".yaml" || extension === ".yml") try {
		parseYamlSubset(text);
	} catch (error) {
		issues.push({
			code: "DOCUMENT_PARSE_FAILED",
			severity: "warning",
			message: cleanMessage(`文档解析失败：${error instanceof Error ? error.message : "UNKNOWN"}`),
			line: null
		});
	}
	return issues;
}
async function readBoundedFile(realPath, budget) {
	if ((budget.exhausted ?? false) || budget.bytesRead >= budget.maxBytes) return { kind: "budget_exhausted" };
	let handle;
	try {
		handle = await open(realPath, "r");
		const fileStat = await handle.stat();
		if (fileStat.size > LIMITS.maxDocumentBytes) return { kind: "too_large" };
		const remaining = budget.maxBytes - budget.bytesRead;
		if (fileStat.size > remaining) {
			budget.exhausted = true;
			return { kind: "budget_exhausted" };
		}
		const buffer = Buffer.alloc(Math.max(0, fileStat.size) + 1);
		let total = 0;
		while (total < buffer.length) {
			const result = await handle.read(buffer, total, buffer.length - total, total);
			if (result.bytesRead === 0) break;
			total += result.bytesRead;
		}
		if (total > LIMITS.maxDocumentBytes) return { kind: "too_large" };
		budget.bytesRead += total;
		return {
			kind: "bytes",
			bytes: Buffer.from(buffer.subarray(0, total))
		};
	} catch {
		return { kind: "unreadable" };
	} finally {
		if (handle !== void 0) await handle.close();
	}
}
async function verifyBindingDocument(rootDisplay, rootReal, binding, budget) {
	const base = {
		role: binding.role,
		relativePath: binding.relativePath,
		bindingSource: binding.source
	};
	const missing = {
		...base,
		state: "missing",
		contentHash: null,
		byteSize: null,
		parseIssues: []
	};
	const unreadable = {
		...base,
		state: "unreadable",
		contentHash: null,
		byteSize: null,
		parseIssues: []
	};
	const displayPath = join(rootDisplay, ...binding.relativePath.split("/"));
	let info;
	try {
		info = await lstat(displayPath);
	} catch {
		return missing;
	}
	if (!info.isFile()) return missing;
	let realFile;
	try {
		realFile = await realpath(displayPath);
	} catch {
		return unreadable;
	}
	if (!isWithin(rootReal, realFile)) return unreadable;
	const read = await readBoundedFile(realFile, budget);
	if (read.kind !== "bytes") return unreadable;
	const contentHash = sha256$1(read.bytes);
	const changed = binding.contentHash !== null && binding.contentHash !== contentHash;
	return {
		...base,
		state: changed ? "changed" : "ok",
		contentHash,
		byteSize: read.bytes.length,
		parseIssues: analyzeParseIssues(read.bytes, binding.relativePath)
	};
}
async function collectRenameCandidates(rootDisplay, rootReal, boundPaths, targets, budget) {
	const found = /* @__PURE__ */ new Map();
	async function visit(displayDirectory, realDirectory, depth) {
		if ((budget.exhausted ?? false) || depth > LIMITS.maxWalkDepth || budget.bytesRead >= budget.maxBytes) return;
		let entries;
		try {
			entries = await readdir(realDirectory, { withFileTypes: true });
		} catch {
			return;
		}
		entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
		for (const entry of entries) {
			if ((budget.exhausted ?? false) || budget.bytesRead >= budget.maxBytes) return;
			const displayPath = join(displayDirectory, entry.name);
			const relativePath = relative(rootDisplay, displayPath).replaceAll("\\", "/");
			if (!SAFE_RELATIVE_PATH.test(relativePath)) continue;
			const lowerName = entry.name.toLocaleLowerCase("en-US");
			if (entry.isDirectory()) {
				if (isIgnoredDirectoryName(lowerName)) continue;
				let realChild;
				try {
					realChild = await realpath(displayPath);
				} catch {
					continue;
				}
				if (!isWithin(rootReal, realChild)) continue;
				await visit(displayPath, realChild, depth + 1);
				continue;
			}
			if (!entry.isFile()) continue;
			if (boundPaths.has(relativePath)) continue;
			let realFile;
			try {
				realFile = await realpath(displayPath);
			} catch {
				continue;
			}
			if (!isWithin(rootReal, realFile)) continue;
			const read = await readBoundedFile(realFile, budget);
			if (read.kind !== "bytes") {
				if (read.kind === "budget_exhausted") budget.exhausted = true;
				continue;
			}
			const hash = sha256$1(read.bytes);
			const matches = targets.get(hash);
			if (matches === void 0) continue;
			for (const match of matches) {
				const list = found.get(match.key) ?? [];
				if (list.length < LIMITS.maxCandidatesPerBinding && !list.includes(relativePath)) list.push(relativePath);
				found.set(match.key, list);
			}
		}
	}
	await visit(rootDisplay, rootReal, 0);
	return found;
}
/**
* P5 Host pipeline: verify every authoritative binding against the registered
* workspace, record hash/revision/parse diagnostics, and propose content-hash
* rebinds for missing legacy documents. This reads project files but never
* copies document content into the global database and never emits domain
* events or advances WorkItem/Review aggregates.
*/
async function refreshProjectDocumentIndex(_storage, project) {
	if (project.mode !== "linked_legacy" && project.mode !== "managed") throw projectControlHttpError("MODE_CONFLICT", "项目模式不支持文档索引。", 409);
	const location = (project.workspaceLocations ?? []).find((item) => item.isActive);
	if (location === void 0) throw projectControlHttpError("REFERENCE_UNRESOLVED", "项目没有可用的活动位置。", 409);
	const rootDisplay = normalize(location.displayPath);
	let rootReal;
	try {
		rootReal = await realpath(rootDisplay);
	} catch {
		throw projectControlHttpError("PROJECT_LOCATION_UNAVAILABLE", "项目目录当前无法访问。", 409);
	}
	const mirrorBindings = project.manifestMirror?.documentBindings;
	const bindings = (project.mode === "managed" ? mirrorBindings ?? project.documentBindings ?? [] : project.documentBindings ?? []).map((binding) => ({
		role: binding.role,
		relativePath: binding.relativePath,
		contentHash: binding.contentHash ?? null,
		required: binding.required ?? false,
		source: project.mode === "managed" ? "manifest" : binding.source === "manifest" ? "manifest" : "user_confirmed"
	}));
	const boundPaths = new Set(bindings.map((binding) => binding.relativePath));
	const readBudget = {
		bytesRead: 0,
		maxBytes: LIMITS.maxTotalBytes
	};
	const documentStates = [];
	const missingWithHash = [];
	for (const binding of bindings) {
		const state = await verifyBindingDocument(rootDisplay, rootReal, binding, readBudget);
		documentStates.push(state);
		if (state.state === "missing" && binding.contentHash !== null) missingWithHash.push({
			key: `${binding.role}\u0000${binding.relativePath}`,
			binding
		});
	}
	const rebindProposals = [];
	if (missingWithHash.length > 0) {
		const targets = /* @__PURE__ */ new Map();
		for (const item of missingWithHash) {
			const list = targets.get(item.binding.contentHash ?? "") ?? [];
			list.push(item);
			targets.set(item.binding.contentHash ?? "", list);
		}
		const found = await collectRenameCandidates(rootDisplay, rootReal, boundPaths, targets, readBudget);
		for (const item of missingWithHash) {
			const candidates = found.get(item.key);
			if (candidates !== void 0 && candidates.length > 0) rebindProposals.push({
				role: item.binding.role,
				missingRelativePath: item.binding.relativePath,
				contentHash: item.binding.contentHash ?? "",
				candidateRelativePaths: candidates
			});
		}
	}
	return {
		projectId: project.projectId,
		documentStates,
		rebindProposals
	};
}
//#endregion
//#region src/intake.ts
const REFERENCE_SCOPE = "project-control.lifecycle";
function createProjectControlIntakeRuntime(options) {
	const now = options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
	const idFactory = options.idFactory ?? ((prefix) => createPrefixedUuidV7(prefix));
	const consumedSelections = /* @__PURE__ */ new Map();
	const referenceContext = {
		applicationInstanceId: options.applicationInstanceId,
		scope: REFERENCE_SCOPE
	};
	const projectHomeRoot = options.projectHomeRoot ?? "F:\\Projects";
	return {
		intake: {
			async scan(input) {
				authorizeSelection(input, options.selectionSecret, consumedSelections);
				try {
					const scan = requireScanEnvelope(input.mode === "source-root" ? await options.scanner.scanSourceDirectory(input.selection.path, { ...input.maxDepth === void 0 ? {} : { maxDepth: input.maxDepth } }) : await options.scanner.scanProjectDirectory(input.selection.path, { ...input.maxDepth === void 0 ? {} : { maxDepth: input.maxDepth } }));
					const expectedMode = input.mode === "source-root" ? "source_root" : "single_project";
					if (scan.mode !== expectedMode || !sameWindowsPath(scan.rootPath.displayPath, input.selection.path)) throw projectControlHttpError("SCAN_BOUNDARY_MISMATCH", "扫描器返回了目录选择范围之外的结果。", 409);
					return options.storage.recordImportScan(await annotateKnownProjects(scan, options.storage));
				} catch (error) {
					consumedSelections.delete(input.selection.authorization.nonce);
					throw publicIntakeError(error);
				}
			},
			listSourceRoots() {
				return options.storage.listSourceRoots({
					isEnabled: true,
					limit: 100
				});
			},
			listCandidates(filter) {
				return options.storage.listImportCandidates({
					...filter.jobId === void 0 ? {} : { importJobId: filter.jobId },
					latestPerPath: filter.jobId === void 0,
					limit: 100
				});
			},
			getCandidate(candidateId) {
				return requireCandidate(options.storage, candidateId);
			},
			setCandidateIgnored(candidateId, input) {
				try {
					return options.storage.setImportCandidateIgnored(candidateId, input.ignored, input.expectedRevision);
				} catch (error) {
					throw publicIntakeError(error);
				}
			},
			async prepareCandidate(candidateId, input) {
				const candidate = requireCandidate(options.storage, candidateId);
				requireCandidateRevision(candidate, input.expectedRevision);
				if (!["discovered", "relocation_candidate"].includes(candidate.status)) throw projectControlHttpError("CANDIDATE_NOT_READY", "这个项目候选当前不能登记；请先解决冲突或恢复忽略状态。", 409);
				const fresh = await rescanCandidate(options.scanner, candidate);
				verifyPreparation(candidate, fresh, input);
				let refs;
				try {
					refs = options.storage.issueImportCandidateRefs(candidateId, {
						...referenceContext,
						expectedRevision: input.expectedRevision,
						ttlSeconds: 300
					});
				} catch (error) {
					throw publicIntakeError(error);
				}
				return signIntakeCommand(buildLifecycleCommand({
					candidate,
					fresh,
					input,
					refs,
					applicationInstanceId: options.applicationInstanceId,
					applicationVersion: options.applicationVersion,
					occurredAt: now(),
					project: candidate.status === "relocation_candidate" ? requireMatchedProject(options.storage, candidate) : null
				}), options.selectionSecret);
			},
			async prepareUpgrade(projectId, input) {
				const project = options.storage.getProject(projectId);
				if (project === null || project.mode !== "linked_legacy") throw projectControlHttpError("MODE_CONFLICT", "只有已关联的旧项目可以升级为受管理项目。", 409);
				if (project.revision !== input.expectedRevision) throw projectControlHttpError("REVISION_CONFLICT", "项目已经变化，请刷新后重试。", 409);
				const activeLocation = project.workspaceLocations?.find((location) => location.isActive);
				if (activeLocation === void 0) throw projectControlHttpError("REFERENCE_UNRESOLVED", "项目没有可升级的活动位置。", 409);
				const bindings = (project.documentBindings ?? []).map((binding) => ({
					role: binding.role,
					relativePath: binding.relativePath,
					contentHash: binding.contentHash
				})).sort((left, right) => `${left.role}\u0000${left.relativePath}` < `${right.role}\u0000${right.relativePath}` ? -1 : 1);
				const fingerprintHash = sha256(Buffer.from(canonicalJson({
					projectId,
					documentBindings: bindings
				}), "utf8"));
				const manifestYaml = buildUpgradeManifestYaml({
					projectId,
					name: project.name,
					createdAt: project.createdAt,
					documentBindings: bindings.map((binding) => ({
						role: binding.role,
						relativePath: binding.relativePath,
						required: Boolean((project.documentBindings ?? []).find((item) => item.relativePath === binding.relativePath && item.role === binding.role)?.required)
					}))
				});
				const manifestHash = sha256(Buffer.from(manifestYaml, "utf8"));
				let manifestObject;
				try {
					manifestObject = parseYamlSubset(manifestYaml);
				} catch {
					throw projectControlHttpError("MANIFEST_INVALID", "无法为该项目生成合法 manifest。", 409);
				}
				if (!validateProjectManifest(manifestObject).valid) throw projectControlHttpError("MANIFEST_INVALID", "无法为该项目生成合法 manifest。", 409);
				const syncPolicy = "atomic_additive";
				const operations = [{
					kind: "create_directory",
					relativePath: ".dsh-project",
					expectedState: "absent"
				}, {
					kind: "create_file",
					relativePath: ".dsh-project/project.yaml",
					expectedState: "absent",
					contentHash: manifestHash
				}];
				const planHash = computePlanHash({
					manifestHash,
					syncPolicy,
					operations
				});
				const planId = idFactory("pln");
				const commandId = idFactory("cmd");
				const createdAt = now();
				const targetDisplayPath = activeLocation.displayPath;
				const stagingDisplayPath = stagingRootForPlan({
					syncPolicy,
					planId
				}, targetDisplayPath);
				options.storage.createFileSyncPlan({
					planId,
					commandId,
					kind: "upgrade_managed",
					projectId,
					syncPolicy,
					targetDisplayPath,
					targetNormalizedPath: activeLocation.normalizedPath,
					stagingDisplayPath,
					planHash,
					manifestHash,
					operations,
					renderParams: {
						projectId,
						name: project.name,
						createdAt: project.createdAt,
						fingerprintHash,
						documentBindings: bindings,
						expectedRevision: project.revision,
						locationRef: activeLocation.locationId,
						locationRevision: activeLocation.revision
					}
				});
				const refs = options.storage.issueFileSyncPlanRefs(planId, {
					...referenceContext,
					targetDisplayPath,
					targetNormalizedPath: activeLocation.normalizedPath,
					parentDisplayPath: win32.dirname(targetDisplayPath),
					parentNormalizedPath: win32.dirname(activeLocation.normalizedPath),
					ttlSeconds: 300
				});
				const command = signIntakeCommand({
					protocolVersion: "project-control.dsh/v1alpha1",
					schemaVersion: "lifecycle-command-envelope/v1alpha1",
					commandId,
					correlationId: `intake:${planId}`,
					idempotencyKey: `intake.upgrade:${planId}`,
					kind: "project.upgradeManaged",
					occurredAt: createdAt,
					actor: {
						kind: "human",
						id: "desktop-user",
						applicationId: "deepseek-harness-personal",
						displayName: "桌面端用户"
					},
					target: {
						aggregateType: "project",
						projectId
					},
					expectedRevision: project.revision,
					provenance: {
						sourceType: "human",
						sourceId: "project-console:intake-upgrade",
						applicationVersion: options.applicationVersion,
						applicationInstanceId: options.applicationInstanceId,
						observedAt: createdAt
					},
					payload: {
						locationRef: activeLocation.locationId,
						locationRevision: activeLocation.revision,
						legacyFingerprintHash: fingerprintHash,
						writePlan: {
							planId,
							planHash,
							manifestHash,
							syncPolicy,
							operations
						}
					},
					extensions: { "cyrus.project-control.intake": { planId } }
				}, options.selectionSecret);
				return {
					projectId,
					name: project.name,
					targetDisplayPath,
					documentCount: bindings.length,
					fingerprintHash,
					expiresAt: refs.expiresAt,
					writePlan: {
						planId,
						planHash,
						manifestHash,
						syncPolicy,
						operations
					},
					command
				};
			},
			getProjectDocuments(projectId) {
				requireRegisteredProject(options.storage, projectId);
				return options.storage.getProjectDocumentIndex(projectId);
			},
			async refreshProjectDocuments(projectId) {
				const project = requireRegisteredProject(options.storage, projectId);
				try {
					const payload = await refreshProjectDocumentIndex(options.storage, project);
					return options.storage.recordDocumentIndex(payload);
				} catch (error) {
					if (isPublicHttpError(error)) throw error;
					throw publicDocumentIndexError(error);
				}
			},
			resolveDocumentRebind(projectId, proposalId, input) {
				requireRegisteredProject(options.storage, projectId);
				try {
					return options.storage.resolveDocumentRebindProposal(projectId, proposalId, input);
				} catch (error) {
					if (isPublicHttpError(error)) throw error;
					throw publicDocumentIndexError(error);
				}
			},
			listTemplates() {
				try {
					return listTemplateVersions();
				} catch (error) {
					throw publicCreateError(error);
				}
			},
			async prepareCreate(input) {
				authorizeCreateSelection(input, options.selectionSecret, consumedSelections);
				try {
					const template = loadTemplate(input.templateId, input.templateVersion);
					const parentDisplayPath = input.selection.path;
					if (template.layout !== "project-home") throw new TemplateRegistryError("TEMPLATE_RETIRED", "旧单根模板只允许历史回放，不能用于新建项目。");
					if (!sameWindowsPath(parentDisplayPath, projectHomeRoot)) throw projectControlHttpError("PROJECT_HOME_ROOT_REQUIRED", `新项目必须创建在统一项目根 ${projectHomeRoot}。`, 409);
					if (!isProjectHomeSlug(input.directoryName)) throw projectControlHttpError("PROJECT_SLUG_INVALID", "项目目录名必须是稳定的 ASCII kebab-case slug。", 409);
					const targetDisplayPath = win32.join(parentDisplayPath, input.directoryName);
					const workspaceDisplayPath = win32.join(targetDisplayPath, PROJECT_HOME_WORKSPACE_PATH);
					await requireEmptyTarget(targetDisplayPath);
					const projectId = idFactory("prj");
					const commandId = idFactory("cmd");
					const planId = idFactory("pln");
					const createdAt = now();
					const rendered = renderTemplate(template, {
						projectId,
						name: input.name,
						slug: input.directoryName,
						createdAt
					});
					const operations = template.files.map((entry) => entry.kind === "directory" ? {
						kind: "create_directory",
						relativePath: entry.relativePath,
						expectedState: "absent"
					} : {
						kind: "create_file",
						relativePath: entry.relativePath,
						expectedState: "absent",
						contentHash: sha256(rendered.contents.get(entry.relativePath))
					});
					const syncPolicy = "atomic_create";
					const manifestHash = sha256(rendered.contents.get(PROJECT_HOME_MANIFEST_PATH));
					const planHash = computePlanHash({
						manifestHash,
						syncPolicy,
						operations
					});
					const stagingDisplayPath = stagingRootForPlan({
						syncPolicy,
						planId
					}, targetDisplayPath);
					options.storage.createFileSyncPlan({
						planId,
						commandId,
						kind: "create_from_template",
						projectId,
						syncPolicy,
						targetDisplayPath,
						targetNormalizedPath: targetDisplayPath,
						stagingDisplayPath,
						planHash,
						manifestHash,
						operations,
						renderParams: {
							projectId,
							name: input.name,
							directoryName: input.directoryName,
							slug: input.directoryName,
							createdAt,
							templateId: template.templateId,
							templateVersion: template.templateVersion,
							templateLayout: template.layout,
							manifestPath: template.manifestPath,
							projectHomeRoot,
							workspaceDisplayPath
						}
					});
					const refs = options.storage.issueFileSyncPlanRefs(planId, {
						...referenceContext,
						targetDisplayPath,
						locationDisplayPath: workspaceDisplayPath,
						parentDisplayPath,
						ttlSeconds: 300
					});
					const command = signIntakeCommand({
						protocolVersion: "project-control.dsh/v1alpha1",
						schemaVersion: "lifecycle-command-envelope/v1alpha1",
						commandId,
						correlationId: `intake:${planId}`,
						idempotencyKey: `intake.create:${planId}`,
						kind: "project.createFromTemplate",
						occurredAt: createdAt,
						actor: {
							kind: "human",
							id: "desktop-user",
							applicationId: "deepseek-harness-personal",
							displayName: "桌面端用户"
						},
						target: {
							aggregateType: "project",
							projectId
						},
						expectedRevision: 0,
						provenance: {
							sourceType: "human",
							sourceId: "project-console:intake-create",
							applicationVersion: options.applicationVersion,
							applicationInstanceId: options.applicationInstanceId,
							observedAt: createdAt
						},
						payload: {
							sourceRootRef: refs.sourceRootRef,
							targetLocationRef: refs.locationRef,
							directoryName: input.directoryName,
							name: input.name,
							template: {
								templateId: template.templateId,
								templateVersion: template.templateVersion,
								templateHash: template.templateHash
							},
							writePlan: {
								planId,
								planHash,
								manifestHash,
								syncPolicy,
								operations
							}
						},
						extensions: { "cyrus.project-control.intake": { planId } }
					}, options.selectionSecret);
					return {
						template: {
							templateId: template.templateId,
							templateVersion: template.templateVersion,
							displayName: template.displayName,
							templateHash: template.templateHash
						},
						projectId,
						targetDisplayPath,
						directoryName: input.directoryName,
						expiresAt: refs.expiresAt,
						writePlan: {
							planId,
							planHash,
							manifestHash,
							syncPolicy,
							operations
						},
						command
					};
				} catch (error) {
					consumedSelections.delete(input.selection.authorization.nonce);
					throw publicCreateError(error);
				}
			}
		},
		referenceResolver: {
			authorizeStoredReplay(command) {
				return (command.kind === "project.registerLegacy" || command.kind === "project.registerManaged" || command.kind === "project.rebindLocation" || command.kind === "project.createFromTemplate" || command.kind === "project.upgradeManaged") && verifyIntakeCommandSignature(command, options.selectionSecret);
			},
			async resolveRegistration(command) {
				if (command.kind !== "project.registerLegacy" && command.kind !== "project.registerManaged") return null;
				if (!verifyIntakeCommandSignature(command, options.selectionSecret)) return null;
				const payload = command.payload;
				const candidateId = requireCommandCandidate(payload.candidateRef);
				const candidateRevision = commandCandidateRevision(command);
				const candidate = requireCandidate(options.storage, candidateId);
				requireLifecycleCandidateRevision(candidate, candidateRevision);
				if (candidate.status !== "discovered") return null;
				const fresh = await rescanCandidate(options.scanner, candidate);
				if (command.kind === "project.registerLegacy") {
					if (fresh.detectedMode === "managed" || !hostCommandMatches(command, {
						candidateId,
						candidateRevision,
						applicationInstanceId: options.applicationInstanceId,
						applicationVersion: options.applicationVersion,
						projectId: `prj_${candidateId.slice(4)}`,
						kind: "project.registerLegacy",
						expectedRevision: 0
					})) return null;
					verifyCommandDocumentBindings(payload.documentBindings, fresh.documents);
					return {
						location: resolveReferencePair(options.storage, candidateId, payload, referenceContext).location,
						candidateId,
						candidateRevision,
						origin: { kind: "imported" }
					};
				}
				const manifest = requireManagedManifest(fresh);
				if (!hostCommandMatches(command, {
					candidateId,
					candidateRevision,
					applicationInstanceId: options.applicationInstanceId,
					applicationVersion: options.applicationVersion,
					projectId: manifest.projectId,
					kind: "project.registerManaged",
					expectedRevision: 0,
					manifestHash: manifest.hash,
					manifestRelativePath: manifest.relativePath
				}) || payload.manifestHash !== manifest.hash) return null;
				return {
					location: resolveReferencePair(options.storage, candidateId, payload, referenceContext).location,
					candidateId,
					candidateRevision,
					manifestName: manifest.name,
					manifestHash: manifest.hash,
					manifestDocumentBindings: manifest.documentBindings,
					origin: manifest.origin
				};
			},
			async resolveRebind(command) {
				if (command.kind !== "project.rebindLocation") return null;
				if (!verifyIntakeCommandSignature(command, options.selectionSecret)) return null;
				const payload = command.payload;
				const candidateId = commandCandidateIdFromExtensions(command);
				const candidateRevision = commandCandidateRevision(command);
				const candidate = requireCandidate(options.storage, candidateId);
				requireLifecycleCandidateRevision(candidate, candidateRevision);
				if (candidate.status !== "relocation_candidate") return null;
				const fresh = await rescanCandidate(options.scanner, candidate);
				const manifest = requireManagedManifest(fresh);
				const project = requireMatchedProject(options.storage, candidate);
				const expectedIdentityEvidence = rebindIdentityEvidence(project, fresh, manifest);
				if (expectedIdentityEvidence === null || !hostCommandMatches(command, {
					candidateId,
					candidateRevision,
					applicationInstanceId: options.applicationInstanceId,
					applicationVersion: options.applicationVersion,
					projectId: manifest.projectId,
					kind: "project.rebindLocation",
					expectedRevision: project.revision,
					manifestHash: manifest.hash,
					manifestRelativePath: manifest.relativePath
				}) || !rebindIdentityEvidenceMatches(payload.identityEvidence, expectedIdentityEvidence)) return null;
				return {
					newLocation: resolveReferencePair(options.storage, candidateId, {
						locationRef: payload.newLocationRef,
						sourceRootRef: payload.sourceRootRef
					}, referenceContext).location,
					candidateId,
					candidateRevision
				};
			},
			async resolveCreate(command) {
				if (command.kind !== "project.createFromTemplate") return null;
				if (!verifyIntakeCommandSignature(command, options.selectionSecret)) return null;
				const payload = asObject(command.payload);
				const planId = planIdFromExtensions(command);
				let refs;
				try {
					refs = options.storage.resolveFileSyncPlanRefs(planId, {
						locationRef: requireCommandRef(payload?.targetLocationRef, "loc"),
						sourceRootRef: requireCommandRef(payload?.sourceRootRef, "srt")
					}, referenceContext);
				} catch {
					return null;
				}
				const plan = options.storage.getFileSyncPlan(planId);
				if (plan === null || plan.kind !== "create_from_template" || plan.commandId !== command.commandId || plan.projectId !== command.target.projectId || ![
					"planned",
					"rolled_back",
					"files_committed"
				].includes(plan.state) || plan.renderParams === null) return null;
				const renderParams = plan.renderParams;
				if (!hostCreateCommandMatches(command, plan, {
					applicationInstanceId: options.applicationInstanceId,
					applicationVersion: options.applicationVersion
				})) return null;
				const templatePayload = asObject(payload?.template);
				if (templatePayload?.templateId !== renderParams.templateId || templatePayload?.templateVersion !== renderParams.templateVersion) return null;
				const renderSlug = renderParams.slug;
				const renderProjectHomeRoot = renderParams.projectHomeRoot;
				const renderWorkspaceDisplayPath = renderParams.workspaceDisplayPath;
				let template;
				try {
					template = loadTemplate(renderParams.templateId ?? "", renderParams.templateVersion ?? "");
				} catch {
					return null;
				}
				if (template.templateHash !== templatePayload?.templateHash) return null;
				const isProjectHome = template.layout === "project-home";
				if (isProjectHome && (typeof renderSlug !== "string" || typeof renderProjectHomeRoot !== "string" || typeof renderWorkspaceDisplayPath !== "string" || renderParams.templateLayout !== "project-home" || renderParams.manifestPath !== "workspace/.dsh-project/project.yaml" || renderSlug !== renderParams.directoryName || !isProjectHomeSlug(renderSlug) || !sameWindowsPath(renderProjectHomeRoot, projectHomeRoot) || !sameWindowsPath(plan.targetDisplayPath, win32.join(projectHomeRoot, renderSlug)) || !sameWindowsPath(renderWorkspaceDisplayPath, win32.join(plan.targetDisplayPath, "workspace")) || !sameWindowsPath(refs.sourceRoot.displayPath, projectHomeRoot) || !sameWindowsPath(refs.location.displayPath, renderWorkspaceDisplayPath))) return null;
				const writePlanPayload = asObject(payload?.writePlan);
				if (writePlanPayload?.planId !== planId || writePlanPayload?.manifestHash !== plan.manifestHash || writePlanPayload?.syncPolicy !== "atomic_create") return null;
				let operationsValid = false;
				try {
					operationsValid = verifyWritePlanHashes({
						manifestHash: writePlanPayload.manifestHash,
						syncPolicy: "atomic_create",
						operations: writePlanPayload.operations,
						planHash: writePlanPayload.planHash
					});
				} catch {
					operationsValid = false;
				}
				if (!operationsValid) return null;
				let rendered;
				try {
					rendered = renderTemplate(template, {
						projectId: plan.projectId,
						name: renderParams.name ?? "",
						...isProjectHome ? { slug: renderParams.slug ?? "" } : {},
						createdAt: renderParams.createdAt ?? ""
					});
				} catch {
					return null;
				}
				const manifestHash = sha256(rendered.contents.get(template.manifestPath));
				if (manifestHash !== plan.manifestHash) return null;
				for (const operation of writePlanPayload.operations) {
					if (operation.kind !== "create_file") continue;
					const content = rendered.contents.get(String(operation.relativePath));
					if (content === void 0 || sha256(content) !== operation.contentHash) return null;
				}
				const manifestObject = rendered.manifestObject;
				const manifestDocumentBindings = manifestObject.spec.documents.entries.map((entry) => ({
					role: entry.role,
					relativePath: entry.path,
					contentHash: null,
					required: entry.required === true
				}));
				return {
					plan,
					refs,
					template: {
						templateId: template.templateId,
						templateVersion: template.templateVersion,
						templateHash: template.templateHash
					},
					contents: rendered.contents,
					manifestName: manifestObject.metadata.name,
					manifestHash,
					manifestDocumentBindings
				};
			},
			async resolveUpgrade(command) {
				if (command.kind !== "project.upgradeManaged") return null;
				if (!verifyIntakeCommandSignature(command, options.selectionSecret)) return null;
				const payload = asObject(command.payload);
				const planId = planIdFromExtensions(command);
				const plan = options.storage.getFileSyncPlan(planId);
				if (plan === null || plan.kind !== "upgrade_managed" || plan.commandId !== command.commandId || plan.projectId !== command.target.projectId || ![
					"planned",
					"rolled_back",
					"files_committed"
				].includes(plan.state) || plan.renderParams === null) return null;
				const renderParams = plan.renderParams;
				if (!hostUpgradeCommandMatches(command, plan, renderParams, {
					applicationInstanceId: options.applicationInstanceId,
					applicationVersion: options.applicationVersion
				})) return null;
				const writePlanPayload = asObject(payload?.writePlan);
				if (writePlanPayload?.planId !== planId || writePlanPayload?.manifestHash !== plan.manifestHash || writePlanPayload?.syncPolicy !== "atomic_additive") return null;
				try {
					verifyWritePlanHashes({
						manifestHash: plan.manifestHash,
						syncPolicy: "atomic_additive",
						operations: writePlanPayload.operations,
						planHash: writePlanPayload.planHash
					});
				} catch {
					return null;
				}
				const project = options.storage.getProject(plan.projectId);
				if (project === null || project.mode !== "linked_legacy") return null;
				if (project.revision !== renderParams.expectedRevision) throw new FileSyncPlanError("WRITE_PLAN_STALE", "项目在准备后发生了变化，请刷新后重新准备升级。", { currentRevision: project.revision });
				const bindings = (project.documentBindings ?? []).map((binding) => ({
					role: binding.role,
					relativePath: binding.relativePath,
					contentHash: binding.contentHash
				})).sort((left, right) => {
					const leftKey = `${left.role}\u0000${left.relativePath}`;
					const rightKey = `${right.role}\u0000${right.relativePath}`;
					return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
				});
				const fingerprintHash = sha256(Buffer.from(canonicalJson({
					projectId: plan.projectId,
					documentBindings: bindings
				}), "utf8"));
				if (fingerprintHash !== payload?.legacyFingerprintHash || fingerprintHash !== renderParams.fingerprintHash) throw new FileSyncPlanError("WRITE_PLAN_STALE", "项目文档绑定在准备后发生了变化，请刷新后重新准备升级。", { currentRevision: project.revision });
				const activeLocation = project.workspaceLocations?.find((location) => location.isActive);
				if (activeLocation === void 0) return null;
				for (const binding of bindings) {
					let bytes;
					try {
						bytes = await readFile(win32.join(activeLocation.displayPath, ...binding.relativePath.split("/")));
					} catch {
						throw new FileSyncPlanError("WRITE_PLAN_STALE", "至少一份项目文档当前无法读取，请刷新后重新准备升级。", { currentRevision: project.revision });
					}
					if (sha256(bytes) !== binding.contentHash) throw new FileSyncPlanError("WRITE_PLAN_STALE", "至少一份项目文档在准备后发生了变化，请刷新后重新准备升级。", { currentRevision: project.revision });
				}
				const manifestYaml = buildUpgradeManifestYaml({
					projectId: plan.projectId,
					name: renderParams.name,
					createdAt: renderParams.createdAt,
					documentBindings: renderParams.documentBindings
				});
				const manifestBytes = Buffer.from(manifestYaml, "utf8");
				if (sha256(manifestBytes) !== plan.manifestHash) return null;
				let refs;
				try {
					refs = options.storage.resolveUpgradePlanRefs(planId, { locationRef: requireCommandRef(payload?.locationRef, "loc") }, referenceContext);
				} catch {
					return null;
				}
				return {
					plan,
					refs,
					contents: new Map([[".dsh-project/project.yaml", manifestBytes]]),
					manifestName: renderParams.name,
					manifestHash: plan.manifestHash,
					fingerprintHash
				};
			}
		}
	};
}
function buildUpgradeManifestYaml(options) {
	return `${[
		"apiVersion: project-control.dsh/v1alpha1",
		"kind: ProjectManifest",
		"metadata:",
		`  projectId: ${options.projectId}`,
		`  name: ${JSON.stringify(options.name)}`,
		`  createdAt: ${options.createdAt}`,
		"  createdBy:",
		"    kind: human",
		"    id: cyrus",
		"  origin:",
		"    kind: imported",
		"spec:",
		"  documents:",
		"    docsRoot: .",
		"    entries:",
		...options.documentBindings.flatMap((binding) => [
			`      - role: ${binding.role}`,
			`        path: ${binding.relativePath}`,
			...binding.required ? ["        required: true"] : []
		]),
		"    standardOutputs:",
		"      updatesRoot: .dsh-project/updates",
		"      decisionsRoot: .dsh-project/decisions",
		"      artifactsRoot: .dsh-project/artifacts"
	].join("\n")}\n`;
}
function hostUpgradeCommandMatches(command, plan, renderParams, expected) {
	const commandObject = asObject(command);
	if (commandObject === null) return false;
	const actor = asObject(commandObject.actor);
	const provenance = asObject(commandObject.provenance);
	const target = asObject(commandObject.target);
	const payload = asObject(commandObject.payload);
	return commandObject.commandId === plan.commandId && commandObject.correlationId === `intake:${plan.planId}` && commandObject.idempotencyKey === `intake.upgrade:${plan.planId}` && commandObject.kind === "project.upgradeManaged" && commandObject.expectedRevision === renderParams.expectedRevision && actor?.kind === "human" && actor.id === "desktop-user" && actor.applicationId === "deepseek-harness-personal" && target?.aggregateType === "project" && target.projectId === plan.projectId && provenance?.applicationInstanceId === expected.applicationInstanceId && provenance.applicationVersion === expected.applicationVersion && provenance.sourceType === "human" && provenance.sourceId === "project-console:intake-upgrade" && payload?.locationRef === renderParams.locationRef && payload?.locationRevision === renderParams.locationRevision && payload?.legacyFingerprintHash === renderParams.fingerprintHash;
}
function sha256(bytes) {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function authorizeCreateSelection(input, secret, consumed) {
	const nowMs = Date.now();
	for (const [nonce, expiresAt] of consumed) if (expiresAt < nowMs) consumed.delete(nonce);
	if (consumed.has(input.selection.authorization.nonce) || !verifyProjectControlSelectionTicket({
		kind: "create-parent",
		path: input.selection.path,
		authorization: input.selection.authorization,
		secret,
		nowMs
	})) throw projectControlHttpError("DIRECTORY_SELECTION_REQUIRED", "请重新使用系统目录选择器选择新建项目的父目录。", 403);
	consumed.set(input.selection.authorization.nonce, Date.parse(input.selection.authorization.expiresAt));
}
async function requireEmptyTarget(targetDisplayPath) {
	let info;
	try {
		info = await stat(targetDisplayPath);
	} catch (error) {
		if (error?.code === "ENOENT") return;
		throw error;
	}
	if (!info.isDirectory()) throw projectControlHttpError("TARGET_NOT_EMPTY", "目标路径已被非目录内容占用。", 409);
	if ((await readdir(targetDisplayPath)).length > 0) throw projectControlHttpError("TARGET_NOT_EMPTY", "目标目录已存在且非空，请选择其他名称或空目录。", 409);
}
function hostCreateCommandMatches(command, plan, expected) {
	const commandObject = asObject(command);
	if (commandObject === null || plan.renderParams === null) return false;
	const actor = asObject(commandObject.actor);
	const provenance = asObject(commandObject.provenance);
	const target = asObject(commandObject.target);
	const payload = asObject(commandObject.payload);
	return commandObject.commandId === plan.commandId && commandObject.correlationId === `intake:${plan.planId}` && commandObject.idempotencyKey === `intake.create:${plan.planId}` && commandObject.kind === "project.createFromTemplate" && commandObject.expectedRevision === 0 && actor?.kind === "human" && actor.id === "desktop-user" && actor.applicationId === "deepseek-harness-personal" && target?.aggregateType === "project" && target.projectId === plan.projectId && provenance?.applicationInstanceId === expected.applicationInstanceId && provenance.applicationVersion === expected.applicationVersion && provenance.sourceType === "human" && provenance.sourceId === "project-console:intake-create" && payload?.directoryName === plan.renderParams.directoryName && payload?.name === plan.renderParams.name;
}
function planIdFromExtensions(command) {
	const commandObject = asObject(command);
	const intake = asObject(asObject(commandObject?.extensions)?.["cyrus.project-control.intake"]);
	const planId = typeof intake?.planId === "string" ? intake.planId : `pln_${String(commandObject?.commandId ?? "").slice(4)}`;
	if (!/^pln_[0-9a-f-]{36}$/u.test(planId)) throw projectControlHttpError("REFERENCE_UNRESOLVED", "写入计划引用无法解析。", 409);
	return planId;
}
function publicCreateError(error) {
	if (isPublicHttpError(error)) return error;
	if (error instanceof TemplateRegistryError) {
		if (error.code === "TEMPLATE_NOT_FOUND") return projectControlHttpError("TEMPLATE_NOT_FOUND", "所选模板不存在或不可用。", 404);
		return projectControlHttpError("TEMPLATE_UNAVAILABLE", "所选模板当前不可用。", 409);
	}
	switch (asObject(error instanceof Error ? error.details : void 0)?.reason) {
		case "plan_id_conflict": return projectControlHttpError("PLAN_CONFLICT", "写入计划已存在，请重新准备。", 409);
		case "plan_not_issuable":
		case "plan_not_found":
		case "plan_kind_mismatch":
		case "target_outside_parent": return projectControlHttpError("PLAN_PREPARE_FAILED", "写入计划无法签发，请重新选择父目录。", 409);
		default: return projectControlHttpError("INTAKE_OPERATION_FAILED", "新建项目准备失败。", 409);
	}
}
function authorizeSelection(input, secret, consumed) {
	const nowMs = Date.now();
	for (const [nonce, expiresAt] of consumed) if (expiresAt < nowMs) consumed.delete(nonce);
	if (consumed.has(input.selection.authorization.nonce) || !verifyProjectControlSelectionTicket({
		kind: input.mode,
		path: input.selection.path,
		authorization: input.selection.authorization,
		secret,
		nowMs
	})) throw projectControlHttpError("DIRECTORY_SELECTION_REQUIRED", "请重新使用系统目录选择器选择要扫描的目录。", 403);
	consumed.set(input.selection.authorization.nonce, Date.parse(input.selection.authorization.expiresAt));
}
async function annotateKnownProjects(scan, storage) {
	return {
		...scan,
		candidates: await Promise.all(scan.candidates.map((candidate) => annotateKnownProject(candidate, storage)))
	};
}
async function annotateKnownProject(candidate, storage) {
	if (candidate.manifestProjectId === null || candidate.manifestProjectId === void 0) return candidate;
	const project = storage.getProject(candidate.manifestProjectId);
	if (project === null) return candidate;
	const activeLocations = project.workspaceLocations?.filter((location) => location.isActive) ?? [];
	const sameLocation = activeLocations.some((location) => location.isActive && sameWindowsPath(location.normalizedPath, candidate.root.normalizedPath ?? candidate.root.displayPath));
	const oldLocationAccessible = !sameLocation && (await Promise.all(activeLocations.map((location) => isAccessibleDirectory(location.displayPath)))).some(Boolean);
	const isRelocation = !sameLocation && !oldLocationAccessible && activeLocations.length > 0;
	return {
		...candidate,
		status: isRelocation ? "relocation_candidate" : "conflict",
		issues: [...candidate.issues, {
			code: sameLocation ? "PROJECT_ALREADY_REGISTERED" : oldLocationAccessible ? "DUPLICATE_MANAGED_PROJECT" : "PROJECT_LOCATION_CHANGED",
			severity: isRelocation ? "info" : "blocking",
			details: { message: sameLocation ? "这个受管理项目已经登记在相同位置。" : oldLocationAccessible ? "检测到同一受管理项目的两个可访问位置；请先确认哪一份是主项目。" : "检测到同一受管理项目的新位置；确认后将重新绑定。" }
		}]
	};
}
async function rescanCandidate(scanner, candidate) {
	let scan;
	try {
		scan = requireScanEnvelope(await scanner.scanProjectDirectory(candidate.root.displayPath));
	} catch (error) {
		throw projectControlHttpError("CANDIDATE_RESCAN_FAILED", "项目文件当前无法重新核对；没有执行登记。", 409);
	}
	const fresh = scan.candidates[0];
	if (scan.mode !== "single_project" || fresh === void 0 || scan.candidates.length !== 1 || !sameWindowsPath(fresh.root.normalizedPath ?? fresh.root.displayPath, candidate.root.normalizedPath)) throw projectControlHttpError("CANDIDATE_CHANGED", "项目目录身份已经变化，请重新扫描。", 409);
	return fresh;
}
function verifyPreparation(persisted, fresh, input) {
	const managed = fresh.detectedMode === "managed";
	if (input.registrationMode === "managed" !== managed) throw projectControlHttpError("MODE_CONFLICT", "项目模式与最新扫描结果不一致，请重新扫描。", 409);
	if (persisted.detectedMode !== fresh.detectedMode) throw projectControlHttpError("CANDIDATE_CHANGED", "项目识别结果已经变化，请重新扫描。", 409);
	if (managed) {
		const manifest = requireManagedManifest(fresh);
		if (input.documentBindings.length !== 0) throw projectControlHttpError("MANAGED_BINDINGS_LOCKED", "受管理项目的文档映射由 manifest 锁定，不能在候选确认时重映射。", 409);
		if (persisted.manifestProjectId !== manifest.projectId) throw projectControlHttpError("MANIFEST_CHANGED", "项目 manifest 身份已经变化，请重新扫描。", 409);
		return;
	}
	verifyCommandDocumentBindings(input.documentBindings, fresh.documents);
}
function verifyCommandDocumentBindings(value, freshDocuments) {
	if (!Array.isArray(value)) throw projectControlHttpError("DOCUMENT_MAPPING_INVALID", "文档映射无效。", 409);
	const freshByPath = new Map(freshDocuments.map((document) => [document.relativePath, document]));
	for (const raw of value) {
		const binding = asObject(raw);
		const relativePath = typeof binding?.relativePath === "string" ? binding.relativePath : "";
		const contentHash = typeof binding?.contentHash === "string" ? binding.contentHash : "";
		const fresh = freshByPath.get(relativePath);
		if (fresh === void 0 || fresh.sha256 !== contentHash) throw projectControlHttpError("DOCUMENT_CHANGED", "至少一份已选择文档在确认前发生了变化，请重新扫描。", 409);
	}
}
function buildLifecycleCommand(options) {
	const suffix = options.candidate.candidateId.slice(4);
	const isRelocation = options.project !== null;
	const manifest = options.fresh.detectedMode === "managed" ? requireManagedManifest(options.fresh) : null;
	const projectId = isRelocation ? options.project.projectId : manifest?.projectId ?? `prj_${suffix}`;
	const common = {
		protocolVersion: "project-control.dsh/v1alpha1",
		schemaVersion: "lifecycle-command-envelope/v1alpha1",
		commandId: `cmd_${suffix}`,
		correlationId: `intake:${options.candidate.candidateId}`,
		idempotencyKey: `intake.register:${options.candidate.candidateId}:r${String(options.input.expectedRevision)}`,
		occurredAt: options.occurredAt,
		actor: {
			kind: "human",
			id: "desktop-user",
			applicationId: "deepseek-harness-personal",
			displayName: "桌面端用户"
		},
		target: {
			aggregateType: "project",
			projectId
		},
		provenance: {
			sourceType: manifest === null ? "human" : "imported_document",
			sourceId: manifest === null ? "project-console:intake-confirmation" : `manifest:${manifest.relativePath}`,
			applicationVersion: options.applicationVersion,
			applicationInstanceId: options.applicationInstanceId,
			...manifest === null ? {} : { contentHash: manifest.hash },
			observedAt: options.occurredAt
		},
		extensions: { "cyrus.project-control.intake": {
			candidateId: options.candidate.candidateId,
			candidateRevision: options.input.expectedRevision
		} }
	};
	if (isRelocation) {
		if (manifest === null || options.project === null) throw projectControlHttpError("IDENTITY_EVIDENCE_REQUIRED", "新位置必须提供可验证的受管理项目 manifest。", 409);
		const activeLocation = options.project.workspaceLocations?.find((location) => location.isActive);
		if (activeLocation === void 0) throw projectControlHttpError("REFERENCE_UNRESOLVED", "项目当前没有可核对的活动位置。", 409);
		const identityEvidence = rebindIdentityEvidence(options.project, options.fresh, manifest);
		if (identityEvidence === null) throw projectControlHttpError("IDENTITY_EVIDENCE_REQUIRED", "新位置没有任何文档与已登记项目的内容哈希一致，不能自动重新绑定。", 409);
		return {
			...common,
			kind: "project.rebindLocation",
			expectedRevision: options.project.revision,
			payload: {
				expectedMode: options.project.mode,
				currentLocationRef: activeLocation.locationId,
				currentLocationRevision: activeLocation.revision,
				newLocationRef: options.refs.locationRef,
				sourceRootRef: options.refs.sourceRootRef,
				reason: "moved",
				identityEvidence
			}
		};
	}
	if (manifest !== null) return {
		...common,
		kind: "project.registerManaged",
		expectedRevision: 0,
		payload: {
			locationRef: options.refs.locationRef,
			sourceRootRef: options.refs.sourceRootRef,
			candidateRef: options.refs.candidateRef,
			manifestHash: manifest.hash
		}
	};
	return {
		...common,
		kind: "project.registerLegacy",
		expectedRevision: 0,
		payload: {
			locationRef: options.refs.locationRef,
			sourceRootRef: options.refs.sourceRootRef,
			candidateRef: options.refs.candidateRef,
			name: options.input.name,
			documentBindings: options.input.documentBindings
		}
	};
}
function rebindIdentityEvidence(project, fresh, manifest) {
	if (project.mode === "managed") return {
		kind: "managed_manifest",
		manifestHash: manifest.hash
	};
	const bindings = (project.documentBindings ?? []).map((binding) => ({
		role: binding.role,
		relativePath: binding.relativePath,
		contentHash: binding.contentHash
	})).sort((left, right) => {
		const leftKey = `${left.role}\u0000${left.relativePath}`;
		const rightKey = `${right.role}\u0000${right.relativePath}`;
		return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
	});
	const freshHashes = new Set(fresh.documents.flatMap((document) => typeof document.sha256 === "string" ? [document.sha256] : []));
	const contentHashes = [...new Set(bindings.flatMap((binding) => typeof binding.contentHash === "string" && freshHashes.has(binding.contentHash) ? [binding.contentHash] : []))].sort().slice(0, 50);
	if (contentHashes.length === 0) return null;
	return {
		kind: "legacy_fingerprint",
		fingerprintHash: sha256(Buffer.from(canonicalJson({
			projectId: project.projectId,
			documentBindings: bindings
		}), "utf8")),
		contentHashes
	};
}
function rebindIdentityEvidenceMatches(value, expected) {
	const actual = asObject(value);
	if (actual?.kind !== expected.kind) return false;
	if (expected.kind === "managed_manifest") return actual.manifestHash === expected.manifestHash;
	return actual.fingerprintHash === expected.fingerprintHash && Array.isArray(actual.contentHashes) && actual.contentHashes.length === expected.contentHashes.length && actual.contentHashes.every((hash, index) => hash === expected.contentHashes[index]);
}
function requireManagedManifest(candidate) {
	const candidateObject = asObject(candidate);
	const manifest = asObject(asObject(candidate.confidence)?.manifest);
	const projectId = typeof manifest?.projectId === "string" ? manifest.projectId : candidate.manifestProjectId;
	const hash = typeof manifest?.hash === "string" ? manifest.hash : typeof manifest?.manifestHash === "string" ? manifest.manifestHash : typeof candidateObject?.manifestHash === "string" ? candidateObject.manifestHash : void 0;
	const name = typeof manifest?.name === "string" ? manifest.name : typeof candidateObject?.manifestName === "string" ? candidateObject.manifestName : candidate.suggestedName;
	const relativePath = typeof manifest?.relativePath === "string" ? manifest.relativePath : ".dsh-project/project.json";
	const manifestBindings = Array.isArray(manifest?.documentBindings) ? manifest.documentBindings : Array.isArray(candidateObject?.manifestDocumentBindings) ? candidateObject.manifestDocumentBindings : [];
	const bindings = manifestBindings.length > 0 ? manifestBindings.map((raw, index) => {
		const binding = asObject(raw);
		const required = binding?.required === true;
		const contentHash = typeof binding?.contentHash === "string" ? binding.contentHash : binding?.contentHash === null ? null : void 0;
		if (typeof binding?.role !== "string" || !DOCUMENT_ROLES.has(binding.role) || typeof binding.relativePath !== "string" || binding.required !== void 0 && typeof binding.required !== "boolean" || typeof contentHash === "string" && !/^sha256:[0-9a-f]{64}$/u.test(contentHash)) throw projectControlHttpError("MANIFEST_INVALID", `受管理项目 manifest 的第 ${String(index + 1)} 个文档映射无效。`, 409);
		if (contentHash === void 0 || contentHash === null) {
			if (required) throw projectControlHttpError("MANIFEST_REQUIRED_DOCUMENT_UNAVAILABLE", `受管理项目 manifest 的必需文档 ${binding.relativePath} 当前不可用。`, 409);
			return {
				role: binding.role,
				relativePath: binding.relativePath,
				contentHash: null,
				...binding.required === void 0 ? {} : { required: binding.required }
			};
		}
		return {
			role: binding.role,
			relativePath: binding.relativePath,
			contentHash,
			...binding.required === void 0 ? {} : { required: binding.required }
		};
	}) : [];
	if (typeof projectId !== "string" || !/^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(projectId) || typeof hash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(hash) || typeof name !== "string" || name.trim() === "") throw projectControlHttpError("MANIFEST_INVALID", "受管理项目 manifest 缺少可验证身份。", 409);
	const originValue = asObject(manifest?.origin ?? candidateObject?.manifestOrigin);
	const originKind = originValue?.kind;
	return {
		projectId,
		hash,
		name,
		relativePath,
		documentBindings: bindings,
		origin: originKind === "template" || originKind === "fork" ? {
			kind: originKind,
			...typeof originValue?.templateId === "string" ? { templateId: originValue.templateId } : {},
			...typeof originValue?.templateVersion === "string" ? { templateVersion: originValue.templateVersion } : {},
			...typeof originValue?.forkedFromProjectId === "string" ? { forkedFromProjectId: originValue.forkedFromProjectId } : {}
		} : { kind: "imported" }
	};
}
function requireRegisteredProject(storage, projectId) {
	if (!/^prj_[0-9a-f-]{36}$/u.test(projectId)) throw projectControlHttpError("PROJECT_NOT_FOUND", "项目不存在。", 404);
	const project = storage.getProject(projectId);
	if (project === null) throw projectControlHttpError("PROJECT_NOT_FOUND", "项目不存在。", 404);
	return project;
}
function publicDocumentIndexError(error) {
	if (isPublicHttpError(error)) return error;
	switch (asObject(error instanceof Error ? error.details : void 0)?.reason) {
		case "project_not_found": return projectControlHttpError("PROJECT_NOT_FOUND", "项目不存在。", 404);
		case "proposal_not_found": return projectControlHttpError("REBIND_PROPOSAL_NOT_FOUND", "重绑提案不存在。", 404);
		case "proposal_not_proposed": return projectControlHttpError("REBIND_PROPOSAL_NOT_OPEN", "重绑提案已处理，请刷新。", 409);
		case "proposal_changed": return projectControlHttpError("REBIND_PROPOSAL_CHANGED", "重绑提案已经变化，请刷新后重新确认。", 409);
		case "proposal_candidate_mismatch":
		case "proposal_candidate_invalid": return projectControlHttpError("REBIND_CANDIDATE_INVALID", "选择的重绑目标与提案不符。", 409);
		case "proposal_candidate_required": return projectControlHttpError("REBIND_AMBIGUOUS", "重绑目标有歧义，必须人工选择其中一个路径。", 409);
		case "managed_manifest_authoritative": return projectControlHttpError("MANAGED_MANIFEST_AUTHORITATIVE", "受管理项目的文档映射以 manifest 为准，请先更新 manifest。", 409);
		case "binding_not_found": return projectControlHttpError("REBIND_BINDING_MISSING", "原文档绑定已不存在，请刷新。", 409);
		case "binding_conflict": return projectControlHttpError("REBIND_BINDING_CONFLICT", "重绑目标已经是已绑定文档路径。", 409);
		default: return projectControlHttpError("DOCUMENT_INDEX_OPERATION_FAILED", "文档索引操作失败。", 409);
	}
}
function requireCandidate(storage, candidateId) {
	const candidate = storage.getImportCandidate(candidateId);
	if (candidate === null) throw projectControlHttpError("CANDIDATE_NOT_FOUND", "项目候选不存在。", 404);
	return candidate;
}
function requireCandidateRevision(candidate, revision) {
	if (candidate.revision !== revision) throw projectControlHttpError("CANDIDATE_REVISION_CONFLICT", "候选已经变化，请刷新后重新确认。", 409);
}
function requireLifecycleCandidateRevision(candidate, revision) {
	if (candidate.revision !== revision) throw projectControlHttpError("REVISION_CONFLICT", "候选已经变化，请刷新后重新确认。", 409);
}
function requireMatchedProject(storage, candidate) {
	const project = candidate.manifestProjectId === null ? null : storage.getProject(candidate.manifestProjectId);
	if (project === null) throw projectControlHttpError("REFERENCE_UNRESOLVED", "找不到候选对应的已登记项目。", 409);
	return project;
}
function requireCommandCandidate(value) {
	if (typeof value !== "string" || !/^can_[0-9a-f-]{36}$/u.test(value)) throw projectControlHttpError("REFERENCE_UNRESOLVED", "项目候选引用无法解析。", 409);
	return value;
}
function requireCommandRef(value, prefix) {
	if (typeof value !== "string" || !new RegExp(`^${prefix}_[0-9a-f-]{36}$`, "u").test(value)) throw projectControlHttpError("REFERENCE_UNRESOLVED", "项目位置引用无法解析。", 409);
	return value;
}
function resolveReferencePair(storage, candidateId, payload, referenceContext) {
	try {
		return storage.resolveRegistrationRefs(candidateId, {
			locationRef: requireCommandRef(payload.locationRef, "loc"),
			sourceRootRef: requireCommandRef(payload.sourceRootRef, "srt")
		}, referenceContext);
	} catch {
		throw projectControlHttpError("REFERENCE_UNRESOLVED", "项目位置引用已失效，请重新确认候选。", 409);
	}
}
function hostCommandMatches(command, expected) {
	const commandObject = asObject(command);
	if (commandObject === null) return false;
	const suffix = expected.candidateId.slice(4);
	const actor = asObject(commandObject.actor);
	const provenance = asObject(commandObject.provenance);
	const target = asObject(commandObject.target);
	return commandObject.commandId === `cmd_${suffix}` && commandObject.correlationId === `intake:${expected.candidateId}` && commandObject.idempotencyKey === `intake.register:${expected.candidateId}:r${String(expected.candidateRevision)}` && commandObject.kind === expected.kind && commandObject.expectedRevision === expected.expectedRevision && actor?.kind === "human" && actor.id === "desktop-user" && actor.applicationId === "deepseek-harness-personal" && target?.aggregateType === "project" && target.projectId === expected.projectId && provenance?.applicationInstanceId === expected.applicationInstanceId && provenance.applicationVersion === expected.applicationVersion && provenance.sourceType === (expected.manifestHash === void 0 ? "human" : "imported_document") && provenance.sourceId === (expected.manifestRelativePath === void 0 ? "project-console:intake-confirmation" : `manifest:${expected.manifestRelativePath}`) && (expected.manifestHash === void 0 || provenance.contentHash === expected.manifestHash) && commandCandidateRevision(command) === expected.candidateRevision && commandCandidateIdFromExtensions(command) === expected.candidateId;
}
function signIntakeCommand(command, secret) {
	const extensions = asObject(command.extensions) ?? {};
	const intake = asObject(extensions["cyrus.project-control.intake"]) ?? {};
	const unsigned = {
		...command,
		extensions: {
			...extensions,
			"cyrus.project-control.intake": { ...intake }
		}
	};
	const signature = intakeCommandSignature(unsigned, secret);
	return {
		...unsigned,
		extensions: {
			...unsigned.extensions,
			"cyrus.project-control.intake": {
				...intake,
				commandSignature: signature
			}
		}
	};
}
function verifyIntakeCommandSignature(command, secret) {
	try {
		const commandObject = asObject(command);
		const extensions = asObject(commandObject?.extensions);
		const intake = asObject(extensions?.["cyrus.project-control.intake"]);
		const signature = intake?.commandSignature;
		if (commandObject === null || extensions === null || intake === null || typeof signature !== "string" || signature.length !== 43) return false;
		const { commandSignature: _signature, ...unsignedIntake } = intake;
		const expected = intakeCommandSignature({
			...commandObject,
			extensions: {
				...extensions,
				"cyrus.project-control.intake": unsignedIntake
			}
		}, secret);
		const actualBytes = Buffer.from(signature, "utf8");
		const expectedBytes = Buffer.from(expected, "utf8");
		return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
	} catch {
		return false;
	}
}
function intakeCommandSignature(command, secret) {
	return createHmac("sha256", secret).update(canonicalCommandJson(command), "utf8").digest("base64url");
}
function canonicalCommandJson(value) {
	return JSON.stringify(canonicalCommandValue(value));
}
function canonicalCommandValue(value) {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("Command contains a non-finite number.");
		return Object.is(value, -0) ? 0 : value;
	}
	if (Array.isArray(value)) return value.map(canonicalCommandValue);
	if (typeof value !== "object") throw new TypeError("Command is not lossless JSON.");
	return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en")).map(([key, child]) => {
		if (child === void 0 || typeof child === "function" || typeof child === "symbol") throw new TypeError("Command is not lossless JSON.");
		return [key, canonicalCommandValue(child)];
	}));
}
function commandCandidateIdFromExtensions(command) {
	const commandObject = asObject(command);
	const intake = asObject(asObject(commandObject?.extensions)?.["cyrus.project-control.intake"]);
	return requireCommandCandidate(typeof intake?.candidateId === "string" ? intake.candidateId : `can_${String(commandObject?.commandId).slice(4)}`);
}
function commandCandidateRevision(command) {
	const revision = asObject(asObject(asObject(command)?.extensions)?.["cyrus.project-control.intake"])?.candidateRevision;
	if (!Number.isSafeInteger(revision) || revision < 1) throw projectControlHttpError("REFERENCE_UNRESOLVED", "候选修订引用无法解析。", 409);
	return revision;
}
function publicIntakeError(error) {
	if (isPublicHttpError(error)) return error;
	switch (asObject(error instanceof Error ? error.details : void 0)?.reason) {
		case "candidate_not_found": return projectControlHttpError("CANDIDATE_NOT_FOUND", "项目候选不存在。", 404);
		case "revision_conflict": return projectControlHttpError("CANDIDATE_REVISION_CONFLICT", "候选已经变化，请刷新后重试。", 409);
		case "candidate_not_issuable":
		case "candidate_already_imported": return projectControlHttpError("CANDIDATE_NOT_READY", "这个项目候选当前不能执行该操作。", 409);
		default: return projectControlHttpError("INTAKE_OPERATION_FAILED", "项目扫描或候选操作失败。", 409);
	}
}
function isPublicHttpError(error) {
	return error instanceof Error && error.expose === true;
}
function sameWindowsPath(left, right) {
	const key = (value) => win32.normalize(value.replaceAll("/", "\\")).normalize("NFC").toLocaleLowerCase("en-US");
	return key(left) === key(right);
}
async function isAccessibleDirectory(path) {
	try {
		return (await stat(path)).isDirectory();
	} catch (error) {
		const code = error?.code;
		return code !== "ENOENT" && code !== "ENOTDIR";
	}
}
function asObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function requireScanEnvelope(value) {
	const candidate = asObject(value);
	if (candidate === null || !["source_root", "single_project"].includes(String(candidate.mode)) || asObject(candidate.rootPath) === null || !Array.isArray(candidate.candidates)) throw projectControlHttpError("SCAN_RESULT_INVALID", "扫描器返回了无法识别的结果。", 409);
	return candidate;
}
const DOCUMENT_ROLES = new Set([
	"readme",
	"prd",
	"devlog",
	"progress",
	"next",
	"current_architecture",
	"decision",
	"other"
]);
//#endregion
//#region src/updates-renderer.js
const SCHEMA_VERSION = "progress-update-frontmatter/v1alpha1";
const PROTOCOL_VERSION = "project-control.dsh/v1alpha1";
const RENDERER_VERSION = "progress-markdown/v1alpha1";
const CATEGORY_BY_KIND = Object.freeze({
	progress: "progress",
	blocker: "blocker",
	completion_declared: "completion_declared"
});
function yamlScalar(value) {
	return JSON.stringify(value);
}
function yamlMap(lines, indent, entries) {
	const prefix = " ".repeat(indent);
	for (const [key, value] of entries) if (Array.isArray(value)) if (value.length === 0) lines.push(prefix + key + ": []");
	else {
		lines.push(prefix + key + ":");
		yamlSequence(lines, indent + 2, value);
	}
	else if (value !== null && typeof value === "object") {
		lines.push(prefix + key + ":");
		yamlMap(lines, indent + 2, Object.entries(value));
	} else lines.push(prefix + key + ": " + yamlScalar(value));
}
function yamlSequence(lines, indent, items) {
	const prefix = " ".repeat(indent);
	for (const item of items) if (item !== null && typeof item === "object") {
		lines.push(prefix + "-");
		yamlMap(lines, indent + 2, Object.entries(item));
	} else lines.push(prefix + "- " + yamlScalar(item));
}
function evidenceEntry(evidence) {
	const entry = { kind: evidence.kind };
	if (evidence.kind === "workspace_file") {
		entry.workspaceRef = evidence.workspaceRef;
		entry.relativePath = evidence.relativePath;
	} else entry.ref = evidence.ref;
	if (evidence.contentHash !== void 0) entry.contentHash = evidence.contentHash;
	return entry;
}
/**
* Render one accepted external update into the frozen standard log format.
* @param {{
*   update: {
*     progressUpdateId: string, projectId: string, workItemId: string | null,
*     runId: string | null, kind: 'progress' | 'blocker' | 'completion_declared',
*     summary: string, needs?: string[], acceptanceClaims?: string[],
*     evidence?: unknown[], completionPercent?: number | null,
*     details?: string | null, threadId?: string | null,
*     aggregateRevision: number, commandId: string,
*   },
*   eventId: string,
*   actor: { kind: string, id: string, applicationId: string, displayName?: string },
*   occurredAt: string,
*   recordedAt: string,
*   generatedBy: { applicationId: string, applicationVersion: string, applicationInstanceId: string },
* }} options
* @returns {{ frontmatter: Record<string, unknown>, markdown: string, relativePath: string }}
*/
function renderProgressUpdate(options) {
	const { update, eventId, actor, occurredAt, recordedAt, generatedBy } = options;
	const occurred = new Date(occurredAt);
	const stamp = occurred.toISOString().replaceAll(/[-:.]/g, "").slice(0, 15) + "Z";
	const relativePath = [
		".dsh-project",
		"updates",
		String(occurred.getUTCFullYear()).padStart(4, "0"),
		String(occurred.getUTCMonth() + 1).padStart(2, "0"),
		stamp + "-" + update.progressUpdateId + ".md"
	].join("/");
	const frontmatter = {
		protocolVersion: PROTOCOL_VERSION,
		schemaVersion: SCHEMA_VERSION,
		kind: "ProgressUpdate",
		updateId: update.progressUpdateId,
		category: CATEGORY_BY_KIND[update.kind],
		projectId: update.projectId,
		workItemId: update.workItemId ?? null,
		runId: update.runId ?? null,
		threadId: update.threadId ?? null,
		sourceEventId: eventId,
		commandId: update.commandId,
		aggregateRevision: update.aggregateRevision,
		occurredAt,
		recordedAt,
		actor: {
			kind: actor.kind,
			id: actor.id,
			applicationId: actor.applicationId,
			...actor.displayName === void 0 ? {} : { displayName: actor.displayName }
		},
		summary: update.summary,
		evidence: (update.evidence ?? []).map(evidenceEntry),
		generatedBy: {
			applicationId: generatedBy.applicationId,
			applicationVersion: generatedBy.applicationVersion,
			applicationInstanceId: generatedBy.applicationInstanceId,
			rendererVersion: RENDERER_VERSION
		}
	};
	const bodyLines = [
		"# " + update.summary,
		"",
		"## 发生了什么",
		update.details && update.details.trim() !== "" ? update.details.trim() : "无",
		"",
		"## 证据"
	];
	const evidence = update.evidence ?? [];
	if (evidence.length === 0) bodyLines.push("无");
	else for (const item of evidence) {
		const entry = evidenceEntry(item);
		bodyLines.push("- " + [
			entry.kind,
			entry.ref ?? entry.relativePath,
			entry.contentHash
		].filter(Boolean).join(" | "));
	}
	bodyLines.push("", "## 下一步");
	if (update.kind === "blocker") {
		const needs = update.needs ?? [];
		bodyLines.push(needs.length === 0 ? "无" : needs.map((need) => "- " + need).join("\n"));
	} else if (update.kind === "completion_declared") {
		const claims = update.acceptanceClaims ?? [];
		bodyLines.push(claims.length === 0 ? "无" : claims.map((claim) => "- " + claim).join("\n"));
	} else bodyLines.push("无");
	bodyLines.push("", "## 阻塞与待决定");
	bodyLines.push(update.kind === "blocker" ? "见上（阻塞中）" : "无");
	bodyLines.push("");
	const frontmatterLines = ["---"];
	yamlMap(frontmatterLines, 0, Object.entries(frontmatter));
	frontmatterLines.push("---");
	return {
		frontmatter,
		markdown: frontmatterLines.join("\n") + "\n" + bodyLines.join("\n"),
		relativePath
	};
}
//#endregion
//#region src/outbox-dispatcher.js
const EXTERNAL_EVENT_SCHEMA_VERSION = "normalized-event/v1alpha1";
const EXTERNAL_EVENT_TYPES = Object.freeze(new Set([
	"progress.recorded",
	"blocker.raised",
	"completion.declared"
]));
const OUTBOX_DISPATCH_RETRY_BASE_MS = 3e4;
/**
* Create a bounded, single-flight outbox dispatcher.
* @param {{
*   storage: {
*     listOutbox(options: object): Array<Record<string, unknown>>,
*     transitionOutboxMessage(outboxId: string, expectedStatus: string, next: object): Record<string, unknown> | null,
*     getProject(projectId: string): Record<string, unknown> | null,
*     getProgressUpdateByCommandId(commandId: string): Record<string, unknown> | null,
*     recordQuarantineItem(input: object): Record<string, unknown>,
*   },
*   now?: () => string,
*   logger?: (line: string) => void,
*   fileSystem?: { mkdir: (path: string) => Promise<unknown>, writeFile: (path: string, content: string) => Promise<unknown> },
*   batchSize?: number,
*   maxAttempts?: number,
*   retryBaseMs?: number,
* }} options
*/
function createOutboxDispatcher(options) {
	const { storage, now = () => (/* @__PURE__ */ new Date()).toISOString(), logger = () => {}, fileSystem = {
		mkdir: (path) => mkdir(path, { recursive: true }),
		writeFile
	}, batchSize = 25, maxAttempts = 5, retryBaseMs = OUTBOX_DISPATCH_RETRY_BASE_MS } = options;
	if (typeof storage !== "object" || storage === null) throw new TypeError("outbox dispatcher requires storage");
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new TypeError("batchSize must be 1..500");
	if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new TypeError("maxAttempts must be 1..20");
	if (!Number.isSafeInteger(retryBaseMs) || retryBaseMs < 1e3) throw new TypeError("retryBaseMs must be at least 1000");
	let inFlight = null;
	/** Deliver one event; returns a transition descriptor for the outbox row. */
	function planDelivery(message) {
		message.outboxId;
		const event = message.payload;
		const eventType = event?.eventType;
		if (message.schemaVersion !== "normalized-event/v1alpha1" || !EXTERNAL_EVENT_TYPES.has(eventType)) return null;
		const project = storage.getProject(String(event.target.projectId));
		if (project === null) throw new Error(`project ${event.target.projectId} does not exist`);
		if (project.mode !== "managed") return { kind: "deliver_without_file" };
		const location = (project.workspaceLocations ?? []).find((candidate) => candidate.kind === "primary" && candidate.isActive);
		if (location === void 0 || typeof location.displayPath !== "string" || location.displayPath === "") throw new Error("managed project has no active primary workspace location");
		const update = storage.getProgressUpdateByCommandId(String(event.causation.commandId));
		if (update === null) throw new Error("progress update row is missing for the accepted event");
		const rendered = renderProgressUpdate({
			update,
			eventId: String(event.eventId),
			actor: event.actor,
			occurredAt: String(event.occurredAt),
			recordedAt: String(event.recordedAt),
			generatedBy: update.generatedBy
		});
		return {
			kind: "write_file",
			absolutePath: join(location.displayPath, rendered.relativePath),
			markdown: rendered.markdown
		};
	}
	async function attemptDelivery(message) {
		const plan = planDelivery(message);
		if (plan === null) return { handled: false };
		if (plan.kind === "deliver_without_file") {
			storage.transitionOutboxMessage(message.outboxId, "pending", {
				status: "delivered",
				attemptCount: Number(message.attemptCount) + 1,
				deliveredAt: now()
			});
			return { handled: true };
		}
		await fileSystem.mkdir(dirname(plan.absolutePath));
		await fileSystem.writeFile(plan.absolutePath, plan.markdown);
		if (storage.transitionOutboxMessage(message.outboxId, "pending", {
			status: "delivered",
			attemptCount: Number(message.attemptCount) + 1,
			deliveredAt: now()
		}) === null) return {
			handled: false,
			raced: true
		};
		return { handled: true };
	}
	async function recordFailure(message, error) {
		const attempt = Number(message.attemptCount) + 1;
		const messageText = String(error?.message ?? error).slice(0, 1e3);
		if ((attempt >= maxAttempts ? storage.transitionOutboxMessage(message.outboxId, "pending", {
			status: "failed",
			attemptCount: attempt,
			lastError: messageText
		}) : storage.transitionOutboxMessage(message.outboxId, "pending", {
			status: "pending",
			attemptCount: attempt,
			nextAttemptAt: new Date(Date.parse(now()) + retryBaseMs * 2 ** (attempt - 1)).toISOString(),
			lastError: messageText
		})) !== null && attempt >= maxAttempts) storage.recordQuarantineItem({
			projectId: message.payload?.target?.projectId ?? null,
			sourceKind: "outbox_delivery",
			sourceRef: message.outboxId,
			reasonCode: "OUTBOX_DELIVERY_FAILED",
			details: {
				eventId: message.payload?.eventId ?? null,
				eventType: message.payload?.eventType ?? null,
				attempts: attempt,
				message: messageText
			}
		});
	}
	/**
	* Drain one bounded batch of pending external update messages. Overlapping
	* calls share the same single flight; a null/racy transition is skipped
	* rather than quarantined. Returns delivery counts.
	*/
	function drain() {
		if (inFlight !== null) return inFlight;
		inFlight = (async () => {
			const delivered = [];
			const failed = [];
			const nowIso = now();
			const messages = storage.listOutbox({
				status: "pending",
				limit: 500
			}).filter((message) => message.schemaVersion === EXTERNAL_EVENT_SCHEMA_VERSION).filter((message) => message.nextAttemptAt === null || message.nextAttemptAt <= nowIso).slice(0, batchSize);
			for (const message of messages) try {
				if ((await attemptDelivery(message)).handled) delivered.push(message.outboxId);
			} catch (error) {
				failed.push(message.outboxId);
				try {
					await recordFailure(message, error);
				} catch (quarantineError) {
					logger(`outbox failure recording failed for ${message.outboxId}: ${String(quarantineError)}`);
				}
			}
			return Object.freeze({
				delivered,
				failed
			});
		})();
		inFlight.then(() => {
			inFlight = null;
		}, () => {
			inFlight = null;
		});
		return inFlight;
	}
	return Object.freeze({ drain });
}
//#endregion
//#region src/index.ts
const OUTBOX_DRAIN_INTERVAL_MS = 5e3;
const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../migrations/", import.meta.url));
/** The Host route is independent from Personal Foundation and owns the Gate 2B database lifetime. */
const inject = ["webServer"];
function apply(ctx) {
	ctx.effect(async () => {
		const runtime = await openRuntime();
		const handler = createProjectControlRequestHandler(runtime.read, {
			...runtime.lifecycle === void 0 ? {} : { lifecycle: runtime.lifecycle },
			...runtime.intake === void 0 ? {} : { intake: runtime.intake },
			...runtime.external === void 0 ? {} : { external: runtime.external },
			...runtime.console === void 0 ? {} : { console: runtime.console },
			...runtime.referenceResolver === void 0 ? {} : { referenceResolver: runtime.referenceResolver }
		});
		let unregister;
		let drainTimer;
		try {
			unregister = ctx.webServer.register({
				kind: "prefix",
				path: PROJECT_CONTROL_API_PREFIX,
				handler
			});
			if (runtime.outbox !== void 0) {
				drainTimer = setInterval(() => {
					runtime.outbox?.drain().catch(() => {});
				}, OUTBOX_DRAIN_INTERVAL_MS);
				drainTimer.unref?.();
			}
		} catch (error) {
			runtime.close();
			throw error;
		}
		return () => {
			if (drainTimer !== void 0) clearInterval(drainTimer);
			disposeProjectControlRegistration(unregister, () => runtime.close());
		};
	}, "project control Gate 2B Host API");
}
/** Always release the single-writer storage lock, even if Host route disposal fails. */
function disposeProjectControlRegistration(unregister, close) {
	let unregisterFailed = false;
	let unregisterError;
	try {
		unregister();
	} catch (error) {
		unregisterFailed = true;
		unregisterError = error;
	} finally {
		try {
			close();
		} catch (closeError) {
			if (unregisterFailed) throw new AggregateError([unregisterError, closeError], "Project Control route and storage disposal both failed.");
			throw closeError;
		}
	}
	if (unregisterFailed) throw unregisterError;
}
async function openRuntime() {
	const configuredHome = process.env.PROJECT_CONTROL_HOME?.trim();
	if (configuredHome === void 0 || configuredHome === "" || !isAbsolute(configuredHome)) return degradedRuntime("unavailable");
	let storage;
	const applicationVersion = packageVersion();
	const applicationInstanceId = `project-control-host:${String(process.pid)}:${randomUUID()}`;
	try {
		const projectControlHome = resolve(configuredHome);
		storage = await openProjectControlStorage({
			databasePath: join(projectControlHome, "project-control.sqlite3"),
			backupDirectory: join(projectControlHome, "backups"),
			migrationsDirectory: MIGRATIONS_DIRECTORY,
			applicationVersion,
			instanceId: applicationInstanceId
		});
	} catch (error) {
		console.warn("[project-control] openRuntime storage open failed:", error instanceof Error ? error.stack : String(error));
		return degradedRuntime(storageFailureState(error));
	}
	await recoverPendingFileSyncPlans(storage);
	const selectionSecret = process.env.PROJECT_CONTROL_SELECTION_SECRET?.trim();
	const intakeRuntime = selectionSecret !== void 0 && selectionSecret.length >= 32 ? createProjectControlIntakeRuntime({
		storage,
		scanner: {
			scanProjectDirectory,
			scanSourceDirectory
		},
		selectionSecret,
		applicationInstanceId,
		applicationVersion
	}) : void 0;
	return {
		read: storageReadAdapter(storage),
		lifecycle: storageLifecycleAdapter(storage),
		external: storageExternalAdapter(storage),
		console: storageConsoleAdapter(storage),
		outbox: createOutboxDispatcher({
			storage,
			logger: (line) => {
				console.warn(`[project-control outbox] ${line}`);
			}
		}),
		...intakeRuntime === void 0 ? {} : intakeRuntime,
		close: () => {
			storage.close();
		}
	};
}
/** Startup recovery for journal-owned staging residue and pre-acceptance commits. */
async function recoverPendingFileSyncPlans(storage) {
	const pending = storage.listFileSyncPlansForRecovery();
	for (const plan of pending) try {
		await recoverPlan({
			plan,
			canonical: validateWritePlanDomain(plan),
			targetRoot: plan.targetDisplayPath,
			stagingRoot: plan.stagingDisplayPath,
			journal: fileSyncJournal(storage, plan.planId)
		});
	} catch {}
}
function storageReadAdapter(storage) {
	return {
		getStatus() {
			const status = storage.status();
			if (status.state !== "ready") return degradedStatus("unavailable");
			return {
				state: "ready",
				schemaVersion: status.schemaVersion,
				writable: true,
				projectCount: status.projectCount
			};
		},
		listProjects() {
			const status = storage.status();
			if (status.state !== "ready") throw projectControlHttpError("STORAGE_UNAVAILABLE", "项目数据库暂不可用。", 503);
			return {
				projects: storage.listProjects({
					includeArchived: false,
					limit: 100
				}).map((project) => ({
					projectId: project.projectId,
					name: project.name,
					registrationMode: project.mode,
					lifecycle: project.lifecycle,
					updatedAt: project.updatedAt
				})),
				total: status.projectCount
			};
		},
		getProjectWorkspace(projectId) {
			const project = storage.getProject(projectId);
			if (project === null) return null;
			const location = project.activeLocation ?? project.workspaceLocations?.find((item) => item.isActive);
			if (location === void 0 || location === null) return null;
			return {
				projectId: project.projectId,
				root: location.displayPath
			};
		},
		listProjectWorkspaces() {
			if (storage.status().state !== "ready") throw projectControlHttpError("STORAGE_UNAVAILABLE", "项目数据库暂不可用。", 503);
			const projects = [];
			for (const project of storage.listProjects({
				includeArchived: false,
				limit: 100
			})) {
				const location = project.activeLocation ?? project.workspaceLocations?.find((item) => item.isActive);
				if (location === void 0 || location === null) continue;
				projects.push({
					projectId: project.projectId,
					root: location.displayPath,
					updatedAt: project.updatedAt
				});
			}
			return projects;
		}
	};
}
function fileSyncJournal(storage, planId) {
	return { transition(from, to, options = {}) {
		return storage.setFileSyncPlanState(planId, from, {
			state: to,
			createdPaths: options.createdPaths ?? [],
			...options.errorCode === void 0 ? {} : { errorCode: options.errorCode }
		});
	} };
}
function storageLifecycleAdapter(storage) {
	return {
		replayCommandReceipt(command) {
			return storage.replayCommandReceipt(command);
		},
		recordRejectedCommand(command, result) {
			return storage.recordRejectedCommand(command, result);
		},
		registerProject(command, trusted) {
			return storage.registerProject(command, trusted);
		},
		rebindProject(command, trusted) {
			return storage.rebindProject(command, trusted);
		},
		async createProject(command, trusted) {
			const plan = storage.getFileSyncPlan(trusted.plan.planId);
			if (plan === null) throw new FileSyncPlanError("FILE_SYNC_FAILED", "写入计划已不存在。", { planId: trusted.plan.planId });
			const canonical = validateWritePlanDomain(plan);
			const journal = fileSyncJournal(storage, plan.planId);
			const targetRoot = plan.targetDisplayPath;
			if (plan.state === "files_committed") {
				const verification = await verifyCommittedPlan({
					plan,
					canonical,
					targetRoot
				});
				if (!verification.ok) {
					await recoverPlan({
						plan,
						canonical,
						targetRoot,
						stagingRoot: plan.stagingDisplayPath,
						journal
					});
					throw new FileSyncPlanError("FILE_SYNC_FAILED", "已落盘文件复验失败，计划已进入隔离。", { verification });
				}
			} else if (plan.state === "planned" || plan.state === "rolled_back") await executeFileSyncPlan({
				plan,
				targetRoot,
				stagingRoot: plan.stagingDisplayPath,
				authorizedRoot: trusted.refs.sourceRoot.displayPath,
				contents: trusted.contents,
				journal
			});
			else throw new FileSyncPlanError("FILE_SYNC_FAILED", "写入计划处于不可执行状态。", { state: plan.state });
			const result = storage.registerCreatedProject(command, {
				planId: plan.planId,
				location: trusted.refs.location,
				manifestName: trusted.manifestName,
				manifestHash: trusted.manifestHash,
				manifestDocumentBindings: trusted.manifestDocumentBindings,
				origin: {
					kind: "template",
					templateId: trusted.template.templateId,
					templateVersion: trusted.template.templateVersion
				}
			});
			if (result.status === "rejected") {
				await rollbackCreated({
					plan,
					canonical,
					targetRoot,
					stagingRoot: plan.stagingDisplayPath,
					createdPaths: plan.createdPaths,
					removeTargetRoot: !plan.rootPreexistedEmpty
				});
				try {
					storage.setFileSyncPlanState(plan.planId, "files_committed", {
						state: "rolled_back",
						createdPaths: [],
						errorCode: result.error?.code
					});
				} catch {}
			}
			return result;
		},
		async upgradeProject(command, trusted) {
			const plan = storage.getFileSyncPlan(trusted.plan.planId);
			if (plan === null) throw new FileSyncPlanError("FILE_SYNC_FAILED", "写入计划已不存在。", { planId: trusted.plan.planId });
			const canonical = validateWritePlanDomain(plan);
			const journal = fileSyncJournal(storage, plan.planId);
			const targetRoot = plan.targetDisplayPath;
			if (plan.state === "files_committed") {
				const verification = await verifyCommittedPlan({
					plan,
					canonical,
					targetRoot
				});
				if (!verification.ok) {
					await recoverPlan({
						plan,
						canonical,
						targetRoot,
						stagingRoot: plan.stagingDisplayPath,
						journal
					});
					throw new FileSyncPlanError("FILE_SYNC_FAILED", "已落盘 manifest 复验失败，计划已进入隔离。", { verification });
				}
			} else if (plan.state === "planned" || plan.state === "rolled_back") await executeFileSyncPlan({
				plan,
				targetRoot,
				stagingRoot: plan.stagingDisplayPath,
				authorizedRoot: targetRoot,
				contents: trusted.contents,
				journal
			});
			else throw new FileSyncPlanError("FILE_SYNC_FAILED", "写入计划处于不可执行状态。", { state: plan.state });
			const result = storage.registerUpgradeManaged(command, {
				planId: plan.planId,
				location: trusted.refs.location,
				manifestName: trusted.manifestName,
				manifestHash: trusted.manifestHash
			});
			if (result.status === "rejected") {
				await rollbackCreated({
					plan,
					canonical,
					targetRoot,
					stagingRoot: plan.stagingDisplayPath,
					createdPaths: plan.createdPaths,
					removeTargetRoot: false
				});
				try {
					storage.setFileSyncPlanState(plan.planId, "files_committed", {
						state: "rolled_back",
						createdPaths: [],
						errorCode: result.error?.code
					});
				} catch {}
			}
			return result;
		}
	};
}
/** P7 console commands issued by the trusted local desktop UI. */
function storageConsoleAdapter(storage) {
	return {
		createWorkItem(projectId, input) {
			return storage.createWorkItem(projectId, {
				title: String(input.title),
				...input.instruction === void 0 ? {} : { instruction: String(input.instruction) },
				...input.acceptance === void 0 ? {} : { acceptance: input.acceptance },
				...input.executionStatus === void 0 ? {} : { executionStatus: String(input.executionStatus) },
				...input.reviewStatus === void 0 ? {} : { reviewStatus: String(input.reviewStatus) },
				...input.priority === void 0 ? {} : { priority: Number(input.priority) }
			});
		},
		setWorkItemStatus(projectId, workItemId, input) {
			return storage.setWorkItemStatus(projectId, workItemId, {
				expectedRevision: Number(input.expectedRevision),
				status: String(input.status)
			});
		},
		startRun(projectId, runId, input) {
			return storage.startRun(projectId, runId, { expectedRevision: Number(input.expectedRevision) });
		},
		requestReview(projectId, workItemId, input) {
			return storage.requestReview(projectId, workItemId, {
				expectedRevision: Number(input.expectedRevision),
				...input.risk === void 0 ? {} : { risk: String(input.risk) }
			});
		},
		decideReview(projectId, reviewId, input) {
			return storage.decideReview(projectId, reviewId, {
				expectedRevision: Number(input.expectedRevision),
				decision: String(input.decision),
				...input.rationale === void 0 ? {} : { rationale: String(input.rationale) }
			});
		},
		commentReview(projectId, reviewId, input) {
			return storage.commentReview(projectId, reviewId, { comment: String(input.comment) });
		}
	};
}
/** Gate 2E: handshake + external runtime updates + P6 projections, straight onto storage. */
function storageExternalAdapter(storage) {
	return {
		handshake(input) {
			return storage.handshakeHostInstance({
				instanceId: input.instanceId,
				appVersion: input.appVersion,
				protocolVersions: [...input.protocolVersions],
				capabilities: [...input.capabilities]
			});
		},
		submitExternalUpdate(command) {
			return storage.applyExternalUpdate(command);
		},
		listWorkItems(projectId) {
			return storage.listWorkItems({
				projectId,
				limit: 500
			});
		},
		listRuns(projectId, workItemId) {
			return storage.listRuns({
				projectId,
				...workItemId === void 0 ? {} : { workItemId },
				limit: 500
			});
		},
		listProgressUpdates(projectId) {
			return storage.listProgressUpdates({
				projectId,
				limit: 500
			});
		},
		listReviews(projectId) {
			return storage.listReviews({
				projectId,
				limit: 500
			});
		},
		listDecisions(projectId) {
			return storage.listDecisions({
				projectId,
				limit: 500
			});
		},
		listQuarantineItems() {
			return storage.listQuarantineItems({ limit: 500 });
		},
		resolveQuarantineItem(quarantineId, input) {
			return storage.resolveQuarantineItem(quarantineId, {
				expectedRevision: input.expectedRevision,
				decision: input.decision
			});
		},
		listEvents(projectId, afterSequence) {
			return storage.listEvents({
				projectId,
				...afterSequence === void 0 ? {} : { afterSequence },
				limit: 500
			});
		},
		listReviewActions(reviewId) {
			return storage.listReviewActions(reviewId, { limit: 500 });
		},
		listSessions(projectId) {
			return storage.listThreadBindings({
				projectId,
				limit: 500
			});
		}
	};
}
function degradedRuntime(state) {
	return {
		read: {
			getStatus: () => degradedStatus(state),
			listProjects() {
				throw projectControlHttpError("STORAGE_UNAVAILABLE", "项目数据库暂不可用。", 503);
			},
			getProjectWorkspace() {
				throw projectControlHttpError("STORAGE_UNAVAILABLE", "项目数据库暂不可用。", 503);
			},
			listProjectWorkspaces() {
				throw projectControlHttpError("STORAGE_UNAVAILABLE", "项目数据库暂不可用。", 503);
			}
		},
		close() {}
	};
}
function degradedStatus(state) {
	return {
		state,
		schemaVersion: null,
		writable: false,
		projectCount: null
	};
}
function storageFailureState(error) {
	if (error instanceof MigrationVersionError) return "read_only_newer_schema";
	if (error instanceof MigrationChecksumError || error instanceof MigrationError || error instanceof UntrackedDatabaseError) return "migration_failed";
	return "unavailable";
}
function packageVersion() {
	try {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		if (typeof manifest.version === "string" && manifest.version.trim() !== "") return manifest.version;
	} catch {}
	return "0.1.0-rc.5";
}
//#endregion
export { PROJECT_CONTROL_API_PREFIX, apply, createProjectControlRequestHandler, disposeProjectControlRegistration, fileSyncJournal, inject, recoverPendingFileSyncPlans, storageConsoleAdapter, storageExternalAdapter, storageLifecycleAdapter, validateLifecycleCommand, validateLifecycleResult };
