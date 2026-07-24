import * as vscode from 'vscode';
import { GRAPH_TOKEN_SECRET_KEY, getGraphConfig, searchSharePoint, searchTeams } from './graphClient';

interface SearchInput {
	query: string;
	limit?: number;
}

const NOT_CONFIGURED_MESSAGE =
	'Microsoft Graph is not configured. Run "Copilot Usage: Set Microsoft Graph Token" to store an access token ' +
	'(e.g. from `az account get-access-token --resource https://graph.microsoft.com`).';

/**
 * `search_sharepoint` — free-text search over the org's SharePoint/OneDrive documents
 * via Microsoft Graph.
 */
class SearchSharePointTool implements vscode.LanguageModelTool<SearchInput> {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<SearchInput>): Promise<vscode.LanguageModelToolResult> {
		const config = await getGraphConfig(this.context);
		if (!config) {
			throw new Error(NOT_CONFIGURED_MESSAGE);
		}
		const query = (options.input.query ?? '').trim();
		if (!query) {
			throw new Error('Provide a non-empty "query" describing what to look for in SharePoint.');
		}
		const results = await searchSharePoint(config, query, options.input.limit ?? 5);
		if (results.length === 0) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`No SharePoint documents matched "${query}".`)]);
		}
		const lines = results.map((r, i) => `${i + 1}. ${r.title}` + (r.detail ? `\n   ${r.detail}` : '') + `\n   url: ${r.url}`);
		const text = `Found ${results.length} SharePoint document(s) for "${query}".\n\n${lines.join('\n\n')}`;
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<SearchInput>): vscode.PreparedToolInvocation {
		return { invocationMessage: `Searching SharePoint for “${(options.input.query ?? '').trim()}”` };
	}
}

/**
 * `search_teams` — free-text search over the org's Microsoft Teams chat/channel
 * messages via Microsoft Graph.
 */
class SearchTeamsTool implements vscode.LanguageModelTool<SearchInput> {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<SearchInput>): Promise<vscode.LanguageModelToolResult> {
		const config = await getGraphConfig(this.context);
		if (!config) {
			throw new Error(NOT_CONFIGURED_MESSAGE);
		}
		const query = (options.input.query ?? '').trim();
		if (!query) {
			throw new Error('Provide a non-empty "query" describing what to look for in Teams messages.');
		}
		const results = await searchTeams(config, query, options.input.limit ?? 5);
		if (results.length === 0) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`No Teams messages matched "${query}".`)]);
		}
		const lines = results.map((r, i) => `${i + 1}. ${r.title}` + (r.detail ? `\n   ${r.detail}` : '') + `\n   url: ${r.url}`);
		const text = `Found ${results.length} Teams message(s) for "${query}".\n\n${lines.join('\n\n')}`;
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<SearchInput>): vscode.PreparedToolInvocation {
		return { invocationMessage: `Searching Teams messages for “${(options.input.query ?? '').trim()}”` };
	}
}

/** Registers the Microsoft Graph (SharePoint + Teams) language-model tools and credential-management commands. */
export function registerGraphIntegration(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.lm.registerTool('search_sharepoint', new SearchSharePointTool(context)),
		vscode.lm.registerTool('search_teams', new SearchTeamsTool(context))
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('usageLogger.setGraphToken', async () => {
			const value = await vscode.window.showInputBox({
				title: 'Set Microsoft Graph Token',
				prompt: 'Microsoft Graph access token (delegated, e.g. from `az account get-access-token --resource https://graph.microsoft.com`). ' +
					'Short-lived — you will need to refresh it periodically. Stored securely, never in settings.json.',
				password: true,
				ignoreFocusOut: true
			});
			if (value === undefined) {
				return;
			}
			const trimmed = value.trim();
			if (!trimmed) {
				void vscode.window.showWarningMessage('Copilot Usage Logger: no token entered — nothing saved.');
				return;
			}
			await context.secrets.store(GRAPH_TOKEN_SECRET_KEY, trimmed);
			void vscode.window.showInformationMessage('Copilot Usage Logger: Microsoft Graph token saved.');
		}),
		vscode.commands.registerCommand('usageLogger.clearGraphToken', async () => {
			await context.secrets.delete(GRAPH_TOKEN_SECRET_KEY);
			void vscode.window.showInformationMessage('Copilot Usage Logger: Microsoft Graph token cleared.');
		}),
		vscode.commands.registerCommand('usageLogger.testGraphConnection', async () => {
			const config = await getGraphConfig(context);
			if (!config) {
				void vscode.window.showWarningMessage('Copilot Usage Logger: set a Microsoft Graph token first (Copilot Usage: Set Microsoft Graph Token).');
				return;
			}
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Testing Microsoft Graph connection…' },
				async () => {
					try {
						const results = await searchSharePoint(config, 'test', 1);
						void vscode.window.showInformationMessage(
							`Copilot Usage Logger: Microsoft Graph connection OK (SharePoint search returned ${results.length} result(s)).`
						);
					} catch (err) {
						void vscode.window.showErrorMessage(`Copilot Usage Logger: Microsoft Graph connection failed — ${String(err instanceof Error ? err.message : err)}`);
					}
				}
			);
		})
	);
}
