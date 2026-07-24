import * as vscode from 'vscode';
import { getOtherDevicesCreditsThisMonth, getSyncStateThisMonth } from '../reporting/creditsSync';
import type { UsageDb } from '../storage/db';

interface DailyBudgetInfo {
	dailyBudget: number;
	remainingToday: number;
	pct: number;
	bar: string;
	otherDevicesCredits: number;
	syncedAt: number | undefined;
}

/** StatusBarItem showing today's request count (or, if usageLogger.statusBarDisplay is 'remainingCredits', remaining cost-unit budget for today), updated after each ingest batch. Click opens the dashboard. */
export class UsageStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private privateMode = false;

	constructor(private readonly db: UsageDb, private readonly context: vscode.ExtensionContext) {
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
			this.item.backgroundColor = undefined;
		} else {
			const creditsToday = this.db.creditsSince(todayStart.getTime());
			const budget = this.dailyBudgetInfo(todayStart.getTime(), creditsToday);
			const over = budget !== null && budget.pct >= 100;
			const displayMode = vscode.workspace.getConfiguration('usageLogger').get<string>('statusBarDisplay', 'requests');
			if (displayMode === 'remainingCredits' && budget) {
				const remaining = Math.round(budget.remainingToday);
				this.item.text = `${over ? '$(warning)' : '$(copilot)'} ${remaining.toLocaleString()} left today`;
			} else {
				// Falls back to request count if remainingCredits was picked but no monthlyCreditLimit is set.
				this.item.text = `${over ? '$(warning)' : '$(copilot)'} ${today} today`;
			}
			this.item.tooltip = this.buildTooltipFrom(today, creditsToday, budget);
			// Amber warning background once today's spend meets/exceeds today's even budget share.
			this.item.backgroundColor = over ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
		}
	}

	private buildTooltipFrom(today: number, creditsToday: number, budget: DailyBudgetInfo | null): vscode.MarkdownString {
		const total = this.db.countAll();
		const md = new vscode.MarkdownString(undefined, true);
		md.isTrusted = true;
		md.appendMarkdown(`**Copilot Usage Logger**\n\n`);
		md.appendMarkdown(`- Requests today: **${today}**\n`);
		md.appendMarkdown(`- Cost units today: **${Math.round(creditsToday).toLocaleString()}**\n`);

		if (budget) {
			md.appendMarkdown(`- Daily budget: \`${budget.bar}\` ${budget.pct}% (${Math.round(creditsToday).toLocaleString()} / ${Math.round(budget.dailyBudget).toLocaleString()})\n`);
			md.appendMarkdown(`- Remaining today: **${Math.round(budget.remainingToday).toLocaleString()}**\n`);
			if (budget.pct >= 100) {
				md.appendMarkdown(`- ⚠️ Over today's budget share\n`);
			}
			if (budget.otherDevicesCredits > 0) {
				const syncedAt = budget.syncedAt ? new Date(budget.syncedAt).toLocaleString() : 'unknown';
				md.appendMarkdown(`- Includes ${Math.round(budget.otherDevicesCredits).toLocaleString()} synced from other devices (as of ${syncedAt})\n`);
			}
			md.appendMarkdown(`- [Sync credits used on other devices](command:usageLogger.syncActualCredits)\n`);
		} else {
			md.appendMarkdown(`- Daily budget: not set (\`usageLogger.monthlyCreditLimit\`)\n`);
		}

		md.appendMarkdown(`- Requests logged all-time: **${total.toLocaleString()}**\n\n`);
		md.appendMarkdown(`Click for the full dashboard.`);
		return md;
	}

	/**
	 * Mirrors dashboardPanel's daily-budget math: remaining monthly credits ÷ remaining days in month.
	 * `creditsThisMonth`/`creditsBeforeToday` fold in any manually-synced other-devices credits (see
	 * ../reporting/creditsSync.ts), since this extension only observes local Copilot activity and a
	 * Business/Enterprise seat's quota is shared across every device the account uses.
	 */
	private dailyBudgetInfo(todayStartMs: number, creditsToday: number): DailyBudgetInfo | null {
		const monthlyCreditLimit = vscode.workspace.getConfiguration('usageLogger').get<number>('monthlyCreditLimit', 0);
		if (!monthlyCreditLimit || monthlyCreditLimit <= 0) {
			return null;
		}
		const todayStart = new Date(todayStartMs);
		const startOfMonth = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
		const daysInMonth = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 0).getDate();
		const remainingDaysInMonth = daysInMonth - todayStart.getDate() + 1;
		const otherDevicesCredits = getOtherDevicesCreditsThisMonth(this.context);
		const syncedAt = getSyncStateThisMonth(this.context)?.syncedAt;
		const creditsThisMonth = this.db.creditsSince(startOfMonth.getTime()) + otherDevicesCredits;
		const creditsBeforeToday = Math.max(0, creditsThisMonth - creditsToday);
		// dailyBudget = today's even share of what's left, computed BEFORE today's own spend is deducted —
		// otherwise today's usage gets divided into the pool and then subtracted again below (double-counted).
		const dailyBudget = Math.max(0, monthlyCreditLimit - creditsBeforeToday) / remainingDaysInMonth;
		const remainingToday = Math.max(0, dailyBudget - creditsToday);
		const pct = dailyBudget > 0 ? Math.min(100, Math.round((creditsToday / dailyBudget) * 100)) : (creditsToday > 0 ? 100 : 0);
		const filled = Math.round(pct / 10);
		const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
		return { dailyBudget, remainingToday, pct, bar, otherDevicesCredits, syncedAt };
	}

	dispose(): void {
		this.item.dispose();
	}
}

