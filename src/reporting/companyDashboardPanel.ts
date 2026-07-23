import * as vscode from 'vscode';
import { aggregateCompanyReports, type CompanyAggregate, type DeviceReportDoc } from './companyAggregate';
import { MONGO_CONNECTION_STRING_SECRET_KEY } from './reportingService';

/**
 * Webview panel for the ORG-WIDE view: reads every device's latest report
 * document straight out of the shared MongoDB collection (the same one
 * `usageLogger.reportingTransport: "mongodb"` writes to) and aggregates
 * across machines. Requires `usageLogger.mongoDatabase` /
 * `usageLogger.mongoCollection` to be set and a connection string to have
 * been saved via "Copilot Usage: Set MongoDB Connection String" — this
 * panel only reads, it never writes.
 */
export class CompanyDashboardPanel {
	public static currentPanel: CompanyDashboardPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private disposed = false;

	private constructor(panel: vscode.WebviewPanel, private readonly context: vscode.ExtensionContext) {
		this.panel = panel;
		this.panel.webview.html = getHtml(this.panel.webview);
		this.panel.onDidDispose(() => this.dispose());
		this.panel.webview.onDidReceiveMessage((message) => {
			if (message?.type === 'requestData') {
				void this.postData();
			}
		});
		void this.postData();
	}

	static createOrShow(context: vscode.ExtensionContext): void {
		if (CompanyDashboardPanel.currentPanel) {
			CompanyDashboardPanel.currentPanel.panel.reveal();
			void CompanyDashboardPanel.currentPanel.postData();
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'usageLoggerCompanyDashboard',
			'Copilot Usage — Company-Wide',
			vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		context.subscriptions.push(panel);
		CompanyDashboardPanel.currentPanel = new CompanyDashboardPanel(panel, context);
	}

	private async postData(): Promise<void> {
		const config = vscode.workspace.getConfiguration('usageLogger');
		const database = config.get<string>('mongoDatabase', '').trim();
		const collection = config.get<string>('mongoCollection', '').trim();
		const connectionString = await this.context.secrets.get(MONGO_CONNECTION_STRING_SECRET_KEY);

		if (!connectionString) {
			this.postError('No MongoDB connection string saved. Run "Copilot Usage: Set MongoDB Connection String" first.');
			return;
		}
		if (!database || !collection) {
			this.postError('Set usageLogger.mongoDatabase and usageLogger.mongoCollection first.');
			return;
		}

		let MongoClientCtor: typeof import('mongodb').MongoClient;
		try {
			({ MongoClient: MongoClientCtor } = await import('mongodb'));
		} catch (err) {
			this.postError(`mongodb driver not available: ${String(err)}`);
			return;
		}

		const client = new MongoClientCtor(connectionString, { serverSelectionTimeoutMS: 10_000, connectTimeoutMS: 10_000 });
		try {
			await client.connect();
			const docs = await client.db(database).collection<DeviceReportDoc>(collection).find({}).toArray();
			const aggregate: CompanyAggregate = aggregateCompanyReports(docs);
			if (this.disposed) {
				return;
			}
			this.panel.webview.postMessage({ type: 'data', aggregate, database, collection });
		} catch (err) {
			this.postError(`Failed to read from MongoDB: ${String(err)}`);
		} finally {
			await client.close().catch(() => { /* best-effort close */ });
		}
	}

	private postError(message: string): void {
		if (!this.disposed) {
			this.panel.webview.postMessage({ type: 'error', message });
		}
	}

	private dispose(): void {
		this.disposed = true;
		CompanyDashboardPanel.currentPanel = undefined;
	}
}

function getHtml(webview: vscode.Webview): string {
	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src ${webview.cspSource};" />
<title>Copilot Usage — Company-Wide</title>
<style>
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px 24px; }
	h1 { font-size: 1.3em; margin: 0 0 4px 0; }
	.subtitle { opacity: 0.7; margin-bottom: 16px; }
	.toolbar { margin-bottom: 16px; display: flex; align-items: center; gap: 12px; font-size: 0.85em; }
	.toolbar button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
	.toolbar button:hover { background: var(--vscode-button-hoverBackground); }
	.error { border: 1px solid var(--vscode-inputValidation-errorBorder, #f14c4c); background: var(--vscode-inputValidation-errorBackground, rgba(241,76,76,0.1)); padding: 12px; border-radius: 6px; margin-bottom: 16px; display: none; }
	.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
	.card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px 16px; }
	.card.full { grid-column: 1 / -1; }
	.card h2 { font-size: 1em; margin: 0 0 12px 0; }
	.bar-row { display: flex; align-items: center; margin-bottom: 6px; font-size: 0.85em; }
	.bar-label { width: 160px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bar-track { flex-grow: 1; background: var(--vscode-editorWidget-background); border-radius: 3px; margin: 0 8px; height: 14px; }
	.bar-fill { background: var(--vscode-charts-blue, #3794ff); height: 100%; border-radius: 3px; }
	.bar-count { width: 56px; text-align: right; flex-shrink: 0; }
	.empty { opacity: 0.6; font-style: italic; }
	.stat-row { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 8px; }
	.stat .value { font-size: 1.6em; font-weight: 600; }
	.stat .label { font-size: 0.8em; opacity: 0.7; }
	table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
	th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
	.footnote { font-size: 0.75em; opacity: 0.6; margin-top: 8px; line-height: 1.4; }
</style>
</head>
<body>
	<h1>Copilot Usage — Company-Wide</h1>
	<div class="subtitle" id="subtitle">Loading…</div>
	<div class="toolbar">
		<button id="refreshBtn">Refresh now</button>
		<span id="lastUpdated"></span>
	</div>
	<div class="error" id="errorBox"></div>
	<div class="grid" id="grid" style="display:none;">
		<div class="card">
			<h2>Org totals</h2>
			<div class="stat-row">
				<div class="stat"><div class="value" id="totalRequests">–</div><div class="label">requests (latest snapshot per device)</div></div>
				<div class="stat"><div class="value" id="deviceCount">–</div><div class="label">reporting devices</div></div>
			</div>
			<div class="footnote">Each device periodically sends an aggregate-only, cumulative snapshot (no prompt/response text, no file paths). This view sums the MOST RECENT snapshot per device — it is not a live/real-time feed.</div>
		</div>
		<div class="card"><h2>Requests per day (last 30 days, summed across devices)</h2><div id="byDay"></div></div>
		<div class="card"><h2>By category</h2><div id="byCategory"></div></div>
		<div class="card"><h2>By language</h2><div id="byLanguage"></div></div>
		<div class="card"><h2>By model</h2><div id="byModel"></div></div>
		<div class="card full">
			<h2>Reporting devices</h2>
			<table>
				<thead><tr><th>Device ID</th><th>Requests (all-time)</th><th>Last report</th></tr></thead>
				<tbody id="devicesTable"></tbody>
			</table>
		</div>
	</div>
	<script>
		const vscode = acquireVsCodeApi();

		function requestData() {
			document.getElementById('subtitle').textContent = 'Loading…';
			vscode.postMessage({ type: 'requestData' });
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
				rowEl.innerHTML =
					'<div class="bar-label" title="' + String(row[labelKey]) + '">' + String(row[labelKey]) + '</div>' +
					'<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
					'<div class="bar-count">' + row[countKey] + '</div>';
				container.appendChild(rowEl);
			}
		}

		document.getElementById('refreshBtn').addEventListener('click', requestData);

		window.addEventListener('message', (event) => {
			const msg = event.data;
			if (msg.type === 'error') {
				document.getElementById('grid').style.display = 'none';
				const box = document.getElementById('errorBox');
				box.style.display = 'block';
				box.textContent = msg.message;
				document.getElementById('subtitle').textContent = '';
				return;
			}
			if (msg.type !== 'data') { return; }
			document.getElementById('errorBox').style.display = 'none';
			document.getElementById('grid').style.display = 'grid';
			const a = msg.aggregate;
			document.getElementById('subtitle').textContent = 'Source: ' + msg.database + '.' + msg.collection;
			document.getElementById('lastUpdated').textContent = 'Last updated ' + new Date().toLocaleTimeString();
			document.getElementById('totalRequests').textContent = a.totalRequests.toLocaleString();
			document.getElementById('deviceCount').textContent = a.deviceCount;
			renderBars('byDay', a.byDay, 'day');
			renderBars('byCategory', a.byCategory, 'category');
			renderBars('byLanguage', a.byLanguage, 'language');
			renderBars('byModel', a.byModel, 'modelId');

			const tbody = document.getElementById('devicesTable');
			tbody.innerHTML = '';
			if (!a.devices || a.devices.length === 0) {
				tbody.innerHTML = '<tr><td colspan="3" class="empty">No devices have reported yet.</td></tr>';
			} else {
				for (const d of a.devices) {
					const tr = document.createElement('tr');
					tr.innerHTML = '<td>' + d.deviceId + '</td><td>' + d.totalRequests.toLocaleString() + '</td><td>' + new Date(d.generatedAt).toLocaleString() + '</td>';
					tbody.appendChild(tr);
				}
			}
		});

		requestData();
	</script>
</body>
</html>`;
}
