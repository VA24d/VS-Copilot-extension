import * as path from 'path';
import { EXTENSION_TO_LANGUAGE, FENCE_TAG_TO_LANGUAGE } from './extensionMap';

const FENCE_RE = /```([a-zA-Z0-9+#]+)/g;

/**
 * Detects the primary language for a request. Primary signal: extensions of
 * every file path involved (explicit attachments, plus files actually
 * edited/referenced via agent-mode tool calls — see sessionParser.ts), by
 * frequency rather than "first wins" since one request commonly touches
 * several files. Secondary signal: fenced code-block language tags in the
 * response (rarer in agent mode, but still the best signal for ask-mode/
 * inline-suggestion style responses that don't call file-editing tools).
 * Falls back to "unknown".
 */
export function detectLanguage(attachmentFsPaths: string[], responseText: string): string {
	const extCounts = new Map<string, number>();
	for (const fsPath of attachmentFsPaths) {
		const ext = path.extname(fsPath).toLowerCase();
		const label = EXTENSION_TO_LANGUAGE[ext];
		if (label) {
			extCounts.set(label, (extCounts.get(label) ?? 0) + 1);
		}
	}
	const bestFromPaths = pickMostCommon(extCounts);
	if (bestFromPaths) {
		return bestFromPaths;
	}

	const counts = new Map<string, number>();
	let match: RegExpExecArray | null;
	FENCE_RE.lastIndex = 0;
	while ((match = FENCE_RE.exec(responseText)) !== null) {
		const tag = match[1].toLowerCase();
		const label = FENCE_TAG_TO_LANGUAGE[tag];
		if (label) {
			counts.set(label, (counts.get(label) ?? 0) + 1);
		}
	}

	return pickMostCommon(counts) ?? 'unknown';
}

function pickMostCommon(counts: Map<string, number>): string | undefined {
	let bestLabel: string | undefined;
	let bestCount = 0;
	for (const [label, count] of counts) {
		if (count > bestCount) {
			bestCount = count;
			bestLabel = label;
		}
	}
	return bestLabel;
}
