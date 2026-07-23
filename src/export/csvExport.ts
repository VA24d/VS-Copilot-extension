import type { UsageDb } from '../storage/db';

/**
 * Builds a metadata-only CSV suitable for compliance/audit review (e.g.
 * demonstrating AI usage governance to internal audit or a regulator).
 * Deliberately excludes prompt/response text — see
 * `UsageDb.listRequestsForExport`.
 */
export function buildAuditCsv(db: UsageDb): string {
	const rows = db.listRequestsForExport();
	const header = ['timestamp_iso', 'category', 'language', 'model_id', 'agent_id', 'source', 'workspace_hash'];
	const lines = [header.join(',')];
	for (const row of rows) {
		lines.push([
			new Date(row.timestamp).toISOString(),
			csvEscape(row.category),
			csvEscape(row.language),
			csvEscape(row.modelId),
			csvEscape(row.agentId),
			csvEscape(row.source),
			csvEscape(row.workspaceHash)
		].join(','));
	}
	return lines.join('\n') + '\n';
}

function csvEscape(value: string): string {
	if (value.includes(',') || value.includes('"') || value.includes('\n')) {
		return '"' + value.replace(/"/g, '""') + '"';
	}
	return value;
}
