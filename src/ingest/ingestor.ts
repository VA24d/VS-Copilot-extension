import * as fs from 'fs';
import { workspaceHashFromSessionFilePath } from '../discovery/sessionFileIndex';
import { classify } from '../classify/classifier';
import { detectLanguage } from '../language/languageDetector';
import { parseSessionFile } from '../parser/sessionParser';
import type { UsageDb } from '../storage/db';

/** The extension's own chat participant id, used to skip double-counting (plan §Key risks 2). */
export const USAGE_PARTICIPANT_AGENT_ID = 'usageLogger.usage';

export interface IngestSummary {
	filesScanned: number;
	requestsInserted: number;
	requestsSkippedExisting: number;
	filesWithErrors: number;
}

/**
 * Parses one session file, classifies + detects language for each request,
 * and upserts into the DB. Idempotent via the file's ingestion cursor
 * (mtime/size) plus the DB's own UNIQUE constraint. Skips requests whose
 * `agent.id` is the extension's own participant — those are logged directly
 * by the participant with `source='participant'` to avoid double-counting.
 */
export function ingestSessionFile(db: UsageDb, filePath: string): IngestSummary {
	const summary: IngestSummary = { filesScanned: 1, requestsInserted: 0, requestsSkippedExisting: 0, filesWithErrors: 0 };

	let stat: fs.Stats;
	try {
		stat = fs.statSync(filePath);
	} catch {
		summary.filesWithErrors++;
		return summary;
	}

	const priorState = db.getIngestionState(filePath);
	if (priorState && priorState.lastMtimeMs === stat.mtimeMs && priorState.lastSizeBytes === stat.size) {
		// Unchanged since last ingest — nothing to do.
		return summary;
	}

	const result = parseSessionFile(filePath);
	if (result.errorCount > 0) {
		summary.filesWithErrors++;
	}

	const workspaceHash = workspaceHashFromSessionFilePath(filePath);

	for (const request of result.requests) {
		if (request.agentId === USAGE_PARTICIPANT_AGENT_ID) {
			continue;
		}

		const category = classify(request.promptText, request.slashCommand);
		const language = detectLanguage(request.attachmentFsPaths, request.responseText);

		const inserted = db.insertRequest({
			sessionId: request.sessionId,
			requestId: request.requestId,
			source: 'passive',
			workspaceHash,
			workspacePath: undefined,
			timestamp: request.timestamp,
			category,
			language,
			modelId: request.modelId,
			agentId: request.agentId,
			agentName: undefined,
			promptText: request.promptText,
			responseText: request.responseText,
			attachmentsJson: JSON.stringify(request.attachmentFsPaths),
			schemaVersionSeen: request.schemaVersionSeen
		});

		if (inserted) {
			summary.requestsInserted++;
		} else {
			summary.requestsSkippedExisting++;
		}
	}

	db.setIngestionState({
		filePath,
		lastMtimeMs: stat.mtimeMs,
		lastSizeBytes: stat.size,
		lastRequestCount: result.requests.length,
		lastProcessedAt: Date.now(),
		schemaVersionSeen: result.schemaVersionSeen,
		parseErrorCount: result.errorCount,
		lastError: result.lastError
	});

	return summary;
}
