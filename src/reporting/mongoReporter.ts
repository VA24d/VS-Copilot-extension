import type { ReportPayload } from './payload';

export interface SendReportMongoOptions {
	connectionString: string;
	database: string;
	collection: string;
	timeoutMs: number;
}

export interface SendReportResult {
	ok: boolean;
	statusCode?: number;
	error?: string;
}

/**
 * Sends the same aggregate-only payload used for HTTP reporting to a local
 * MongoDB endpoint instead (e.g. `mongodb://localhost:27017`), for teams
 * that already run an internal MongoDB collector rather than an HTTP
 * ingestion endpoint. Opens a short-lived connection per send (reporting
 * happens at most every few minutes, so a persistent connection pool isn't
 * warranted) and always closes it, even on error.
 *
 * Security notes:
 * - The connection string is read from `context.secrets` by the caller,
 *   never from plain settings.json, since it commonly embeds credentials
 *   (`mongodb://user:pass@host`).
 * - Payload content is identical to the HTTP path: aggregate counts only,
 *   never prompt/response text.
 */
export async function sendReportMongo(payload: ReportPayload, options: SendReportMongoOptions): Promise<SendReportResult> {
	let MongoClientCtor: typeof import('mongodb').MongoClient;
	try {
		({ MongoClient: MongoClientCtor } = await import('mongodb'));
	} catch (err) {
		return { ok: false, error: `mongodb driver not available: ${String(err)}` };
	}

	const client = new MongoClientCtor(options.connectionString, {
		serverSelectionTimeoutMS: options.timeoutMs,
		connectTimeoutMS: options.timeoutMs
	});

	try {
		await client.connect();
		const db = client.db(options.database);
		await db.collection(options.collection).insertOne({ ...payload, receivedAt: new Date() });
		return { ok: true };
	} catch (err) {
		return { ok: false, error: String(err) };
	} finally {
		await client.close().catch(() => { /* best-effort close */ });
	}
}
