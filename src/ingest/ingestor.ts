import * as fs from 'fs';
import { workspaceHashFromSessionFilePath } from '../discovery/sessionFileIndex';
import { classify } from '../classify/classifier';
import { detectLanguage } from '../language/languageDetector';
import { parseChatSessionFile } from '../parser/sessionParser';
import { anyContainsSensitiveLabel } from '../privacy/sensitiveLabels';
import { matchesAnyGlob } from '../util/globMatch';
import type { UsageDb } from '../storage/db';

/** The extension's own chat participant id, used to skip double-counting (plan §Key risks 2). */
export const USAGE_PARTICIPANT_AGENT_ID = 'usageLogger.usage';

export interface IngestSummary {
	filesScanned: number;
	requestsInserted: number;
	requestsSkippedExisting: number;
	filesWithErrors: number;
	requestsExcluded: number;
	requestsRedacted: number;
}

export interface IngestOptions {
	/** When true, no requests are logged at all — private mode pause. */
	privateMode: boolean;
	/** Requests touching any attached file matching one of these globs are skipped entirely (not even metadata is stored). */
	excludedPathGlobs: readonly string[];
	/**
	 * Requests whose prompt/response text or attached file paths contain one
	 * of these keywords still have their metadata (category/language/model/
	 * timestamp) logged, but prompt_text/response_text are redacted before
	 * storage. LOCAL STORAGE control only — see sensitiveLabels.ts for the
	 * honest scope statement (this cannot stop data reaching the model).
	 */
	sensitiveLabelKeywords: readonly string[];
}

const DEFAULT_OPTIONS: IngestOptions = {
	privateMode: false,
	excludedPathGlobs: [],
	sensitiveLabelKeywords: []
};

const REDACTED_PLACEHOLDER = '[redacted: sensitive label detected]';

/**
 * Parses one session file, classifies + detects language for each request,
 * and upserts into the DB. Idempotent via the file's ingestion cursor
 * (mtime/size) plus the DB's own UNIQUE constraint. Skips requests whose
 * `agent.id` is the extension's own participant — those are logged directly
 * by the participant with `source='participant'` to avoid double-counting.
 */
export function ingestSessionFile(db: UsageDb, filePath: string, options: IngestOptions = DEFAULT_OPTIONS): IngestSummary {
	const summary: IngestSummary = { filesScanned: 1, requestsInserted: 0, requestsSkippedExisting: 0, filesWithErrors: 0, requestsExcluded: 0, requestsRedacted: 0 };

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

	if (options.privateMode) {
		// Private mode: don't even parse — treat as if nothing changed so the
		// cursor isn't advanced (once turned off, the file gets re-ingested).
		return summary;
	}

	const result = parseChatSessionFile(filePath);
	if (result.errorCount > 0) {
		summary.filesWithErrors++;
	}

	const workspaceHash = workspaceHashFromSessionFilePath(filePath);

	for (const request of result.requests) {
		if (request.agentId === USAGE_PARTICIPANT_AGENT_ID) {
			continue;
		}

		if (options.excludedPathGlobs.length > 0 && request.attachmentFsPaths.some((p) => matchesAnyGlob(p, options.excludedPathGlobs))) {
			summary.requestsExcluded++;
			continue;
		}

		const category = classify(request.promptText, request.slashCommand);
		const language = detectLanguage(request.attachmentFsPaths, request.responseText);

		const isSensitive = options.sensitiveLabelKeywords.length > 0 && anyContainsSensitiveLabel(
			[request.promptText, request.responseText, ...request.attachmentFsPaths],
			options.sensitiveLabelKeywords
		);
		if (isSensitive) {
			summary.requestsRedacted++;
		}

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
			promptText: isSensitive ? REDACTED_PLACEHOLDER : request.promptText,
			responseText: isSensitive ? REDACTED_PLACEHOLDER : request.responseText,
			attachmentsJson: isSensitive ? '[]' : JSON.stringify(request.attachmentFsPaths),
			copilotCredits: request.copilotCredits,
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
