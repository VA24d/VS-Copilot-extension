import * as fs from 'fs';
import * as path from 'path';

/**
 * Discovers `workspaceStorage/<hash>/chatSessions/<id>.json` files under the
 * VS Code `User` directory. MVP scope only walks the workspace-scoped chat
 * session snapshots (see plan §Key risks 1) — `emptyWindowChatSessions/*.jsonl`
 * is a fast-follow.
 */
export function discoverWorkspaceChatSessionFiles(workspaceStorageDir: string): string[] {
	const results: string[] = [];

	let workspaceHashDirs: fs.Dirent[];
	try {
		workspaceHashDirs = fs.readdirSync(workspaceStorageDir, { withFileTypes: true });
	} catch {
		return results;
	}

	for (const hashDir of workspaceHashDirs) {
		if (!hashDir.isDirectory()) {
			continue;
		}
		const chatSessionsDir = path.join(workspaceStorageDir, hashDir.name, 'chatSessions');
		let sessionFiles: fs.Dirent[];
		try {
			sessionFiles = fs.readdirSync(chatSessionsDir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const file of sessionFiles) {
			if (file.isFile() && file.name.endsWith('.json')) {
				results.push(path.join(chatSessionsDir, file.name));
			}
		}
	}

	return results;
}

/** Best-effort extraction of the workspace hash segment from a chat session file path. */
export function workspaceHashFromSessionFilePath(filePath: string): string | undefined {
	const parts = filePath.split(path.sep);
	const idx = parts.lastIndexOf('workspaceStorage');
	if (idx >= 0 && parts.length > idx + 1) {
		return parts[idx + 1];
	}
	return undefined;
}
