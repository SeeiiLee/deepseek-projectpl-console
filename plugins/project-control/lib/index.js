import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, parse, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
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
//#region src/manifest-validator.ts
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
	const ajv = new Ajv2020({
		allErrors: true,
		strict: true
	});
	addFormats(ajv);
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
	const ajv = new Ajv2020({
		allErrors: true,
		strict: true
	});
	addFormats(ajv);
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
	const ajv = new Ajv2020({
		allErrors: true,
		strict: true
	});
	addFormats(ajv);
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
	return candidates[candidates.length - 1];
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
	const ajv = new Ajv2020({
		allErrors: true,
		strict: true
	});
	addFormats(ajv);
	markerValidator = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, "utf8")));
	return markerValidator;
}
function validateProjectHomeMarker(value) {
	const validate = validator();
	const valid = validate(value);
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
	const ajv = new Ajv2020({
		allErrors: true,
		strict: true
	});
	addFormats(ajv);
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
				const manifest = requireManagedManifest(await rescanCandidate(options.scanner, candidate));
				const project = requireMatchedProject(options.storage, candidate);
				const identityEvidence = asObject(payload.identityEvidence);
				if (!hostCommandMatches(command, {
					candidateId,
					candidateRevision,
					applicationInstanceId: options.applicationInstanceId,
					applicationVersion: options.applicationVersion,
					projectId: manifest.projectId,
					kind: "project.rebindLocation",
					expectedRevision: project.revision,
					manifestHash: manifest.hash,
					manifestRelativePath: manifest.relativePath
				}) || identityEvidence?.manifestHash !== manifest.hash) return null;
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
				let template;
				try {
					template = loadTemplate(renderParams.templateId ?? "", renderParams.templateVersion ?? "");
				} catch {
					return null;
				}
				if (template.templateHash !== templatePayload?.templateHash) return null;
				const isProjectHome = template.layout === "project-home";
				if (isProjectHome && (renderParams.templateLayout !== "project-home" || renderParams.manifestPath !== "workspace/.dsh-project/project.yaml" || renderParams.slug !== renderParams.directoryName || !isProjectHomeSlug(renderParams.slug) || !sameWindowsPath(renderParams.projectHomeRoot, projectHomeRoot) || !sameWindowsPath(plan.targetDisplayPath, win32.join(projectHomeRoot, renderParams.slug)) || !sameWindowsPath(renderParams.workspaceDisplayPath, win32.join(plan.targetDisplayPath, "workspace")) || !sameWindowsPath(refs.sourceRoot.displayPath, projectHomeRoot) || !sameWindowsPath(refs.location.displayPath, renderParams.workspaceDisplayPath))) return null;
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
		if (manifest === null || options.project === null) throw projectControlHttpError("IDENTITY_EVIDENCE_REQUIRED", "只有受管理项目可以自动重新绑定位置。", 409);
		const activeLocation = options.project.workspaceLocations?.find((location) => location.isActive);
		if (activeLocation === void 0) throw projectControlHttpError("REFERENCE_UNRESOLVED", "项目当前没有可核对的活动位置。", 409);
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
				identityEvidence: {
					kind: "managed_manifest",
					manifestHash: manifest.hash
				}
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
