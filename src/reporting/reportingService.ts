import * as vscode from 'vscode';
import type { UsageDb } from '../storage/db';
import { getOrCreateDeviceId } from './deviceId';
import { sendReportMongo } from './mongoReporter';
import { buildReportPayload } from './payload';
import { sendReport } from './reporter';

const API_KEY_SECRET_KEY = 'usageLogger.reportingApiKey';
export const MONGO_CONNECTION_STRING_SECRET_KEY = 'usageLogger.mongoConnectionString';

/**
 * Opt-in company-wide reporting: periodically (and on-demand) sends an
 * aggregate-only payload (see payload.ts) to either a configured internal
 * HTTP endpoint or a local MongoDB collection, per
 * `usageLogger.reportingTransport`. Disabled by default — must be
 * explicitly enabled with a destination configured, since this is the one
 * part of the extension that sends data off the machine.
 */
export class ReportingService implements vscode.Disposable {
	private timer: NodeJS.Timeout | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly db: UsageDb,
		private readonly outputChannel: vscode.OutputChannel
	) {}

	start(): void {
		this.stop();
		const config = vscode.workspace.getConfiguration('usageLogger');
		if (!config.get<boolean>('enableCompanyWideReporting', false)) {
			return;
		}
		const transport = config.get<string>('reportingTransport', 'http');
		if (transport === 'mongodb') {
			const database = config.get<string>('mongoDatabase', '').trim();
			const collection = config.get<string>('mongoCollection', '').trim();
			if (!database || !collection) {
				this.outputChannel.appendLine('Company-wide reporting (mongodb) is enabled but usageLogger.mongoDatabase/mongoCollection are not set — skipping.');
				return;
			}
		} else {
			const endpointUrl = config.get<string>('reportingEndpointUrl', '').trim();
			if (!endpointUrl) {
				this.outputChannel.appendLine('Company-wide reporting is enabled but usageLogger.reportingEndpointUrl is not set — skipping.');
				return;
			}
		}
		const intervalMinutes = Math.max(5, config.get<number>('reportingIntervalMinutes', 60));
		this.timer = setInterval(() => {
			void this.sendNow();
		}, intervalMinutes * 60 * 1000);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	async sendNow(): Promise<void> {
		const config = vscode.workspace.getConfiguration('usageLogger');
		const transport = config.get<string>('reportingTransport', 'http');
		const windowDays = 30;
		const deviceId = getOrCreateDeviceId(this.context);
		const payload = buildReportPayload(this.db, deviceId, windowDays);

		if (transport === 'mongodb') {
			const connectionString = await this.context.secrets.get(MONGO_CONNECTION_STRING_SECRET_KEY);
			if (!connectionString) {
				void vscode.window.showWarningMessage('Copilot Usage Logger: run "Copilot Usage: Set MongoDB Connection String" before sending a report.');
				return;
			}
			const database = config.get<string>('mongoDatabase', '').trim();
			const collection = config.get<string>('mongoCollection', '').trim();
			if (!database || !collection) {
				void vscode.window.showWarningMessage('Copilot Usage Logger: set usageLogger.mongoDatabase and usageLogger.mongoCollection before sending a report.');
				return;
			}
			const result = await sendReportMongo(payload, { connectionString, database, collection, timeoutMs: 10_000 });
			if (result.ok) {
				this.outputChannel.appendLine('Company-wide report sent to MongoDB.');
			} else {
				this.outputChannel.appendLine(`Company-wide report (MongoDB) failed: ${result.error ?? 'unknown error'}`);
			}
			return;
		}

		const endpointUrl = config.get<string>('reportingEndpointUrl', '').trim();
		if (!endpointUrl) {
			void vscode.window.showWarningMessage('Copilot Usage Logger: set usageLogger.reportingEndpointUrl before sending a report.');
			return;
		}
		const allowInsecureHttp = config.get<boolean>('allowInsecureHttp', false);
		const apiKey = await this.context.secrets.get(API_KEY_SECRET_KEY);

		const result = await sendReport(payload, { endpointUrl, apiKey, allowInsecureHttp, timeoutMs: 10_000 });
		if (result.ok) {
			this.outputChannel.appendLine(`Company-wide report sent (status ${result.statusCode}).`);
		} else {
			this.outputChannel.appendLine(`Company-wide report failed: ${result.error ?? `status ${result.statusCode}`}`);
		}
	}

	async setApiKey(): Promise<void> {
		const value = await vscode.window.showInputBox({
			prompt: 'API key / bearer token for the reporting endpoint (stored securely, not in settings.json)',
			password: true,
			ignoreFocusOut: true
		});
		if (value === undefined) {
			return;
		}
		await this.context.secrets.store(API_KEY_SECRET_KEY, value);
		void vscode.window.showInformationMessage('Copilot Usage Logger: reporting API key saved.');
	}

	async clearApiKey(): Promise<void> {
		await this.context.secrets.delete(API_KEY_SECRET_KEY);
		void vscode.window.showInformationMessage('Copilot Usage Logger: reporting API key cleared.');
	}

	async setMongoConnectionString(): Promise<void> {
		const value = await vscode.window.showInputBox({
			prompt: 'MongoDB connection string (e.g. mongodb://localhost:27017) — stored securely, not in settings.json',
			password: true,
			ignoreFocusOut: true
		});
		if (value === undefined) {
			return;
		}
		await this.context.secrets.store(MONGO_CONNECTION_STRING_SECRET_KEY, value);
		void vscode.window.showInformationMessage('Copilot Usage Logger: MongoDB connection string saved.');
	}

	async clearMongoConnectionString(): Promise<void> {
		await this.context.secrets.delete(MONGO_CONNECTION_STRING_SECRET_KEY);
		void vscode.window.showInformationMessage('Copilot Usage Logger: MongoDB connection string cleared.');
	}

	dispose(): void {
		this.stop();
	}
}
