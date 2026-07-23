import * as fs from 'fs';
import type { ParseResult, ParsedRequest, RawChatRequest, RawChatSession } from './types';

/**
 * Defensive parser for `workspaceStorage/<hash>/chatSessions/<id>.json`
 * full-snapshot files. Never throws — malformed/unexpected shapes are
 * skipped per-request and counted as errors so callers can surface a
 * per-file error budget without losing the whole file.
 */
export function parseSessionFile(filePath: string): ParseResult {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, 'utf8');
	} catch (err) {
		return { requests: [], schemaVersionSeen: 0, errorCount: 1, lastError: `read failed: ${String(err)}` };
	}

	let session: RawChatSession;
	try {
		session = JSON.parse(raw);
	} catch (err) {
		return { requests: [], schemaVersionSeen: 0, errorCount: 1, lastError: `JSON.parse failed: ${String(err)}` };
	}

	return parseSession(session);
}

export function parseSession(session: RawChatSession): ParseResult {
	const schemaVersionSeen = typeof session.version === 'number' ? session.version : 0;
	const sessionId = typeof session.sessionId === 'string' ? session.sessionId : '';
	const requests: ParsedRequest[] = [];
	let errorCount = 0;
	let lastError: string | undefined;

	if (!Array.isArray(session.requests)) {
		return { requests, schemaVersionSeen, errorCount: 0, lastError: undefined };
	}

	for (const rawRequest of session.requests) {
		try {
			const parsed = parseRequest(sessionId, rawRequest, schemaVersionSeen);
			if (parsed) {
				requests.push(parsed);
			}
		} catch (err) {
			errorCount++;
			lastError = `request parse failed: ${String(err)}`;
		}
	}

	return { requests, schemaVersionSeen, errorCount, lastError };
}

function parseRequest(sessionId: string, rawRequest: RawChatRequest, schemaVersionSeen: number): ParsedRequest | undefined {
	if (!rawRequest || typeof rawRequest !== 'object') {
		return undefined;
	}

	const requestId = typeof rawRequest.requestId === 'string' ? rawRequest.requestId : undefined;
	if (!requestId) {
		return undefined;
	}

	const promptText = typeof rawRequest.message?.text === 'string' ? rawRequest.message.text : '';
	const timestamp = typeof rawRequest.timestamp === 'number' ? rawRequest.timestamp : Date.now();
	const agentId = typeof rawRequest.agent?.id === 'string' ? rawRequest.agent.id : undefined;
	const modelId = typeof rawRequest.modelId === 'string' ? rawRequest.modelId : undefined;
	const slashCommand = typeof rawRequest.slashCommand?.name === 'string' ? rawRequest.slashCommand.name : undefined;

	const responseText = extractResponseText(rawRequest.response);
	const attachmentFsPaths = extractAttachmentPaths(rawRequest.variableData);

	return {
		sessionId,
		requestId,
		timestamp,
		promptText,
		responseText,
		agentId,
		modelId,
		slashCommand,
		attachmentFsPaths,
		schemaVersionSeen
	};
}

function extractResponseText(response: RawChatRequest['response']): string {
	if (!Array.isArray(response)) {
		return '';
	}
	const chunks: string[] = [];
	for (const part of response) {
		if (part && typeof part === 'object' && typeof part.value?.value === 'string') {
			chunks.push(part.value.value);
		}
	}
	return chunks.join('\n');
}

function extractAttachmentPaths(variableData: RawChatRequest['variableData']): string[] {
	if (!variableData || !Array.isArray(variableData.variables)) {
		return [];
	}
	const paths: string[] = [];
	for (const variable of variableData.variables) {
		if (variable && typeof variable.fsPath === 'string') {
			paths.push(variable.fsPath);
		}
	}
	return paths;
}
