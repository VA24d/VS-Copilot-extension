import * as vscode from 'vscode';
import { classify } from '../classify/classifier';
import type { UsageDb } from '../storage/db';
import { USAGE_PARTICIPANT_AGENT_ID } from '../ingest/ingestor';

/**
 * `@usage` chat participant — secondary, fully-controlled capture path
 * (plan: "invoked explicitly"). Logs its own turns directly with
 * `source='participant'`; the passive watcher skips this agent id so the
 * same turn isn't double-counted (see ingestor.ts).
 */
export function registerUsageChatParticipant(context: vscode.ExtensionContext, db: UsageDb): vscode.ChatParticipant {
	const handler: vscode.ChatRequestHandler = async (request, _context, stream, _token) => {
		const promptText = request.prompt;
		const isStats = request.command === 'stats';

		let responseText: string;
		if (isStats) {
			responseText = formatStatsMarkdown(db);
		} else {
			responseText = 'Use `/stats` to see a summary of your local Copilot usage. Full dashboard: run "Copilot Usage: Open Dashboard".';
		}

		stream.markdown(responseText);

		const category = classify(promptText, request.command);
		db.insertRequest({
			sessionId: 'participant',
			requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
			source: 'participant',
			workspaceHash: undefined,
			workspacePath: undefined,
			timestamp: Date.now(),
			category,
			language: 'unknown',
			modelId: request.model?.id,
			agentId: USAGE_PARTICIPANT_AGENT_ID,
			agentName: 'usage',
			promptText,
			responseText,
			attachmentsJson: '[]',
			schemaVersionSeen: 0
		});
		db.flush();

		return {};
	};

	const participant = vscode.chat.createChatParticipant(USAGE_PARTICIPANT_AGENT_ID, handler);
	context.subscriptions.push(participant);
	return participant;
}

function formatStatsMarkdown(db: UsageDb): string {
	const total = db.countAll();
	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);
	const today = db.countSince(todayStart.getTime());
	const byCategory = db.groupByCategory().slice(0, 5);

	const lines = [
		`**Copilot usage (local, this machine)**`,
		``,
		`- Total logged requests: ${total}`,
		`- Today: ${today}`,
		``,
		`Top categories:`,
		...byCategory.map(c => `- ${c.category}: ${c.count}`)
	];
	return lines.join('\n');
}
