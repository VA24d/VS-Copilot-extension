import * as path from 'path';
import { EXTENSION_TO_LANGUAGE, FENCE_TAG_TO_LANGUAGE } from './extensionMap';

const FENCE_RE = /```([a-zA-Z0-9+#]+)/g;

/**
 * Detects the primary language for a request. Primary signal: attached file
 * extensions. Secondary: fenced code-block language tags in the response.
 * Falls back to "unknown".
 */
export function detectLanguage(attachmentFsPaths: string[], responseText: string): string {
	for (const fsPath of attachmentFsPaths) {
		const ext = path.extname(fsPath).toLowerCase();
		const label = EXTENSION_TO_LANGUAGE[ext];
		if (label) {
			return label;
		}
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

	let bestLabel: string | undefined;
	let bestCount = 0;
	for (const [label, count] of counts) {
		if (count > bestCount) {
			bestCount = count;
			bestLabel = label;
		}
	}

	return bestLabel ?? 'unknown';
}
