import * as path from 'path';
import * as vscode from 'vscode';
import { locateUserDataDir, workspaceStorageRoot } from './discovery/locateUserDataDir';
import { ingestSessionFile } from './ingest/ingestor';
import { runInitialScan } from './ingest/initialScan';
import { registerUsageChatParticipant } from './participant/usageChatParticipant';
import { UsageDb } from './storage/db';
import { DashboardPanel } from './ui/dashboardPanel';
import { UsageStatusBar } from './ui/statusBar';
import { watchChatSessionFiles } from './watcher/fileWatcher';
import type { FSWatcher } from 'chokidar';

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	outputChannel = vscode.window.createOutputChannel('Copilot Usage Logger');
	context.subscriptions.push(outputChannel);

	// Remote windows: context.globalStorageUri resolves remote-side and may not match
	// local chat activity. No-op gracefully for MVP (plan §Key risks 6).
	if (vscode.env.remoteName) {
		outputChannel.appendLine(`Remote window detected ("${vscode.env.remoteName}") — Copilot Usage Logger is local-windows-only for now, not activating capture.`);
		return;
	}

	const userDataDir = locateUserDataDir(context);
	const workspaceStorageDir = workspaceStorageRoot(userDataDir);
	const wasmPath = path.join(context.extensionUri.fsPath, 'dist', 'sql-wasm.wasm');
	const dbFilePath = path.join(context.globalStorageUri.fsPath, 'usage.sqlite');

	let db: UsageDb;
	try {
		db = await UsageDb.create(wasmPath, dbFilePath);
	} catch (err) {
		outputChannel.appendLine(`Failed to initialize database: ${String(err)}`);
		void vscode.window.showErrorMessage('Copilot Usage Logger: failed to initialize local database. See "Copilot Usage Logger" output channel.');
		return;
	}
	context.subscriptions.push({ dispose: () => db.dispose() });

	const statusBar = new UsageStatusBar(db);
	context.subscriptions.push(statusBar);

	let flushTimer: NodeJS.Timeout | undefined;
	const scheduleFlush = () => {
		if (flushTimer) {
			clearTimeout(flushTimer);
		}
		flushTimer = setTimeout(() => {
			db.flush();
			statusBar.refresh();
			if (DashboardPanel.currentPanel) {
				DashboardPanel.currentPanel.refresh();
			}
		}, 1500);
	};
	context.subscriptions.push({ dispose: () => { if (flushTimer) { clearTimeout(flushTimer); } } });

	registerUsageChatParticipant(context, db);

	context.subscriptions.push(
		vscode.commands.registerCommand('usageLogger.openDashboard', () => {
			DashboardPanel.createOrShow(context, db);
		}),
		vscode.commands.registerCommand('usageLogger.rescanHistory', async () => {
			const summary = await runInitialScan(db, workspaceStorageDir);
			statusBar.refresh();
			if (DashboardPanel.currentPanel) {
				DashboardPanel.currentPanel.refresh();
			}
			void vscode.window.showInformationMessage(
				`Copilot Usage Logger: scanned ${summary.filesScanned} file(s), logged ${summary.requestsInserted} new request(s)` +
				(summary.filesWithErrors > 0 ? `, ${summary.filesWithErrors} file(s) had parse errors (see output channel)` : '') +
				'.'
			);
		}),
		vscode.commands.registerCommand('usageLogger.purgeData', async () => {
			const confirm = await vscode.window.showWarningMessage(
				'Delete all locally logged Copilot usage data? This cannot be undone.',
				{ modal: true },
				'Delete'
			);
			if (confirm !== 'Delete') {
				return;
			}
			db.purgeAll();
			db.flush();
			statusBar.refresh();
			if (DashboardPanel.currentPanel) {
				DashboardPanel.currentPanel.refresh();
			}
			void vscode.window.showInformationMessage('Copilot Usage Logger: all logged data deleted.');
		})
	);

	const config = vscode.workspace.getConfiguration('usageLogger');

	// Retention sweep on activation (near-MVP per plan, since full raw text is stored).
	const retentionDays = config.get<number>('retentionDays', 0);
	if (retentionDays > 0) {
		const purged = db.applyRetention(retentionDays);
		if (purged > 0) {
			outputChannel.appendLine(`Retention: purged ${purged} request(s) older than ${retentionDays} day(s).`);
			db.flush();
		}
	}

	// Initial backfill so the DB isn't empty on first install, without blocking activation.
	void runInitialScan(db, workspaceStorageDir).then((summary) => {
		outputChannel.appendLine(`Initial scan: ${summary.filesScanned} file(s), ${summary.requestsInserted} request(s) logged, ${summary.filesWithErrors} file(s) with errors.`);
		statusBar.refresh();
		if (DashboardPanel.currentPanel) {
			DashboardPanel.currentPanel.refresh();
		}
	});

	let watcher: FSWatcher | undefined;
	if (config.get<boolean>('enablePassiveCapture', true)) {
		watcher = watchChatSessionFiles(workspaceStorageDir, (filePath) => {
			try {
				ingestSessionFile(db, filePath);
				scheduleFlush();
			} catch (err) {
				outputChannel.appendLine(`Ingest failed for ${filePath}: ${String(err)}`);
			}
		});
		context.subscriptions.push({ dispose: () => { void watcher?.close(); } });
	}
}

export function deactivate(): void {
	// Individual disposables (db.dispose() flushes, watcher.close()) are registered
	// via context.subscriptions and run automatically on deactivation.
}
