import * as vscode from 'vscode';
import type { UsageDb } from '../storage/db';

/** StatusBarItem showing today's request count, updated after each ingest batch. Click opens the dashboard. */
export class UsageStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private privateMode = false;

	constructor(private readonly db: UsageDb) {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.item.command = 'usageLogger.openDashboard';
		this.item.tooltip = 'Copilot usage today — click for dashboard';
		this.item.show();
		this.refresh();
	}

	setPrivateMode(enabled: boolean): void {
		this.privateMode = enabled;
		this.refresh();
	}

	refresh(): void {
		const todayStart = new Date();
		todayStart.setHours(0, 0, 0, 0);
		const today = this.db.countSince(todayStart.getTime());
		if (this.privateMode) {
			this.item.text = `$(lock) Private mode`;
			this.item.tooltip = 'Copilot Usage Logger: private mode is ON — logging is paused. Click for dashboard.';
		} else {
			this.item.text = `$(copilot) ${today} today`;
			this.item.tooltip = 'Copilot usage today — click for dashboard';
		}
	}

	dispose(): void {
		this.item.dispose();
	}
}
