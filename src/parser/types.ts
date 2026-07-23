/**
 * Loose types reflecting the undocumented, evolving VS Code chat session
 * snapshot schema. Every field is optional-in-spirit — the parser must treat
 * this as untrusted input and never throw.
 */

export interface RawChatVariableData {
	variables?: Array<{
		fsPath?: string;
		name?: string;
		[key: string]: unknown;
	}>;
	[key: string]: unknown;
}

export interface RawChatResponsePart {
	value?: {
		value?: string;
		[key: string]: unknown;
	};
	kind?: string;
	[key: string]: unknown;
}

export interface RawChatRequest {
	requestId?: string;
	message?: {
		text?: string;
		[key: string]: unknown;
	};
	agent?: {
		id?: string;
		extensionId?: string;
		[key: string]: unknown;
	};
	slashCommand?: {
		name?: string;
		[key: string]: unknown;
	};
	modelId?: string;
	timestamp?: number;
	response?: RawChatResponsePart[];
	result?: unknown;
	variableData?: RawChatVariableData;
	[key: string]: unknown;
}

export interface RawChatSession {
	version?: number;
	sessionId?: string;
	requests?: RawChatRequest[];
	[key: string]: unknown;
}

/** Normalized shape the rest of the pipeline (classifier, language detector, storage) works with. */
export interface ParsedRequest {
	sessionId: string;
	requestId: string;
	timestamp: number;
	promptText: string;
	responseText: string;
	agentId: string | undefined;
	modelId: string | undefined;
	slashCommand: string | undefined;
	attachmentFsPaths: string[];
	schemaVersionSeen: number;
}

export interface ParseResult {
	requests: ParsedRequest[];
	schemaVersionSeen: number;
	errorCount: number;
	lastError: string | undefined;
}
