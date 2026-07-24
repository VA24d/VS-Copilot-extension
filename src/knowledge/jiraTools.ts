import * as vscode from 'vscode';
import { getJiraConfig, getJiraIssue, searchJira } from './jiraClient';

/** Max characters of issue description returned to the model, to keep tool results within token budgets. */
const MAX_ISSUE_CHARS = 6000;

interface SearchJiraInput {
	query: string;
	limit?: number;
}

interface GetJiraIssueInput {
	issueKey: string;
}

const NOT_CONFIGURED =
	'Jira is not configured. Set usageLogger.jiraBaseUrl (and usageLogger.confluenceEmail / usageLogger.atlassianEmail) in settings, then run "Copilot Usage: Set Confluence API Token" (the same Atlassian token works for Jira).';

/** `search_jira` — free-text search over the org's Jira issues, most-recently-updated first. */
class SearchJiraTool implements vscode.LanguageModelTool<SearchJiraInput> {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<SearchJiraInput>): Promise<vscode.LanguageModelToolResult> {
		const config = await getJiraConfig(this.context);
		if (!config) {
			throw new Error(NOT_CONFIGURED);
		}
		const query = (options.input.query ?? '').trim();
		if (!query) {
			throw new Error('Provide a non-empty "query" describing the issue(s) to find in Jira.');
		}
		const results = await searchJira(config, query, options.input.limit ?? 5);
		if (results.length === 0) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`No Jira issues matched "${query}".`)]);
		}
		const lines = results.map((r, i) =>
			`${i + 1}. ${r.key} — ${r.summary}\n   type: ${r.issueType ?? 'n/a'} | status: ${r.status ?? 'n/a'}` +
			(r.assignee ? ` | assignee: ${r.assignee}` : '') +
			`\n   url: ${r.url}`
		);
		const text =
			`Found ${results.length} Jira issue(s) for "${query}". ` +
			`Use get_jira_issue with a key (e.g. ${results[0].key}) to read full details.\n\n${lines.join('\n\n')}`;
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<SearchJiraInput>): vscode.PreparedToolInvocation {
		return { invocationMessage: `Searching Jira for “${(options.input.query ?? '').trim()}”` };
	}
}

/** `get_jira_issue` — full details of one Jira issue by key (e.g. PROJ-123). */
class GetJiraIssueTool implements vscode.LanguageModelTool<GetJiraIssueInput> {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<GetJiraIssueInput>): Promise<vscode.LanguageModelToolResult> {
		const config = await getJiraConfig(this.context);
		if (!config) {
			throw new Error(NOT_CONFIGURED);
		}
		const issueKey = (options.input.issueKey ?? '').trim();
		if (!issueKey) {
			throw new Error('Provide a Jira "issueKey" like "PROJ-123" (from search_jira results).');
		}
		const issue = await getJiraIssue(config, issueKey);
		let description = issue.description || '(no description)';
		let truncatedNote = '';
		if (description.length > MAX_ISSUE_CHARS) {
			description = description.slice(0, MAX_ISSUE_CHARS);
			truncatedNote = `\n\n[Description truncated to ${MAX_ISSUE_CHARS} characters.]`;
		}
		const meta = [
			`type: ${issue.issueType ?? 'n/a'}`,
			`status: ${issue.status ?? 'n/a'}`,
			issue.priority ? `priority: ${issue.priority}` : '',
			issue.assignee ? `assignee: ${issue.assignee}` : '',
			issue.reporter ? `reporter: ${issue.reporter}` : ''
		].filter(Boolean).join(' | ');
		const text = `# ${issue.key} — ${issue.summary}\n${meta}\nurl: ${issue.url}\n\n${description}${truncatedNote}`;
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<GetJiraIssueInput>): vscode.PreparedToolInvocation {
		return { invocationMessage: `Reading Jira issue ${(options.input.issueKey ?? '').trim()}` };
	}
}

/** Registers the Jira language-model tools and the connection-test command. */
export function registerJiraIntegration(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.lm.registerTool('search_jira', new SearchJiraTool(context)),
		vscode.lm.registerTool('get_jira_issue', new GetJiraIssueTool(context)),
		vscode.commands.registerCommand('usageLogger.testJiraConnection', async () => {
			const config = await getJiraConfig(context);
			if (!config) {
				void vscode.window.showWarningMessage(
					'Copilot Usage Logger: set usageLogger.jiraBaseUrl, an Atlassian email, and the Atlassian API token first.'
				);
				return;
			}
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Testing Jira connection…' },
				async () => {
					try {
						const results = await searchJira(config, 'test', 1);
						void vscode.window.showInformationMessage(
							`Copilot Usage Logger: Jira connection OK (search returned ${results.length} result(s)).`
						);
					} catch (err) {
						void vscode.window.showErrorMessage(`Copilot Usage Logger: Jira connection failed — ${String(err instanceof Error ? err.message : err)}`);
					}
				}
			);
		})
	);
}
