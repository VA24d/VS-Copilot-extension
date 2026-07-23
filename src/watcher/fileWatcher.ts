import { watch, type FSWatcher } from 'chokidar';
import * as path from 'path';

export type ChatSessionFileChangeHandler = (filePath: string) => void;

/**
 * Watches workspaceStorage chat session files
 * (workspaceStorage/<hash>/chatSessions/<id>.{json,jsonl}) for changes. Real
 * VS Code 1.130 insider profiles write these as append-only `.jsonl` patch
 * logs, so both extensions are watched defensively. Uses `awaitWriteFinish`
 * for built-in debounce against partial writes (plan scaffolding notes —
 * recursive `fs.watch` is unreliable on Linux, hence chokidar).
 */
export function watchChatSessionFiles(
	workspaceStorageDir: string,
	onChange: ChatSessionFileChangeHandler
): FSWatcher {
	const globPatterns = ['*.json', '*.jsonl'].map(ext =>
		path.join(workspaceStorageDir, '*', 'chatSessions', ext).split(path.sep).join('/')
	);

	const watcher = watch(globPatterns, {
		ignoreInitial: true,
		awaitWriteFinish: {
			stabilityThreshold: 500,
			pollInterval: 100
		}
	});

	watcher.on('add', onChange);
	watcher.on('change', onChange);

	return watcher;
}
