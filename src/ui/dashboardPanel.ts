import * as vscode from 'vscode';
import type { UsageDb } from '../storage/db';

/** WebviewPanel host for the usage dashboard. Posts aggregate query results; rendering (inline SVG bars) happens in the webview script. */
export class DashboardPanel {
	public static currentPanel: DashboardPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private disposed = false;

	private constructor(panel: vscode.WebviewPanel, private readonly db: UsageDb) {
		this.panel = panel;
		this.panel.webview.html = getHtml();
		this.panel.onDidDispose(() => this.dispose());
		this.panel.webview.onDidReceiveMessage((message) => {
			if (message?.type === 'requestData') {
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

		const panel = vscode.window.createWebviewPanel(
			'usageLoggerDashboard',
			'Copilot Usage Dashboard',
			vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		context.subscriptions.push(panel);

		DashboardPanel.currentPanel = new DashboardPanel(panel, db);
	}

	refresh(): void {
		if (!this.disposed) {
			this.postData();
		}
	}

	private postData(): void {
		this.panel.webview.postMessage({
			type: 'data',
			total: this.db.countAll(),
			byCategory: this.db.groupByCategory(),
			byLanguage: this.db.groupByLanguage(),
			byModel: this.db.groupByModel(),
			byDay: this.db.groupByDay(30)
		});
	}

	private dispose(): void {
		this.disposed = true;
		DashboardPanel.currentPanel = undefined;
	}
}

function getHtml(): string {
	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<title>Copilot Usage Dashboard</title>
<style>
	body {
		font-family: var(--vscode-font-family);
		color: var(--vscode-foreground);
		padding: 16px 24px;
	}
	h1 { font-size: 1.3em; margin-bottom: 4px; }
	.subtitle { opacity: 0.7; margin-bottom: 24px; }
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
	.card h2 { font-size: 1em; margin: 0 0 12px 0; }
	.bar-row { display: flex; align-items: center; margin-bottom: 6px; font-size: 0.85em; }
	.bar-label { width: 140px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bar-track { flex-grow: 1; background: var(--vscode-editorWidget-background); border-radius: 3px; margin: 0 8px; height: 14px; }
	.bar-fill { background: var(--vscode-charts-blue, #3794ff); height: 100%; border-radius: 3px; }
	.bar-count { width: 36px; text-align: right; flex-shrink: 0; }
	.empty { opacity: 0.6; font-style: italic; }
</style>
</head>
<body>
	<h1>Copilot Usage Dashboard</h1>
	<div class="subtitle" id="subtitle">Loading…</div>
	<div class="grid">
		<div class="card"><h2>By category</h2><div id="byCategory"></div></div>
		<div class="card"><h2>By language</h2><div id="byLanguage"></div></div>
		<div class="card"><h2>By model</h2><div id="byModel"></div></div>
		<div class="card"><h2>Last 30 days</h2><div id="byDay"></div></div>
	</div>
	<script>
		const vscode = acquireVsCodeApi();

		function renderBars(containerId, rows, labelKey) {
			const container = document.getElementById(containerId);
			container.innerHTML = '';
			if (!rows || rows.length === 0) {
				container.innerHTML = '<div class="empty">No data yet.</div>';
				return;
			}
			const max = Math.max(...rows.map(r => r.count), 1);
			for (const row of rows) {
				const rowEl = document.createElement('div');
				rowEl.className = 'bar-row';
				const pct = Math.round((row.count / max) * 100);
				rowEl.innerHTML =
					'<div class="bar-label" title="' + String(row[labelKey]) + '">' + String(row[labelKey]) + '</div>' +
					'<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
					'<div class="bar-count">' + row.count + '</div>';
				container.appendChild(rowEl);
			}
		}

		window.addEventListener('message', (event) => {
			const msg = event.data;
			if (msg.type !== 'data') { return; }
			document.getElementById('subtitle').textContent = msg.total + ' total logged requests (local only)';
			renderBars('byCategory', msg.byCategory, 'category');
			renderBars('byLanguage', msg.byLanguage, 'language');
			renderBars('byModel', msg.byModel, 'modelId');
			renderBars('byDay', msg.byDay, 'day');
		});

		vscode.postMessage({ type: 'requestData' });
	</script>
</body>
</html>`;
}
