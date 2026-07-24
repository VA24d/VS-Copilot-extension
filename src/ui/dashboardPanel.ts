import * as os from 'os';
import * as vscode from 'vscode';
import { summarizeModelFit } from '../heuristics/modelFit';
import { DEFAULT_MINUTES_SAVED_PER_CATEGORY, estimateTimeSavings } from '../heuristics/timeSavings';
import { getOtherDevicesCreditsThisMonth, getSyncStateThisMonth, syncActualCreditsUsed } from '../reporting/creditsSync';
import type { UsageDb } from '../storage/db';

/** WebviewPanel host for the usage dashboard. Posts aggregate query results; rendering (inline SVG bars) happens in the webview script. */
export class DashboardPanel {
	public static currentPanel: DashboardPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private disposed = false;
	private windowDays = 30;

	private constructor(panel: vscode.WebviewPanel, private readonly context: vscode.ExtensionContext, private readonly db: UsageDb, private readonly logoUri: vscode.Uri) {
		this.panel = panel;
		this.panel.webview.html = getHtml(this.panel.webview, this.logoUri);
		this.panel.onDidDispose(() => this.dispose());
		this.panel.webview.onDidReceiveMessage((message) => {
			if (message?.type === 'requestData') {
				if (typeof message.windowDays === 'number' && message.windowDays > 0) {
					this.windowDays = message.windowDays;
				}
				this.postData();
			} else if (message?.type === 'syncCredits') {
				void syncActualCreditsUsed(this.context, this.db).then(() => this.postData());
			}
		});
		this.postData();
	}

	static createOrShow(context: vscode.ExtensionContext, db: UsageDb): void {
		if (DashboardPanel.currentPanel) {
			DashboardPanel.currentPanel.panel.reveal();
			DashboardPanel.currentPanel.postData();
			return;
		}

		const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
		const panel = vscode.window.createWebviewPanel(
			'usageLoggerDashboard',
			'Copilot Usage Dashboard',
			vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot] }
		);
		context.subscriptions.push(panel);

		const logoUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'icon.png'));
		DashboardPanel.currentPanel = new DashboardPanel(panel, context, db, logoUri);
	}

	refresh(): void {
		if (!this.disposed) {
			this.postData();
		}
	}

	private postData(): void {
		const config = vscode.workspace.getConfiguration('usageLogger');
		const monthlyCreditLimit = config.get<number>('monthlyCreditLimit', 0);
		const minutesPerCategory = config.get<Record<string, number>>('timeSavingsMinutesPerCategory', DEFAULT_MINUTES_SAVED_PER_CATEGORY);

		const now = new Date();
		const startOfMonth = new Date();
		startOfMonth.setDate(1);
		startOfMonth.setHours(0, 0, 0, 0);
		const startOfToday = new Date();
		startOfToday.setHours(0, 0, 0, 0);

		const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
		const remainingDaysInMonth = daysInMonth - now.getDate() + 1; // inclusive of today
		const resetsOn = new Date(now.getFullYear(), now.getMonth() + 1, 1);

		const creditsThisMonthLocal = this.db.creditsSince(startOfMonth.getTime());
		const creditsToday = this.db.creditsSince(startOfToday.getTime());
		const otherDevicesCredits = getOtherDevicesCreditsThisMonth(this.context);
		const syncState = getSyncStateThisMonth(this.context);
		// This extension only observes local Copilot activity; a Business/Enterprise seat's quota is
		// shared across every device the account uses, so fold in any manually-synced other-devices
		// credits (see ../reporting/creditsSync.ts) before computing monthly/daily figures.
		const creditsThisMonth = creditsThisMonthLocal + otherDevicesCredits;
		const creditsBeforeToday = Math.max(0, creditsThisMonth - creditsToday);
		const remainingCredits = monthlyCreditLimit > 0 ? Math.max(0, monthlyCreditLimit - creditsThisMonth) : null;
		// dailyBudget = today's even share of what's left, computed BEFORE today's own spend is deducted —
		// otherwise today's usage gets divided into the pool and then subtracted again downstream (double-counted).
		const dailyBudget = monthlyCreditLimit > 0 ? Math.max(0, monthlyCreditLimit - creditsBeforeToday) / remainingDaysInMonth : null;

		// Burn-rate forecast: extrapolate this month's spend-to-date to a projected month-end total.
		const dayOfMonth = now.getDate();
		const projectedMonthEnd = dayOfMonth > 0 ? (creditsThisMonth / dayOfMonth) * daysInMonth : creditsThisMonth;

		const modelFit = summarizeModelFit(this.db.listCategoryModelPairs());
		const timeSavings = estimateTimeSavings(this.db.categoryCounts(), minutesPerCategory);

		this.panel.webview.postMessage({
			type: 'data',
			total: this.db.countAll(),
			byCategory: this.db.groupByCategory(),
			byLanguage: this.db.groupByLanguage(),
			byModel: this.db.groupByModel(),
			byModelCredits: this.db.creditsByModel(),
			byDay: this.db.groupByDay(this.windowDays),
			windowDays: this.windowDays,
			hostname: os.hostname(),
			credits: {
				total: this.db.totalCredits(),
				thisMonth: creditsThisMonth,
				localThisMonth: creditsThisMonthLocal,
				otherDevicesCredits,
				syncedAt: syncState?.syncedAt ?? null,
				today: creditsToday,
				monthlyLimit: monthlyCreditLimit,
				remaining: remainingCredits,
				dailyBudget,
				projectedMonthEnd,
				remainingDaysInMonth,
				resetsOn: resetsOn.toISOString(),
				byDay: this.db.creditsByDay(this.windowDays)
			},
			modelFit,
			timeSavings
		});
	}

	private dispose(): void {
		this.disposed = true;
		DashboardPanel.currentPanel = undefined;
	}
}

function getHtml(webview: vscode.Webview, logoUri: vscode.Uri): string {
	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src ${webview.cspSource};" />
<title>Copilot Usage Dashboard</title>
<style>
	body {
		font-family: var(--vscode-font-family);
		color: var(--vscode-foreground);
		padding: 16px 24px;
	}
	.header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
	.header img { height: 32px; width: auto; }
	h1 { font-size: 1.3em; margin: 0; }
	.subtitle { opacity: 0.7; margin-bottom: 8px; }
	.machine { opacity: 0.6; font-size: 0.85em; margin-bottom: 16px; }
	.toolbar { margin-bottom: 16px; display: flex; align-items: center; gap: 12px; font-size: 0.85em; flex-wrap: wrap; }
	.toolbar button {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border: none;
		border-radius: 4px;
		padding: 4px 10px;
		cursor: pointer;
	}
	.toolbar button:hover { background: var(--vscode-button-hoverBackground); }
	.toolbar label { display: flex; align-items: center; gap: 4px; opacity: 0.85; }
	.toolbar select {
		background: var(--vscode-dropdown-background);
		color: var(--vscode-dropdown-foreground);
		border: 1px solid var(--vscode-dropdown-border);
		border-radius: 4px;
		padding: 2px 4px;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;
	}
	.card {
		border: 1px solid var(--vscode-panel-border);
		border-radius: 6px;
		padding: 12px 16px;
	}
	.card.full { grid-column: 1 / -1; }
	.card h2 { font-size: 1em; margin: 0 0 12px 0; }
	.bar-row { display: flex; align-items: center; margin-bottom: 6px; font-size: 0.85em; }
	.bar-label { width: 140px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bar-track { flex-grow: 1; background: var(--vscode-editorWidget-background); border-radius: 3px; margin: 0 8px; height: 14px; }
	.bar-fill { background: var(--vscode-charts-blue, #3794ff); height: 100%; border-radius: 3px; }
	.bar-fill.warn { background: var(--vscode-charts-orange, #d18616); }
	.bar-fill.over { background: var(--vscode-charts-red, #f14c4c); }
	.bar-count { width: 56px; text-align: right; flex-shrink: 0; }
	.empty { opacity: 0.6; font-style: italic; }
	.stat-row { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 8px; }
	.stat .value { font-size: 1.6em; font-weight: 600; }
	.stat .label { font-size: 0.8em; opacity: 0.7; }
	.footnote { font-size: 0.75em; opacity: 0.6; margin-top: 8px; line-height: 1.4; }
	.forecast { font-size: 0.85em; margin-top: 8px; line-height: 1.5; }
	.forecast-pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 0.85em; font-weight: 600; margin-right: 6px; }
	.forecast-pill.ok { background: var(--vscode-charts-green, #388a34); color: #fff; }
	.forecast-pill.warn { background: var(--vscode-charts-orange, #d18616); color: #fff; }
	.forecast-pill.over { background: var(--vscode-charts-red, #f14c4c); color: #fff; }
	.trend-row { display: flex; align-items: flex-end; gap: 3px; height: 80px; margin-top: 8px; }
	.trend-bar { flex: 1; background: var(--vscode-charts-blue, #3794ff); border-radius: 2px 2px 0 0; min-height: 2px; }
	.trend-bar.credits { background: var(--vscode-charts-purple, #b180d7); }
	.tooltip-wrap { position: relative; cursor: help; }
	.tooltip-popup {
		display: none;
		position: absolute;
		left: 0;
		top: calc(100% + 6px);
		background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background));
		border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border));
		border-radius: 6px;
		padding: 10px 12px;
		font-weight: normal;
		font-size: 0.85em;
		white-space: nowrap;
		z-index: 20;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
	}
	.tooltip-wrap:hover .tooltip-popup { display: block; }
	.tooltip-row { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 3px; }
	.tooltip-row .k { opacity: 0.65; margin-right: 12px; }
	.tooltip-sparkline-label { opacity: 0.65; margin-top: 6px; margin-bottom: 2px; }
	.tooltip-popup svg { display: block; }
</style>
</head>
<body>
	<div class="header">
		<img src="${logoUri.toString()}" alt="Lloyds Banking Group" />
		<h1>Copilot Usage Dashboard</h1>
	</div>
	<div class="subtitle" id="subtitle">Loading…</div>
	<div class="machine" id="machine"></div>
	<div class="toolbar">
		<button id="refreshBtn">Refresh now</button>
		<label><input type="checkbox" id="autoRefreshToggle" checked /> Auto-refresh</label>
		<label>Trend window:
			<select id="windowDaysSelect">
				<option value="7">7 days</option>
				<option value="30" selected>30 days</option>
				<option value="90">90 days</option>
				<option value="180">180 days</option>
			</select>
		</label>
		<span id="lastUpdated"></span>
	</div>
	<div class="grid">
		<div class="card">
			<h2>Copilot cost units</h2>
			<div class="stat-row">
				<div class="stat tooltip-wrap"><div class="value" id="creditsMonth">–</div><div class="label">used this calendar month</div><div class="tooltip-popup" id="creditsMonthTooltip"></div></div>
				<div class="stat tooltip-wrap"><div class="value" id="creditsTotal">–</div><div class="label">used all-time (logged history)</div><div class="tooltip-popup" id="creditsTotalTooltip"></div></div>
			</div>
			<div id="creditsLimitBar"></div>
			<div id="creditsDailyBar"></div>
			<div id="creditsForecast" class="forecast"></div>
			<div id="creditsTrend" class="trend-row"></div>
			<div class="toolbar" style="margin-top:6px;">
				<button id="syncCreditsBtn">Sync credits used on other devices</button>
				<span id="creditsSyncNote"></span>
			</div>
			<div class="footnote">"Cost units" = the <code>copilotCredits</code> value VS Code reports per request. This is a relative cost signal, not guaranteed to exactly match GitHub's official Copilot Business/Enterprise premium-request billing meter. Set <code>usageLogger.monthlyCreditLimit</code> to track against your org's allowance. Hover the numbers above for remaining/daily-budget detail. "Today's budget" = (monthly limit − credits used before today) ÷ remaining days in month. This extension only sees local Copilot activity — use "Sync credits used on other devices" to reconcile against the real total shown in the native Copilot Business/Enterprise flyout.</div>
		</div>
		<div class="card">
			<h2>Cost units by model</h2>
			<div id="byModelCredits"></div>
			<div class="footnote">Which models actually consume your Copilot cost units (sum of <code>copilotCredits</code> per model across all logged history). Useful for spotting where an expensive model is doing routine work that a cheaper one could handle.</div>
		</div>
		<div class="card">
			<h2>Model fit</h2>
			<div id="modelFit"></div>
			<div class="footnote">Heuristic only: flags requests where a high-cost model was used for a typically low-complexity task category (or vice versa), based on model name and task category. Not a judgment on any individual request — just a pattern worth a glance for cost optimization.</div>
		</div>
		<div class="card full">
			<h2>Estimated time saved</h2>
			<div class="stat-row">
				<div class="stat"><div class="value" id="timeSavedHours">–</div><div class="label">estimated hours saved (all logged history)</div></div>
			</div>
			<div id="timeSavedByCategory"></div>
			<div class="footnote">Rough, directional estimate only — not a measurement. Based on configurable per-category minutes-saved assumptions (<code>usageLogger.timeSavingsMinutesPerCategory</code>), loosely informed by published industry research on AI pair-programming (e.g. GitHub's 2022 study reporting ~55% faster task completion). Actual time saved varies significantly by developer, task, and codebase.</div>
		</div>
		<div class="card"><h2>By category</h2><div id="byCategory"></div></div>
		<div class="card"><h2>By language</h2><div id="byLanguage"></div></div>
		<div class="card"><h2>By model</h2><div id="byModel"></div></div>
		<div class="card"><h2 id="byDayTitle">Requests per day</h2><div id="byDay"></div></div>
	</div>
	<script>
		const vscode = acquireVsCodeApi();
		const AUTO_REFRESH_MS = 15000;
		let autoRefreshTimer;

		function requestData() {
			const windowDays = Number(document.getElementById('windowDaysSelect').value) || 30;
			vscode.postMessage({ type: 'requestData', windowDays });
		}

		function renderBars(containerId, rows, labelKey, countKey) {
			countKey = countKey || 'count';
			const container = document.getElementById(containerId);
			container.innerHTML = '';
			if (!rows || rows.length === 0) {
				container.innerHTML = '<div class="empty">No data yet.</div>';
				return;
			}
			const max = Math.max(...rows.map(r => r[countKey]), 1);
			for (const row of rows) {
				const rowEl = document.createElement('div');
				rowEl.className = 'bar-row';
				const pct = Math.round((row[countKey] / max) * 100);
				const val = typeof row[countKey] === 'number' && !Number.isInteger(row[countKey]) ? row[countKey].toFixed(1) : row[countKey];
				rowEl.innerHTML =
					'<div class="bar-label" title="' + String(row[labelKey]) + '">' + String(row[labelKey]) + '</div>' +
					'<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
					'<div class="bar-count">' + val + '</div>';
				container.appendChild(rowEl);
			}
		}

		function renderTrend(containerId, rows, valueKey, cls) {
			const container = document.getElementById(containerId);
			container.innerHTML = '';
			if (!rows || rows.length === 0) {
				container.innerHTML = '<div class="empty">No data yet.</div>';
				return;
			}
			const max = Math.max(...rows.map(r => r[valueKey]), 1);
			for (const row of rows) {
				const bar = document.createElement('div');
				bar.className = 'trend-bar' + (cls ? ' ' + cls : '');
				const pct = Math.max(2, Math.round((row[valueKey] / max) * 100));
				bar.style.height = pct + '%';
				bar.title = row.day + ': ' + (Number.isInteger(row[valueKey]) ? row[valueKey] : row[valueKey].toFixed(1));
				container.appendChild(bar);
			}
		}

		function renderCreditsLimit(thisMonth, limit, remaining) {
			const el = document.getElementById('creditsLimitBar');
			if (!limit || limit <= 0) {
				el.innerHTML = '<div class="empty">No monthly limit configured (usageLogger.monthlyCreditLimit).</div>';
				return;
			}
			const pct = Math.min(100, Math.round((thisMonth / limit) * 100));
			const cls = pct >= 100 ? 'over' : (pct >= 80 ? 'warn' : '');
			const title = 'Used ' + Math.round(thisMonth).toLocaleString() + ' / ' + limit.toLocaleString() + ' (' + pct + '%). Remaining: ' + Math.round(remaining).toLocaleString() + '.';
			el.innerHTML =
				'<div class="bar-row" title="' + title + '"><div class="bar-label">This month</div>' +
				'<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
				'<div class="bar-count">' + pct + '%</div></div>';
		}

		function renderDailyBudget(credits) {
			const el = document.getElementById('creditsDailyBar');
			if (!credits.monthlyLimit || credits.monthlyLimit <= 0) {
				el.innerHTML = '';
				return;
			}
			const dailyBudget = credits.dailyBudget || 0;
			const today = credits.today || 0;
			const pct = dailyBudget > 0 ? Math.min(100, Math.round((today / dailyBudget) * 100)) : (today > 0 ? 100 : 0);
			const cls = pct >= 100 ? 'over' : (pct >= 80 ? 'warn' : '');
			const resetsStr = new Date(credits.resetsOn).toLocaleDateString();
			const title = 'Daily budget: ' + Math.round(dailyBudget).toLocaleString() + '/day (credits left before today\u2019s spend, spread over ' + credits.remainingDaysInMonth + ' day(s) left). Used today: ' + Math.round(today).toLocaleString() + '. Resets ' + resetsStr + '.';
			el.innerHTML =
				'<div class="bar-row" title="' + title + '"><div class="bar-label">Today\u2019s budget</div>' +
				'<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
				'<div class="bar-count">' + Math.round(today).toLocaleString() + '/' + Math.round(dailyBudget).toLocaleString() + '</div></div>';
		}

		function renderSparkline(values, width, height) {
			width = width || 150; height = height || 32;
			if (!values || values.length === 0) { return '<div class="empty" style="font-size:0.9em;">No trend data yet.</div>'; }
			const max = Math.max.apply(null, values.concat([1]));
			const min = Math.min.apply(null, values.concat([0]));
			const range = Math.max(max - min, 1);
			const stepX = values.length > 1 ? width / (values.length - 1) : width;
			const points = values.map(function (v, i) {
				const x = i * stepX;
				const y = height - ((v - min) / range) * height;
				return x.toFixed(1) + ',' + y.toFixed(1);
			}).join(' ');
			return '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
				'<polyline points="' + points + '" fill="none" stroke="var(--vscode-charts-purple, #b180d7)" stroke-width="1.5" /></svg>';
		}

		function tooltipRow(label, value) {
			return '<div class="tooltip-row"><span class="k">' + label + '</span><span class="v">' + value + '</span></div>';
		}

		function renderCreditsTooltip(credits) {
			const el = document.getElementById('creditsMonthTooltip');
			let html = '';
			if (credits.monthlyLimit > 0) {
				html += tooltipRow('Remaining this month', Math.round(credits.remaining).toLocaleString());
				html += tooltipRow('Daily budget', Math.round(credits.dailyBudget).toLocaleString() + '/day');
				html += tooltipRow('Days left in month', String(credits.remainingDaysInMonth));
				html += tooltipRow('Used today', Math.round(credits.today).toLocaleString());
				html += tooltipRow('Resets', new Date(credits.resetsOn).toLocaleDateString());
			} else {
				html += tooltipRow('Monthly limit', 'not set');
				html += tooltipRow('Used today', Math.round(credits.today).toLocaleString());
			}
			if (credits.otherDevicesCredits) {
				html += tooltipRow('Other devices (synced)', Math.round(credits.otherDevicesCredits).toLocaleString());
			}
			const recentDays = (credits.byDay || []).slice(-14);
			if (recentDays.length > 1) {
				html += '<div class="tooltip-sparkline-label">Last ' + recentDays.length + ' days</div>';
				html += renderSparkline(recentDays.map(function (r) { return r.credits; }));
			}
			el.innerHTML = html;

			const totalEl = document.getElementById('creditsTotalTooltip');
			totalEl.innerHTML =
				tooltipRow('All-time total', Math.round(credits.total).toLocaleString()) +
				'<div class="tooltip-sparkline-label" style="max-width:220px; white-space:normal;">Sum of every logged request\u2019s copilotCredits value on this machine.</div>';
		}

		function renderCreditsForecast(credits) {
			const el = document.getElementById('creditsForecast');
			if (!credits.monthlyLimit || credits.monthlyLimit <= 0 || !credits.projectedMonthEnd) {
				el.innerHTML = '';
				return;
			}
			const projected = Math.round(credits.projectedMonthEnd);
			const limit = credits.monthlyLimit;
			const overBy = projected - limit;
			const pctOfLimit = Math.round((projected / limit) * 100);
			const cls = projected > limit ? 'over' : (pctOfLimit >= 90 ? 'warn' : 'ok');
			const verdict = projected > limit
				? 'projected to EXCEED limit by ' + overBy.toLocaleString()
				: 'projected to stay under limit (' + (limit - projected).toLocaleString() + ' to spare)';
			el.innerHTML = '<span class="forecast-pill ' + cls + '">Burn-rate forecast</span> ' +
				'at the current pace, month-end \u2248 <strong>' + projected.toLocaleString() + '</strong> / ' +
				limit.toLocaleString() + ' (' + pctOfLimit + '% of limit) \u2014 ' + verdict + '.';
		}

		function renderCreditsSyncNote(credits) {
			const el = document.getElementById('creditsSyncNote');
			if (!credits.otherDevicesCredits) {
				el.textContent = credits.syncedAt ? 'Synced ' + new Date(credits.syncedAt).toLocaleString() + ' — no gap vs. other devices.' : '';
				return;
			}
			el.textContent = 'Local: ' + Math.round(credits.localThisMonth).toLocaleString() + ' + ' +
				Math.round(credits.otherDevicesCredits).toLocaleString() + ' from other devices (synced ' +
				(credits.syncedAt ? new Date(credits.syncedAt).toLocaleString() : 'unknown') + ')';
		}

		function renderModelFit(fit) {
			const el = document.getElementById('modelFit');
			if (!fit || fit.total === 0) {
				el.innerHTML = '<div class="empty">No data yet.</div>';
				return;
			}
			renderBars('modelFit', [
				{ label: 'Well matched', count: fit.wellMatched },
				{ label: 'Possibly overpowered (costly model, simple task)', count: fit.possiblyOverpowered },
				{ label: 'Possibly underpowered (light model, complex task)', count: fit.possiblyUnderpowered },
				{ label: 'Unknown model', count: fit.unknown }
			], 'label');
		}

		function startAutoRefresh() {
			stopAutoRefresh();
			autoRefreshTimer = setInterval(requestData, AUTO_REFRESH_MS);
		}
		function stopAutoRefresh() {
			if (autoRefreshTimer) {
				clearInterval(autoRefreshTimer);
				autoRefreshTimer = undefined;
			}
		}

		document.getElementById('refreshBtn').addEventListener('click', requestData);
		document.getElementById('autoRefreshToggle').addEventListener('change', (e) => {
			if (e.target.checked) { startAutoRefresh(); } else { stopAutoRefresh(); }
		});
		document.getElementById('windowDaysSelect').addEventListener('change', requestData);
		document.getElementById('syncCreditsBtn').addEventListener('click', () => {
			vscode.postMessage({ type: 'syncCredits' });
		});

		window.addEventListener('message', (event) => {
			const msg = event.data;
			if (msg.type !== 'data') { return; }
			document.getElementById('subtitle').textContent = msg.total + ' total logged requests (local only)';
			document.getElementById('machine').textContent = 'Machine: ' + (msg.hostname || 'unknown');
			document.getElementById('lastUpdated').textContent = 'Last updated ' + new Date().toLocaleTimeString();
			document.getElementById('byDayTitle').textContent = 'Requests per day (last ' + msg.windowDays + ' days)';

			renderBars('byCategory', msg.byCategory, 'category');
			renderBars('byLanguage', msg.byLanguage, 'language');
			renderBars('byModel', msg.byModel, 'modelId');
			renderBars('byModelCredits', (msg.byModelCredits || []).map(function (r) { return { modelId: r.modelId, count: Math.round(r.credits) }; }), 'modelId');
			renderBars('byDay', msg.byDay, 'day');

			const creditsMonthEl = document.getElementById('creditsMonth');
			const creditsTotalEl = document.getElementById('creditsTotal');
			creditsMonthEl.textContent = Math.round(msg.credits.thisMonth).toLocaleString();
			creditsTotalEl.textContent = Math.round(msg.credits.total).toLocaleString();
			renderCreditsTooltip(msg.credits);
			renderCreditsLimit(msg.credits.thisMonth, msg.credits.monthlyLimit, msg.credits.remaining);
			renderDailyBudget(msg.credits);
			renderCreditsForecast(msg.credits);
			renderTrend('creditsTrend', msg.credits.byDay, 'credits', 'credits');
			renderCreditsSyncNote(msg.credits);

			renderModelFit(msg.modelFit);

			document.getElementById('timeSavedHours').textContent = msg.timeSavings.totalHours.toFixed(1) + 'h';
			renderBars('timeSavedByCategory', msg.timeSavings.byCategory.map(c => ({ category: c.category, count: Math.round(c.minutesSaved) })), 'category');
		});

		requestData();
		startAutoRefresh();
	</script>
</body>
</html>`;
}
