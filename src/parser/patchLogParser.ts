import * as fs from 'fs';

/**
 * Replays the append-only `kind:0/1/2` patch log used by chat session
 * `.jsonl` files (confirmed via direct inspection of real VS Code 1.130
 * insider session files — this format is now used for BOTH
 * `workspaceStorage/<hash>/chatSessions/*.jsonl` and
 * `globalStorage/emptyWindowChatSessions/*.jsonl`, not just the latter as
 * originally assumed):
 *
 * - `{ kind: 0, v: <fullSessionSnapshot> }` — line 0, full replace of the root.
 * - `{ kind: 1, k: <keyPath>, v: <value> }` — set `value` at `keyPath`
 *   (keyPath segments are a mix of object keys and array indices).
 * - `{ kind: 2, k: <keyPath>, v: <items[]> }` — append `items` onto the
 *   array at `keyPath` (creating it if missing).
 *
 * Never throws — malformed lines are skipped and counted as errors so the
 * rest of the file can still be reconstructed.
 */
export interface ReplayResult {
	session: Record<string, unknown> | undefined;
	errorCount: number;
	lastError: string | undefined;
}

export function replayPatchLogFile(filePath: string): ReplayResult {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, 'utf8');
	} catch (err) {
		return { session: undefined, errorCount: 1, lastError: `read failed: ${String(err)}` };
	}
	return replayPatchLog(raw);
}

export function replayPatchLog(raw: string): ReplayResult {
	const lines = raw.split('\n').filter(line => line.trim().length > 0);
	let root: Record<string, unknown> | undefined;
	let errorCount = 0;
	let lastError: string | undefined;

	for (const line of lines) {
		try {
			const entry = JSON.parse(line) as { kind?: number; k?: Array<string | number>; v?: unknown };

			if (entry.kind === 0) {
				root = entry.v as Record<string, unknown>;
				continue;
			}

			if (!root) {
				// Patch arrived before any snapshot — nothing to apply to.
				continue;
			}

			const keyPath = Array.isArray(entry.k) ? entry.k : [];

			if (entry.kind === 1) {
				setAtPath(root, keyPath, entry.v);
			} else if (entry.kind === 2) {
				appendAtPath(root, keyPath, entry.v);
			}
		} catch (err) {
			errorCount++;
			lastError = `patch apply failed: ${String(err)}`;
		}
	}

	return { session: root, errorCount, lastError };
}

function setAtPath(root: Record<string, unknown>, path: Array<string | number>, value: unknown): void {
	if (path.length === 0) {
		return;
	}
	const container = getOrCreateContainer(root, path);
	const lastKey = path[path.length - 1];
	(container as Record<string | number, unknown>)[lastKey] = value;
}

function appendAtPath(root: Record<string, unknown>, path: Array<string | number>, items: unknown): void {
	if (path.length === 0) {
		return;
	}
	const container = getOrCreateContainer(root, path) as Record<string | number, unknown>;
	const lastKey = path[path.length - 1];
	if (!Array.isArray(container[lastKey])) {
		container[lastKey] = [];
	}
	const target = container[lastKey] as unknown[];
	if (Array.isArray(items)) {
		target.push(...items);
	} else {
		target.push(items);
	}
}

/** Walks all but the last path segment, creating missing intermediate objects/arrays as needed. */
function getOrCreateContainer(root: Record<string, unknown>, path: Array<string | number>): unknown {
	let cur: Record<string | number, unknown> = root;
	for (let i = 0; i < path.length - 1; i++) {
		const seg = path[i];
		const next = cur[seg];
		if (next === undefined || next === null || typeof next !== 'object') {
			const nextSeg = path[i + 1];
			cur[seg] = typeof nextSeg === 'number' ? [] : {};
		}
		cur = cur[seg] as Record<string | number, unknown>;
	}
	return cur;
}
