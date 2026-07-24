import * as vscode from 'vscode';

/**
 * Shared Atlassian Cloud credentials for the Confluence and Jira integrations.
 * A single Atlassian API token authenticates against every Atlassian product on
 * the same site, so both integrations reuse one email + one token secret.
 *
 * The secret key is kept as the original Confluence key for backward compatibility
 * with tokens stored by earlier versions; the "Set Confluence API Token" command
 * writes to the same key.
 */

export const ATLASSIAN_TOKEN_SECRET_KEY = 'usageLogger.confluenceApiToken';

export interface AtlassianCredentials {
	email: string;
	apiToken: string;
}

/** Resolves the Atlassian account email + API token (email from settings, token from secret storage). */
export async function getAtlassianCredentials(context: vscode.ExtensionContext): Promise<AtlassianCredentials | undefined> {
	const config = vscode.workspace.getConfiguration('usageLogger');
	// `atlassianEmail` is preferred; fall back to the original `confluenceEmail` setting.
	const email = (config.get<string>('atlassianEmail', '').trim() || config.get<string>('confluenceEmail', '').trim());
	const apiToken = (await context.secrets.get(ATLASSIAN_TOKEN_SECRET_KEY))?.trim();
	if (!email || !apiToken) {
		return undefined;
	}
	return { email, apiToken };
}
