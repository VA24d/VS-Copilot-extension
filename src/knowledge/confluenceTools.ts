import * as vscode from 'vscode';
import {
	CONFLUENCE_TOKEN_SECRET_KEY,
	getConfluenceConfig,
	getConfluencePage,
	searchConfluence
} from './confluenceClient';

/** Max characters of page body returned to the model, to keep tool results within token budgets. */
const MAX_PAGE_CHARS = 8000;

interface SearchConfluenceInput {
	query: string;
	limit?: number;
}

interface GetConfluencePageInput {
	pageId: string;
}

/**
 * `search_confluence` — free-text search over the org's Confluence knowledge base.
 * Returns a ranked list of matching pages (title, id, url, excerpt) so the model can
 * decide which page(s) to open with `get_confluence_page`.
 */
class SearchConfluenceTool implements vscode.LanguageModelTool<SearchConfluenceInput> {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<SearchConfluenceInput>
	): Promise<vscode.LanguageModelToolResult> {
		const config = await getConfluenceConfig(this.context);
		if (!config) {
			throw new Error(
				'Confluence is not configured. Set usageLogger.confluenceBaseUrl and usageLogger.confluenceEmail in settings, then run "Copilot Usage: Set Confluence API Token".'
			);
		}
		const query = (options.input.query ?? '').trim();
		if (!query) {
			throw new Error('Provide a non-empty "query" describing what to look for in Confluence.');
		}
		const results = await searchConfluence(config, query, options.input.limit ?? 5);
		if (results.length === 0) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`No Confluence pages matched "${query}".`)
			]);
		}
		const lines = results.map((r, i) =>
			`${i + 1}. ${r.title}\n   id: ${r.id}\n   url: ${r.url}` +
			(r.excerpt ? `\n   excerpt: ${r.excerpt}` : '')
		);
		const text =
			`Found ${results.length} Confluence page(s) for "${query}". ` +
			`Use get_confluence_page with an id to read full content.\n\n${lines.join('\n\n')}`;
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
	}

	prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<SearchConfluenceInput>
	): vscode.PreparedToolInvocation {
		return {
			invocationMessage: `Searching Confluence for “${(options.input.query ?? '').trim()}”`
		};
	}
}

/**
 * `get_confluence_page` — fetch the full text of one Confluence page by numeric id
 * (as returned by `search_confluence`). Body is HTML-stripped and length-capped.
 */
class GetConfluencePageTool implements vscode.LanguageModelTool<GetConfluencePageInput> {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<GetConfluencePageInput>
	): Promise<vscode.LanguageModelToolResult> {
		const config = await getConfluenceConfig(this.context);
		if (!config) {
			throw new Error(
				'Confluence is not configured. Set usageLogger.confluenceBaseUrl and usageLogger.confluenceEmail in settings, then run "Copilot Usage: Set Confluence API Token".'
			);
		}
		const pageId = (options.input.pageId ?? '').trim();
		if (!pageId) {
			throw new Error('Provide a numeric "pageId" (from search_confluence results).');
		}
		const page = await getConfluencePage(config, pageId);
		let body = page.text;
		let truncatedNote = '';
		if (body.length > MAX_PAGE_CHARS) {
			body = body.slice(0, MAX_PAGE_CHARS);
			truncatedNote = `\n\n[Truncated to ${MAX_PAGE_CHARS} characters. Refine your question or search for a more specific page if you need the rest.]`;
		}
		const text =
			`# ${page.title}` +
			(page.spaceKey ? ` (space: ${page.spaceKey})` : '') +
			`\nurl: ${page.url}\n\n${body}${truncatedNote}`;
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
	}

	prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<GetConfluencePageInput>
	): vscode.PreparedToolInvocation {
		return {
			invocationMessage: `Reading Confluence page ${(options.input.pageId ?? '').trim()}`
		};
	}
}

/** Registers the Confluence language-model tools and the credential-management commands. */
export function registerConfluenceIntegration(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.lm.registerTool('search_confluence', new SearchConfluenceTool(context)),
		vscode.lm.registerTool('get_confluence_page', new GetConfluencePageTool(context))
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('usageLogger.setConfluenceApiToken', async () => {
			const value = await vscode.window.showInputBox({
				title: 'Set Confluence API Token',
				prompt: 'Atlassian API token (create at https://id.atlassian.com/manage/api-tokens). Stored securely, never in settings.json.',
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
			await context.secrets.store(CONFLUENCE_TOKEN_SECRET_KEY, trimmed);
			void vscode.window.showInformationMessage('Copilot Usage Logger: Confluence API token saved.');
		}),
		vscode.commands.registerCommand('usageLogger.clearConfluenceApiToken', async () => {
			await context.secrets.delete(CONFLUENCE_TOKEN_SECRET_KEY);
			void vscode.window.showInformationMessage('Copilot Usage Logger: Confluence API token cleared.');
		}),
		vscode.commands.registerCommand('usageLogger.testConfluenceConnection', async () => {
			const config = await getConfluenceConfig(context);
			if (!config) {
				void vscode.window.showWarningMessage(
					'Copilot Usage Logger: set usageLogger.confluenceBaseUrl, usageLogger.confluenceEmail, and the Confluence API token first.'
				);
				return;
			}
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Testing Confluence connection…' },
				async () => {
					try {
						const results = await searchConfluence(config, 'test', 1);
						void vscode.window.showInformationMessage(
							`Copilot Usage Logger: Confluence connection OK (search returned ${results.length} result(s)).`
						);
					} catch (err) {
						void vscode.window.showErrorMessage(`Copilot Usage Logger: Confluence connection failed — ${String(err instanceof Error ? err.message : err)}`);
					}
				}
			);
		})
	);
}
