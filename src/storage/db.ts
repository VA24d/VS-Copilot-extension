import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { DDL, SCHEMA_USER_VERSION } from './schema';

export interface RequestRow {
	sessionId: string;
	requestId: string;
	source: 'passive' | 'participant';
	workspaceHash: string | undefined;
	workspacePath: string | undefined;
	timestamp: number;
	category: string;
	language: string;
	modelId: string | undefined;
	agentId: string | undefined;
	agentName: string | undefined;
	promptText: string;
	responseText: string;
	attachmentsJson: string;
	copilotCredits: number | undefined;
	schemaVersionSeen: number;
}

export interface IngestionState {
	filePath: string;
	lastMtimeMs: number;
	lastSizeBytes: number;
	lastRequestCount: number;
	lastProcessedAt: number;
	schemaVersionSeen: number;
	parseErrorCount: number;
	lastError: string | undefined;
}

/**
 * sql.js (WASM SQLite) is in-memory-first: state must be explicitly
 * exported and written to disk, and reloaded on activation. Flushing is
 * caller-driven (debounced idle timer + forced flush on deactivate) —
 * rows written between flushes can be lost on a crash; not solving with a
 * WAL for MVP (plan storage section).
 */
export class UsageDb {
	private constructor(
		private readonly SQL: SqlJsStatic,
		private readonly db: Database,
		private readonly dbFilePath: string
	) {}

	static async create(wasmPath: string, dbFilePath: string): Promise<UsageDb> {
		const SQL = await initSqlJs({
			locateFile: () => wasmPath
		});

		let db: Database;
		if (fs.existsSync(dbFilePath)) {
			const bytes = fs.readFileSync(dbFilePath);
			db = new SQL.Database(bytes);
		} else {
			db = new SQL.Database();
		}

		// Read the on-disk schema version BEFORE running DDL/ALTER — needed to
		// decide whether ingestion_state must be cleared below (a v2 build
		// shipped earlier this session already added copilot_credits and set
		// user_version=2 on real DBs, but never backfilled existing rows, so
		// detecting "did ALTER just succeed" alone would miss those DBs).
		const versionStmt = db.prepare(`PRAGMA user_version`);
		versionStmt.step();
		const onDiskVersion = Number((versionStmt.getAsObject() as Record<string, unknown>).user_version ?? 0);
		versionStmt.free();

		db.run(DDL);
		// Guarded migration for DBs created before copilot_credits existed.
		// CREATE TABLE IF NOT EXISTS above doesn't add columns to an already-
		// existing table, so ALTER TABLE is required; SQLite has no "ADD COLUMN
		// IF NOT EXISTS", so the duplicate-column error is simply swallowed on
		// DBs that already have it (including brand-new ones, since the column
		// is also in the DDL above).
		try {
			db.run(`ALTER TABLE requests ADD COLUMN copilot_credits REAL`);
		} catch {
			// column already exists — expected on every run after the first migration.
		}
		if (onDiskVersion < SCHEMA_USER_VERSION) {
			// Existing rows (inserted before this column existed, or before the
			// backfill upsert existed) have copilot_credits = NULL and would stay
			// that way forever otherwise. Clearing the ingestion cursor makes the
			// next scan re-parse every already-seen file and backfill
			// copilot_credits via insertRequest's ON CONFLICT upsert below.
			db.run(`DELETE FROM ingestion_state`);
		}
		db.run(`PRAGMA user_version = ${SCHEMA_USER_VERSION};`);

		return new UsageDb(SQL, db, dbFilePath);
	}

	flush(): void {
		const dir = path.dirname(this.dbFilePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		const data = this.db.export();
		fs.writeFileSync(this.dbFilePath, Buffer.from(data));
	}

	dispose(): void {
		this.flush();
		this.db.close();
	}

	/** Idempotent insert. Returns true if a new row was written, false if it already existed. */
	insertRequest(row: RequestRow): boolean {
		const stmt = this.db.prepare(`
			INSERT INTO requests
				(session_id, request_id, source, workspace_hash, workspace_path, timestamp,
				 category, language, model_id, agent_id, agent_name, prompt_text, response_text,
				 attachments_json, copilot_credits, schema_version_seen, created_at)
			VALUES
				($sessionId, $requestId, $source, $workspaceHash, $workspacePath, $timestamp,
				 $category, $language, $modelId, $agentId, $agentName, $promptText, $responseText,
				 $attachmentsJson, $copilotCredits, $schemaVersionSeen, $createdAt)
			ON CONFLICT(session_id, request_id, source) DO UPDATE SET
				copilot_credits = excluded.copilot_credits
			WHERE requests.copilot_credits IS NULL AND excluded.copilot_credits IS NOT NULL
		`);
		try {
			stmt.run({
				$sessionId: row.sessionId,
				$requestId: row.requestId,
				$source: row.source,
				$workspaceHash: row.workspaceHash ?? null,
				$workspacePath: row.workspacePath ?? null,
				$timestamp: row.timestamp,
				$category: row.category,
				$language: row.language,
				$modelId: row.modelId ?? null,
				$agentId: row.agentId ?? null,
				$agentName: row.agentName ?? null,
				$promptText: row.promptText,
				$responseText: row.responseText,
				$attachmentsJson: row.attachmentsJson,
				$copilotCredits: row.copilotCredits ?? null,
				$schemaVersionSeen: row.schemaVersionSeen,
				$createdAt: Date.now()
			});
			// Rows modified counts both a fresh insert and a credits backfill
			// update as "modified" — both are legitimately new information for
			// this row, so the caller's inserted/skipped accounting stays
			// close enough (it's a diagnostic count, not used for correctness).
			return this.db.getRowsModified() > 0;
		} finally {
			stmt.free();
		}
	}

	getIngestionState(filePath: string): IngestionState | undefined {
		const stmt = this.db.prepare(`SELECT * FROM ingestion_state WHERE file_path = $filePath`);
		try {
			stmt.bind({ $filePath: filePath });
			if (!stmt.step()) {
				return undefined;
			}
			const row = stmt.getAsObject() as Record<string, unknown>;
			return {
				filePath: String(row.file_path),
				lastMtimeMs: Number(row.last_mtime_ms ?? 0),
				lastSizeBytes: Number(row.last_size_bytes ?? 0),
				lastRequestCount: Number(row.last_request_count ?? 0),
				lastProcessedAt: Number(row.last_processed_at ?? 0),
				schemaVersionSeen: Number(row.schema_version_seen ?? 0),
				parseErrorCount: Number(row.parse_error_count ?? 0),
				lastError: row.last_error == null ? undefined : String(row.last_error)
			};
		} finally {
			stmt.free();
		}
	}

	setIngestionState(state: IngestionState): void {
		const stmt = this.db.prepare(`
			INSERT INTO ingestion_state
				(file_path, last_mtime_ms, last_size_bytes, last_request_count, last_processed_at,
				 schema_version_seen, parse_error_count, last_error)
			VALUES
				($filePath, $lastMtimeMs, $lastSizeBytes, $lastRequestCount, $lastProcessedAt,
				 $schemaVersionSeen, $parseErrorCount, $lastError)
			ON CONFLICT(file_path) DO UPDATE SET
				last_mtime_ms = excluded.last_mtime_ms,
				last_size_bytes = excluded.last_size_bytes,
				last_request_count = excluded.last_request_count,
				last_processed_at = excluded.last_processed_at,
				schema_version_seen = excluded.schema_version_seen,
				parse_error_count = excluded.parse_error_count,
				last_error = excluded.last_error
		`);
		try {
			stmt.run({
				$filePath: state.filePath,
				$lastMtimeMs: state.lastMtimeMs,
				$lastSizeBytes: state.lastSizeBytes,
				$lastRequestCount: state.lastRequestCount,
				$lastProcessedAt: state.lastProcessedAt,
				$schemaVersionSeen: state.schemaVersionSeen,
				$parseErrorCount: state.parseErrorCount,
				$lastError: state.lastError ?? null
			});
		} finally {
			stmt.free();
		}
	}

	countAll(): number {
		return this.scalar(`SELECT COUNT(*) AS c FROM requests`);
	}

	countSince(epochMs: number): number {
		const stmt = this.db.prepare(`SELECT COUNT(*) AS c FROM requests WHERE timestamp >= $since`);
		try {
			stmt.bind({ $since: epochMs });
			stmt.step();
			return Number((stmt.getAsObject() as Record<string, unknown>).c ?? 0);
		} finally {
			stmt.free();
		}
	}

	groupByCategory(): Array<{ category: string; count: number }> {
		return this.groupBy('category');
	}

	groupByLanguage(): Array<{ language: string; count: number }> {
		return this.rows(`SELECT language, COUNT(*) AS count FROM requests GROUP BY language ORDER BY count DESC`)
			.map(r => ({ language: String(r.language ?? 'unknown'), count: Number(r.count) }));
	}

	groupByModel(): Array<{ modelId: string; count: number }> {
		return this.rows(`SELECT model_id AS modelId, COUNT(*) AS count FROM requests GROUP BY model_id ORDER BY count DESC`)
			.map(r => ({ modelId: String(r.modelId ?? 'unknown'), count: Number(r.count) }));
	}

	/** Cost units (`copilotCredits`) grouped by model — shows which models actually consume the budget. */
	creditsByModel(): Array<{ modelId: string; credits: number }> {
		return this.rows(`SELECT model_id AS modelId, COALESCE(SUM(copilot_credits), 0) AS credits FROM requests GROUP BY model_id ORDER BY credits DESC`)
			.map(r => ({ modelId: String(r.modelId ?? 'unknown'), credits: Number(r.credits) }));
	}

	groupByDay(days: number): Array<{ day: string; count: number }> {
		const since = Date.now() - days * 24 * 60 * 60 * 1000;
		return this.rows(`
			SELECT strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count
			FROM requests
			WHERE timestamp >= ${since}
			GROUP BY day
			ORDER BY day ASC
		`).map(r => ({ day: String(r.day), count: Number(r.count) }));
	}

	/** Total Copilot cost units (`copilotCredits`, as reported by VS Code per-request) across all logged requests. */
	totalCredits(): number {
		return this.scalar(`SELECT COALESCE(SUM(copilot_credits), 0) AS c FROM requests`);
	}

	/** Total cost units since a given epoch ms (e.g. start of current calendar month). */
	creditsSince(epochMs: number): number {
		const stmt = this.db.prepare(`SELECT COALESCE(SUM(copilot_credits), 0) AS c FROM requests WHERE timestamp >= $since`);
		try {
			stmt.bind({ $since: epochMs });
			stmt.step();
			return Number((stmt.getAsObject() as Record<string, unknown>).c ?? 0);
		} finally {
			stmt.free();
		}
	}

	/** Daily cost-unit trend for the last N days (companion to groupByDay's request-count trend). Bucketed by local calendar day, matching the dashboard's "today" boundary. */
	creditsByDay(days: number): Array<{ day: string; credits: number }> {
		const since = Date.now() - days * 24 * 60 * 60 * 1000;
		return this.rows(`
			SELECT strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch', 'localtime') AS day, COALESCE(SUM(copilot_credits), 0) AS credits
			FROM requests
			WHERE timestamp >= ${since}
			GROUP BY day
			ORDER BY day ASC
		`).map(r => ({ day: String(r.day), credits: Number(r.credits) }));
	}

	/** (category, modelId) pairs for every logged request — feeds the model-fit heuristic (computed in JS, not stored, so the heuristic can evolve without a migration). */
	listCategoryModelPairs(): Array<{ category: string; modelId: string }> {
		return this.rows(`SELECT category, COALESCE(model_id, '') AS modelId FROM requests`)
			.map(r => ({ category: String(r.category ?? 'other'), modelId: String(r.modelId ?? '') }));
	}

	/** Category counts, for the time-savings heuristic (see heuristics/timeSavings.ts). */
	categoryCounts(): Array<{ category: string; count: number }> {
		return this.groupByCategory();
	}

	purgeAll(): void {
		this.db.run(`DELETE FROM requests`);
		this.db.run(`DELETE FROM ingestion_state`);
	}

	/**
	 * Metadata-only rows for CSV/audit export — deliberately excludes
	 * prompt_text/response_text so an exported file can't leak raw prompt
	 * content by default (compliance exports should be safe to hand to an
	 * auditor without a second review pass).
	 */
	listRequestsForExport(): Array<{
		timestamp: number;
		category: string;
		language: string;
		modelId: string;
		agentId: string;
		source: string;
		workspaceHash: string;
	}> {
		return this.rows(`
			SELECT timestamp, category, language,
			       COALESCE(model_id, '') AS modelId,
			       COALESCE(agent_id, '') AS agentId,
			       source,
			       COALESCE(workspace_hash, '') AS workspaceHash
			FROM requests
			ORDER BY timestamp ASC
		`).map(r => ({
			timestamp: Number(r.timestamp ?? 0),
			category: String(r.category ?? 'other'),
			language: String(r.language ?? 'unknown'),
			modelId: String(r.modelId ?? ''),
			agentId: String(r.agentId ?? ''),
			source: String(r.source ?? ''),
			workspaceHash: String(r.workspaceHash ?? '')
		}));
	}

	applyRetention(retentionDays: number): number {
		if (retentionDays <= 0) {
			return 0;
		}
		const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
		const before = this.countAll();
		this.db.run(`DELETE FROM requests WHERE timestamp < ${cutoff}`);
		return before - this.countAll();
	}

	private groupBy(column: string): Array<{ category: string; count: number }> {
		return this.rows(`SELECT ${column} AS category, COUNT(*) AS count FROM requests GROUP BY ${column} ORDER BY count DESC`)
			.map(r => ({ category: String(r.category ?? 'other'), count: Number(r.count) }));
	}

	private scalar(sql: string): number {
		const stmt = this.db.prepare(sql);
		try {
			stmt.step();
			const row = stmt.getAsObject() as Record<string, unknown>;
			return Number(row.c ?? 0);
		} finally {
			stmt.free();
		}
	}

	private rows(sql: string): Array<Record<string, unknown>> {
		const stmt = this.db.prepare(sql);
		const out: Array<Record<string, unknown>> = [];
		try {
			while (stmt.step()) {
				out.push(stmt.getAsObject() as Record<string, unknown>);
			}
		} finally {
			stmt.free();
		}
		return out;
	}
}
