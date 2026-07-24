import * as vscode from 'vscode';
import { GITHUB_TOKEN_SECRET_KEY, getGithubConfig, searchGithub } from './githubClient';
import type { GithubSearchType } from './githubText';

interface SearchGithubInput {
	query: string;
	type?: GithubSearchType;
	limit?: number;
}

const VALID_TYPES: GithubSearchType[] = ['issues', 'code', 'repositories'];

/**
 * `search_github` — search the org's GitHub issues/PRs, code, or repositories beyond
 * the open workspace. Scoped to usageLogger.githubOrg when set.
 */
class SearchGithubTool implements vscode.LanguageModelTool<SearchGithubInput> {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<SearchGithubInput>): Promise<vscode.LanguageModelToolResult> {
		const config = await getGithubConfig(this.context);
		if (!config) {
			throw new Error(
				'GitHub is not configured. Run "Copilot Usage: Set GitHub Token" to store a personal access token, and optionally set usageLogger.githubOrg to scope searches.'
			);
		}
		const query = (options.input.query ?? '').trim();
		if (!query) {
			throw new Error('Provide a non-empty "query" describing what to search for on GitHub.');
		}
		const type: GithubSearchType = VALID_TYPES.includes(options.input.type as GithubSearchType)
			? (options.input.type as GithubSearchType)
			: 'issues';
		const results = await searchGithub(config, query, type, options.input.limit ?? 5);
		if (results.length === 0) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`No GitHub ${type} matched "${query}".`)]);
		}
		const lines = results.map((r, i) =>
			`${i + 1}. ${r.title}` + (r.detail ? `\n   ${r.detail}` : '') + `\n   url: ${r.url}`
		);
		const text = `Found ${results.length} GitHub ${type} result(s) for "${query}".\n\n${lines.join('\n\n')}`;
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<SearchGithubInput>): vscode.PreparedToolInvocation {
		const type = options.input.type ?? 'issues';
		return { invocationMessage: `Searching GitHub ${type} for “${(options.input.query ?? '').trim()}”` };
	}
}

/** Registers the GitHub language-model tool and its credential-management commands. */
export function registerGithubIntegration(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.lm.registerTool('search_github', new SearchGithubTool(context)),
		vscode.commands.registerCommand('usageLogger.setGithubToken', async () => {
			const value = await vscode.window.showInputBox({
				title: 'Set GitHub Token',
				prompt: 'GitHub personal access token (classic or fine-grained) with repo/read access. Stored securely, never in settings.json.',
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
			await context.secrets.store(GITHUB_TOKEN_SECRET_KEY, trimmed);
			void vscode.window.showInformationMessage('Copilot Usage Logger: GitHub token saved.');
		}),
		vscode.commands.registerCommand('usageLogger.clearGithubToken', async () => {
			await context.secrets.delete(GITHUB_TOKEN_SECRET_KEY);
			void vscode.window.showInformationMessage('Copilot Usage Logger: GitHub token cleared.');
		})
	);
}
