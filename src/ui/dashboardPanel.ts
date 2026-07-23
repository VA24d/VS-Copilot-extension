import * as os from 'os';
import * as vscode from 'vscode';
import { summarizeModelFit } from '../heuristics/modelFit';
import { DEFAULT_MINUTES_SAVED_PER_CATEGORY, estimateTimeSavings } from '../heuristics/timeSavings';
import type { UsageDb } from '../storage/db';

/** WebviewPanel host for the usage dashboard. Posts aggregate query results; rendering (inline SVG bars) happens in the webview script. */
export class DashboardPanel {
	public static currentPanel: DashboardPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private disposed = false;
	private windowDays = 30;

	private constructor(panel: vscode.WebviewPanel, private readonly db: UsageDb, private readonly logoUri: vscode.Uri) {
		this.panel = panel;
		this.panel.webview.html = getHtml(this.panel.webview, this.logoUri);
		this.panel.onDidDispose(() => this.dispose());
		this.panel.webview.onDidReceiveMessage((message) => {
			if (message?.type === 'requestData') {
				if (typeof message.windowDays === 'number' && message.windowDays > 0) {
					this.windowDays = message.windowDays;
				}
				this.postData();
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
		DashboardPanel.currentPanel = new DashboardPanel(panel, db, logoUri);
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

		const startOfMonth = new Date();
		startOfMonth.setDate(1);
		startOfMonth.setHours(0, 0, 0, 0);

		const modelFit = summarizeModelFit(this.db.listCategoryModelPairs());
		const timeSavings = estimateTimeSavings(this.db.categoryCounts(), minutesPerCategory);

		this.panel.webview.postMessage({
			type: 'data',
			total: this.db.countAll(),
			byCategory: this.db.groupByCategory(),
			byLanguage: this.db.groupByLanguage(),
			byModel: this.db.groupByModel(),
			byDay: this.db.groupByDay(this.windowDays),
			windowDays: this.windowDays,
			hostname: os.hostname(),
			credits: {
				total: this.db.totalCredits(),
				thisMonth: this.db.creditsSince(startOfMonth.getTime()),
				monthlyLimit: monthlyCreditLimit,
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
	.trend-row { display: flex; align-items: flex-end; gap: 3px; height: 80px; margin-top: 8px; }
	.trend-bar { flex: 1; background: var(--vscode-charts-blue, #3794ff); border-radius: 2px 2px 0 0; min-height: 2px; }
	.trend-bar.credits { background: var(--vscode-charts-purple, #b180d7); }
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
				<div class="stat"><div class="value" id="creditsMonth">–</div><div class="label">used this calendar month</div></div>
				<div class="stat"><div class="value" id="creditsTotal">–</div><div class="label">used all-time (logged history)</div></div>
			</div>
			<div id="creditsLimitBar"></div>
			<div id="creditsTrend" class="trend-row"></div>
			<div class="footnote">"Cost units" = the <code>copilotCredits</code> value VS Code reports per request. This is a relative cost signal, not guaranteed to exactly match GitHub's official Copilot Business/Enterprise premium-request billing meter. Set <code>usageLogger.monthlyCreditLimit</code> to track against your org's allowance.</div>
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

		function renderCreditsLimit(thisMonth, limit) {
			const el = document.getElementById('creditsLimitBar');
			if (!limit || limit <= 0) {
				el.innerHTML = '<div class="empty">No monthly limit configured (usageLogger.monthlyCreditLimit).</div>';
				return;
			}
			const pct = Math.min(100, Math.round((thisMonth / limit) * 100));
			const cls = pct >= 100 ? 'over' : (pct >= 80 ? 'warn' : '');
			el.innerHTML =
				'<div class="bar-row"><div class="bar-label">This month</div>' +
				'<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
				'<div class="bar-count">' + pct + '%</div></div>';
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
			renderBars('byDay', msg.byDay, 'day');

			document.getElementById('creditsMonth').textContent = Math.round(msg.credits.thisMonth).toLocaleString();
			document.getElementById('creditsTotal').textContent = Math.round(msg.credits.total).toLocaleString();
			renderCreditsLimit(msg.credits.thisMonth, msg.credits.monthlyLimit);
			renderTrend('creditsTrend', msg.credits.byDay, 'credits', 'credits');

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
