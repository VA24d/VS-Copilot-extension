import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { formatBlockerRoutes, matchBlockerRoutes } from './blockerText';
import { getBundledSamplePath, getConfiguredDirectoryPath, loadBlockerRoutes } from './blockerRoutes';

interface FindHelpInput {
	query: string;
	limit?: number;
}

/**
 * `find_help` — routes a non-code blocker to the right human/link.
 *
 * When a developer is stuck on something that isn't a code problem — needing
 * access or a permission, a broken/unfamiliar environment, a tooling or process
 * question, onboarding, "who owns X / who do I ask" — this tool matches their
 * description against the org's curated directory and returns the sanctioned
 * contact, Teams chat, intranet page, and/or ServiceNow catalog item, so the
 * model can point them straight at the right place instead of guessing.
 *
 * Purely local and read-only: no network calls, no credentials.
 */
class FindHelpTool implements vscode.LanguageModelTool<FindHelpInput> {
	constructor(private readonly context: vscode.ExtensionContext, private readonly log?: (message: string) => void) {}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<FindHelpInput>): Promise<vscode.LanguageModelToolResult> {
		const query = (options.input.query ?? '').trim();
		if (!query) {
			throw new Error('Provide a non-empty "query" describing the blocker (e.g. "need access to the GCP payments project").');
		}
		const routes = loadBlockerRoutes(this.context, this.log);
		const matches = matchBlockerRoutes(routes, query, options.input.limit ?? 3);
		const text = formatBlockerRoutes(matches, query);
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<FindHelpInput>): vscode.PreparedToolInvocation {
		return { invocationMessage: `Finding who can help with “${(options.input.query ?? '').trim()}”` };
	}
}

/**
 * Registers the `find_help` language-model tool plus a command to open (and, if
 * absent, scaffold) the org's blocker directory from the bundled sample.
 */
export function registerBlockerIntegration(context: vscode.ExtensionContext, log?: (message: string) => void): void {
	context.subscriptions.push(vscode.lm.registerTool('find_help', new FindHelpTool(context, log)));

	context.subscriptions.push(
		vscode.commands.registerCommand('usageLogger.openBlockerDirectory', async () => {
			const configuredPath = getConfiguredDirectoryPath();

			if (!configuredPath) {
				const pick = await vscode.window.showInformationMessage(
					'No help directory configured (usageLogger.blockerDirectoryPath). Open the bundled sample to copy from, or set the path now?',
					'Open Sample',
					'Set Path'
				);
				if (pick === 'Set Path') {
					await vscode.commands.executeCommand('workbench.action.openSettings', 'usageLogger.blockerDirectoryPath');
				} else if (pick === 'Open Sample') {
					const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(getBundledSamplePath(context)));
					await vscode.window.showTextDocument(doc);
				}
				return;
			}

			if (!fs.existsSync(configuredPath)) {
				const create = await vscode.window.showInformationMessage(
					`Help directory not found at ${configuredPath}. Create it from the bundled sample?`,
					'Create',
					'Cancel'
				);
				if (create === 'Create') {
					try {
						fs.mkdirSync(path.dirname(configuredPath), { recursive: true });
						fs.copyFileSync(getBundledSamplePath(context), configuredPath);
					} catch (err) {
						void vscode.window.showErrorMessage(`Copilot Usage Logger: could not create help directory — ${String(err instanceof Error ? err.message : err)}`);
						return;
					}
				} else {
					return;
				}
			}

			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configuredPath));
			await vscode.window.showTextDocument(doc);
		})
	);
}
