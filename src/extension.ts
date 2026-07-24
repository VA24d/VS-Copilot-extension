import * as path from 'path';
import * as vscode from 'vscode';
import { locateUserDataDir, workspaceStorageRoot } from './discovery/locateUserDataDir';
import { buildAuditCsv } from './export/csvExport';
import { ingestSessionFile, type IngestOptions } from './ingest/ingestor';
import { runInitialScan } from './ingest/initialScan';
import { registerUsageChatParticipant } from './participant/usageChatParticipant';
import { CompanyDashboardPanel } from './reporting/companyDashboardPanel';
import { syncActualCreditsUsed } from './reporting/creditsSync';
import { ReportingService } from './reporting/reportingService';
import { UsageDb } from './storage/db';
import { DashboardPanel } from './ui/dashboardPanel';
import { UsageStatusBar } from './ui/statusBar';
import { watchChatSessionFiles } from './watcher/fileWatcher';
import type { FSWatcher } from 'chokidar';

let outputChannel: vscode.OutputChannel;

function getIngestOptions(): IngestOptions {
	const config = vscode.workspace.getConfiguration('usageLogger');
	return {
		privateMode: config.get<boolean>('privateMode', false),
		excludedPathGlobs: config.get<string[]>('excludedPathGlobs', []),
		sensitiveLabelKeywords: config.get<string[]>('sensitiveLabelKeywords', [])
	};
}

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

	const statusBar = new UsageStatusBar(db, context);
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

	const reportingService = new ReportingService(context, db, outputChannel);
	context.subscriptions.push(reportingService);

	context.subscriptions.push(
		vscode.commands.registerCommand('usageLogger.openDashboard', () => {
			DashboardPanel.createOrShow(context, db);
		}),
		vscode.commands.registerCommand('usageLogger.openCompanyDashboard', () => {
			CompanyDashboardPanel.createOrShow(context);
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
		}),
		vscode.commands.registerCommand('usageLogger.sendReportNow', () => reportingService.sendNow()),
		vscode.commands.registerCommand('usageLogger.setReportingApiKey', () => reportingService.setApiKey()),
		vscode.commands.registerCommand('usageLogger.clearReportingApiKey', () => reportingService.clearApiKey()),
		vscode.commands.registerCommand('usageLogger.setMongoConnectionString', () => reportingService.setMongoConnectionString()),
		vscode.commands.registerCommand('usageLogger.clearMongoConnectionString', () => reportingService.clearMongoConnectionString()),
		vscode.commands.registerCommand('usageLogger.togglePrivateMode', async () => {
			const config = vscode.workspace.getConfiguration('usageLogger');
			const current = config.get<boolean>('privateMode', false);
			await config.update('privateMode', !current, vscode.ConfigurationTarget.Global);
			statusBar.setPrivateMode(!current);
			void vscode.window.showInformationMessage(`Copilot Usage Logger: private mode ${!current ? 'ON — logging paused' : 'OFF — logging resumed'}.`);
			if (current) {
				// Was on, now turning off: catch up on anything that happened while paused.
				const summary = await runInitialScan(db, workspaceStorageDir, getIngestOptions());
				statusBar.refresh();
				if (DashboardPanel.currentPanel) {
					DashboardPanel.currentPanel.refresh();
				}
				outputChannel.appendLine(`Private mode off — caught up: ${summary.requestsInserted} request(s) logged.`);
			}
		}),
		vscode.commands.registerCommand('usageLogger.syncActualCredits', async () => {
			await syncActualCreditsUsed(context, db);
			statusBar.refresh();
			if (DashboardPanel.currentPanel) {
				DashboardPanel.currentPanel.refresh();
			}
		}),
		vscode.commands.registerCommand('usageLogger.exportAuditCsv', async () => {
			const csv = buildAuditCsv(db);
			const uri = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file(`copilot-usage-audit-${new Date().toISOString().slice(0, 10)}.csv`),
				filters: { 'CSV': ['csv'] }
			});
			if (!uri) {
				return;
			}
			await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf8'));
			void vscode.window.showInformationMessage(`Copilot Usage Logger: audit CSV exported to ${uri.fsPath} (metadata only — no prompt/response text).`);
		})
	);

	const config = vscode.workspace.getConfiguration('usageLogger');
	statusBar.setPrivateMode(config.get<boolean>('privateMode', false));

	reportingService.start();
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('usageLogger.enableCompanyWideReporting') ||
				e.affectsConfiguration('usageLogger.reportingEndpointUrl') ||
				e.affectsConfiguration('usageLogger.reportingIntervalMinutes') ||
				e.affectsConfiguration('usageLogger.reportingTransport') ||
				e.affectsConfiguration('usageLogger.mongoDatabase') ||
				e.affectsConfiguration('usageLogger.mongoCollection')) {
				reportingService.start();
			}
			if (e.affectsConfiguration('usageLogger.privateMode')) {
				statusBar.setPrivateMode(vscode.workspace.getConfiguration('usageLogger').get<boolean>('privateMode', false));
			}
		})
	);

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
	void runInitialScan(db, workspaceStorageDir, getIngestOptions()).then((summary) => {
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
				ingestSessionFile(db, filePath, getIngestOptions());
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
