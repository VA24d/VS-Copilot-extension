import * as vscode from 'vscode';
import type { UsageDb } from '../storage/db';

/**
 * This extension only sees Copilot activity that happens in the local VS Code windows it's
 * installed in. A single GitHub account's Copilot Business/Enterprise credit quota is shared
 * across every device the user works from, so credits spent elsewhere are invisible to us.
 * This module lets the user manually reconcile against the real total shown in the native
 * "Copilot Business" status bar flyout, storing the gap ("other devices' credits") for the
 * current calendar month so the daily-budget math can account for it.
 */

export interface CreditsSyncState {
	month: string; // 'YYYY-MM', local calendar month this sync applies to
	otherDevicesCredits: number;
	syncedAt: number; // epoch ms
}

const STATE_KEY = 'usageLogger.creditsSyncState';

export function currentMonthKey(d: Date = new Date()): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Credits attributed to other devices for the current month, or 0 if never synced (or synced in a prior month). */
export function getOtherDevicesCreditsThisMonth(context: vscode.ExtensionContext): number {
	const state = context.globalState.get<CreditsSyncState>(STATE_KEY);
	if (!state || state.month !== currentMonthKey()) {
		return 0;
	}
	return state.otherDevicesCredits;
}

/** The stored sync state for the current month, if any (for displaying "last synced" info). */
export function getSyncStateThisMonth(context: vscode.ExtensionContext): CreditsSyncState | undefined {
	const state = context.globalState.get<CreditsSyncState>(STATE_KEY);
	return state && state.month === currentMonthKey() ? state : undefined;
}

/** Prompts for the real "used" total (from the native Copilot Business flyout) and stores the gap vs. local tracking. */
export async function syncActualCreditsUsed(context: vscode.ExtensionContext, db: UsageDb): Promise<void> {
	const input = await vscode.window.showInputBox({
		title: 'Sync Actual Credits Used This Month',
		prompt: 'Enter the "used" total shown in the native Copilot Business/Enterprise flyout (e.g. 179898.5). This covers usage on other devices that this extension can\'t see locally.',
		placeHolder: 'e.g. 179898.5',
		validateInput: (v) => (v.trim() === '' || Number.isNaN(Number(v)) || Number(v) < 0) ? 'Enter a non-negative number' : undefined
	});
	if (input === undefined) {
		return;
	}
	const actualTotal = Number(input);
	const now = new Date();
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	const localCreditsThisMonth = db.creditsSince(startOfMonth.getTime());
	const otherDevicesCredits = Math.max(0, actualTotal - localCreditsThisMonth);
	const state: CreditsSyncState = { month: currentMonthKey(now), otherDevicesCredits, syncedAt: Date.now() };
	await context.globalState.update(STATE_KEY, state);
	void vscode.window.showInformationMessage(
		`Copilot Usage Logger: synced. Other devices account for ~${Math.round(otherDevicesCredits).toLocaleString()} credit(s) this month; daily budget now reflects it.`
	);
}
