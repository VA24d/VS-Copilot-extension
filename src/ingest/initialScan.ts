import * as vscode from 'vscode';
import { discoverWorkspaceChatSessionFiles } from '../discovery/sessionFileIndex';
import type { UsageDb } from '../storage/db';
import { ingestSessionFile, type IngestSummary } from './ingestor';

/** One-time (or manually re-triggered) backfill over every discovered session file, wrapped in withProgress. */
export async function runInitialScan(db: UsageDb, workspaceStorageDir: string): Promise<IngestSummary> {
	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Copilot Usage Logger: scanning chat history…',
			cancellable: false
		},
		async (progress) => {
			const files = discoverWorkspaceChatSessionFiles(workspaceStorageDir);
			const total: IngestSummary = { filesScanned: 0, requestsInserted: 0, requestsSkippedExisting: 0, filesWithErrors: 0 };

			let done = 0;
			for (const file of files) {
				const summary = ingestSessionFile(db, file);
				total.filesScanned += summary.filesScanned;
				total.requestsInserted += summary.requestsInserted;
				total.requestsSkippedExisting += summary.requestsSkippedExisting;
				total.filesWithErrors += summary.filesWithErrors;

				done++;
				if (files.length > 0) {
					progress.report({ message: `${done}/${files.length} files`, increment: 100 / files.length });
				}
			}

			db.flush();
			return total;
		}
	);
}
