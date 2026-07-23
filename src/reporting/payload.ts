import type { UsageDb } from '../storage/db';

/**
 * Aggregate-only payload for company-wide reporting. Deliberately excludes
 * `prompt_text` / `response_text` and any per-request rows — only counts
 * grouped by category/language/model/day ever leave the machine, per the
 * "metadata only" decision. No workspace paths, file paths, or free-text
 * fields are included either.
 */
export interface ReportPayload {
	schemaVersion: 1;
	deviceId: string;
	generatedAt: string;
	windowDays: number;
	totalRequests: number;
	byCategory: Array<{ category: string; count: number }>;
	byLanguage: Array<{ language: string; count: number }>;
	byModel: Array<{ modelId: string; count: number }>;
	byDay: Array<{ day: string; count: number }>;
}

export function buildReportPayload(db: UsageDb, deviceId: string, windowDays: number): ReportPayload {
	return {
		schemaVersion: 1,
		deviceId,
		generatedAt: new Date().toISOString(),
		windowDays,
		totalRequests: db.countAll(),
		byCategory: db.groupByCategory(),
		byLanguage: db.groupByLanguage(),
		byModel: db.groupByModel(),
		byDay: db.groupByDay(windowDays)
	};
}
