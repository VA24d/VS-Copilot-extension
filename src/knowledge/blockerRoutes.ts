import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseBlockerDirectory, type BlockerRoute } from './blockerText';

/**
 * Loads the org's "blocker directory" — the curated list of who-to-contact /
 * what-link routing entries used by the `find_help` skill. This is a purely
 * local, read-only lookup: no network, no credentials.
 *
 * Sources, merged in this order (later ones are appended, earlier ones win on
 * ties because matching is stable):
 *  1. `usageLogger.blockerDirectory` — an inline array in settings.
 *  2. `usageLogger.blockerDirectoryPath` — a JSON file (absolute, or relative to
 *     the first workspace folder). Lets a team commit/share a directory in-repo.
 *  3. The bundled `media/blocker-directory.sample.json` starter, used only when
 *     neither of the above yields any entries, so the skill works out of the box.
 *
 * Security notes:
 * - Only files the user's own settings point at are read; nothing is fetched.
 * - `parseBlockerDirectory` drops any link whose scheme isn't in an allowlist
 *   (https/http/msteams/mailto), so a malicious directory can't smuggle a
 *   `javascript:`/`file:` link into a rendered suggestion.
 * - Read failures degrade gracefully to the remaining sources; they never throw
 *   out of the tool invocation.
 */

const BUNDLED_SAMPLE_RELATIVE = 'media/blocker-directory.sample.json';

function readJsonFileSafely(filePath: string, log?: (message: string) => void): unknown {
	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		return JSON.parse(raw);
	} catch (err) {
		log?.(`find_help: could not read/parse blocker directory at ${filePath} — ${String(err instanceof Error ? err.message : err)}`);
		return undefined;
	}
}

function resolveDirectoryPath(configuredPath: string): string | undefined {
	const trimmed = configuredPath.trim();
	if (!trimmed) {
		return undefined;
	}
	if (path.isAbsolute(trimmed)) {
		return trimmed;
	}
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return undefined;
	}
	return path.join(folder.uri.fsPath, trimmed);
}

/** Absolute path to the configured directory file, if any (for the "open" command). */
export function getConfiguredDirectoryPath(): string | undefined {
	const configured = vscode.workspace.getConfiguration('usageLogger').get<string>('blockerDirectoryPath', '');
	return resolveDirectoryPath(configured ?? '');
}

/** Absolute path to the bundled sample directory shipped with the extension. */
export function getBundledSamplePath(context: vscode.ExtensionContext): string {
	return vscode.Uri.joinPath(context.extensionUri, BUNDLED_SAMPLE_RELATIVE).fsPath;
}

/**
 * Loads and merges the blocker directory from all configured sources.
 * Returns an empty array only if every source is absent/unreadable.
 */
export function loadBlockerRoutes(context: vscode.ExtensionContext, log?: (message: string) => void): BlockerRoute[] {
	const config = vscode.workspace.getConfiguration('usageLogger');
	const routes: BlockerRoute[] = [];

	const inline = config.get<unknown[]>('blockerDirectory', []);
	if (Array.isArray(inline) && inline.length > 0) {
		routes.push(...parseBlockerDirectory(inline));
	}

	const filePath = resolveDirectoryPath(config.get<string>('blockerDirectoryPath', '') ?? '');
	if (filePath) {
		const parsed = readJsonFileSafely(filePath, log);
		if (parsed !== undefined) {
			routes.push(...parseBlockerDirectory(parsed));
		}
	}

	if (routes.length === 0) {
		const sample = readJsonFileSafely(getBundledSamplePath(context), log);
		if (sample !== undefined) {
			routes.push(...parseBlockerDirectory(sample));
		}
	}

	return routes;
}
