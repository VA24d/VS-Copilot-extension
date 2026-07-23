import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Derives the `<user-data-dir>/User` directory (e.g. `~/Library/Application Support/Code/User`
 * on macOS) purely from extension API, with no OS-specific hardcoding.
 *
 * `context.globalStorageUri` resolves to
 * `<user-data-dir>/User/globalStorage/<publisher>.<name>`, so walking up two
 * segments gives the `User` directory that holds `workspaceStorage/` and
 * `globalStorage/emptyWindowChatSessions/`.
 */
export function locateUserDataDir(context: vscode.ExtensionContext): string {
	return path.join(context.globalStorageUri.fsPath, '..', '..');
}

export function workspaceStorageRoot(userDataDir: string): string {
	return path.join(userDataDir, 'workspaceStorage');
}

export function emptyWindowChatSessionsRoot(userDataDir: string): string {
	return path.join(userDataDir, 'globalStorage', 'emptyWindowChatSessions');
}
