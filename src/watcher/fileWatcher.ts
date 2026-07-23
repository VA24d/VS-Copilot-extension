import { watch, type FSWatcher } from 'chokidar';
import * as path from 'path';

export type ChatSessionFileChangeHandler = (filePath: string) => void;

/**
 * Watches workspaceStorage chat session files (workspaceStorage/<hash>/chatSessions/<id>.json)
 * for changes. Uses `awaitWriteFinish` for built-in debounce against partial writes (plan
 * scaffolding notes — recursive `fs.watch` is unreliable on Linux, hence
 * chokidar).
 */
export function watchChatSessionFiles(
	workspaceStorageDir: string,
	onChange: ChatSessionFileChangeHandler
): FSWatcher {
	const globPattern = path.join(workspaceStorageDir, '*', 'chatSessions', '*.json').split(path.sep).join('/');

	const watcher = watch(globPattern, {
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
