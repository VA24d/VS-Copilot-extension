import * as vscode from 'vscode';
import type { UsageDb } from '../storage/db';

/** StatusBarItem showing today's request count, updated after each ingest batch. Click opens the dashboard. */
export class UsageStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private privateMode = false;

	constructor(private readonly db: UsageDb) {
		this.item = vscode.window.createStatusBarItem('usageLogger.statusBar', vscode.StatusBarAlignment.Right, 100);
		this.item.name = 'Copilot Usage Logger';
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
			this.item.tooltip = this.buildTooltip(today, todayStart.getTime());
		}
	}

	private buildTooltip(today: number, todayStartMs: number): vscode.MarkdownString {
		const total = this.db.countAll();
		const creditsToday = this.db.creditsSince(todayStartMs);
		const md = new vscode.MarkdownString(undefined, true);
		md.isTrusted = true;
		md.appendMarkdown(`**Copilot Usage Logger**\n\n`);
		md.appendMarkdown(`- Requests today: **${today}**\n`);
		md.appendMarkdown(`- Cost units today: **${Math.round(creditsToday).toLocaleString()}**\n`);

		const budget = this.dailyBudgetInfo(todayStartMs, creditsToday);
		if (budget) {
			md.appendMarkdown(`- Daily budget: \`${budget.bar}\` ${budget.pct}% (${Math.round(creditsToday).toLocaleString()} / ${Math.round(budget.dailyBudget).toLocaleString()})\n`);
			md.appendMarkdown(`- Remaining today: **${Math.round(budget.remainingToday).toLocaleString()}**\n`);
		} else {
			md.appendMarkdown(`- Daily budget: not set (\`usageLogger.monthlyCreditLimit\`)\n`);
		}

		md.appendMarkdown(`- Requests logged all-time: **${total.toLocaleString()}**\n\n`);
		md.appendMarkdown(`Click for the full dashboard.`);
		return md;
	}

	/** Mirrors dashboardPanel's daily-budget math: remaining monthly credits ÷ remaining days in month. */
	private dailyBudgetInfo(todayStartMs: number, creditsToday: number): { dailyBudget: number; remainingToday: number; pct: number; bar: string } | null {
		const monthlyCreditLimit = vscode.workspace.getConfiguration('usageLogger').get<number>('monthlyCreditLimit', 0);
		if (!monthlyCreditLimit || monthlyCreditLimit <= 0) {
			return null;
		}
		const todayStart = new Date(todayStartMs);
		const startOfMonth = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
		const daysInMonth = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 0).getDate();
		const remainingDaysInMonth = daysInMonth - todayStart.getDate() + 1;
		const creditsThisMonth = this.db.creditsSince(startOfMonth.getTime());
		const creditsBeforeToday = Math.max(0, creditsThisMonth - creditsToday);
		// dailyBudget = today's even share of what's left, computed BEFORE today's own spend is deducted —
		// otherwise today's usage gets divided into the pool and then subtracted again below (double-counted).
		const dailyBudget = Math.max(0, monthlyCreditLimit - creditsBeforeToday) / remainingDaysInMonth;
		const remainingToday = Math.max(0, dailyBudget - creditsToday);
		const pct = dailyBudget > 0 ? Math.min(100, Math.round((creditsToday / dailyBudget) * 100)) : (creditsToday > 0 ? 100 : 0);
		const filled = Math.round(pct / 10);
		const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
		return { dailyBudget, remainingToday, pct, bar };
	}

	dispose(): void {
		this.item.dispose();
	}
}

