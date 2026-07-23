import type { ReportPayload } from './payload';

/** A report document as stored in Mongo — the payload plus the server-set receivedAt. */
export interface DeviceReportDoc extends ReportPayload {
	receivedAt?: Date;
}

export interface CompanyAggregate {
	deviceCount: number;
	totalRequests: number;
	byCategory: Array<{ category: string; count: number }>;
	byLanguage: Array<{ language: string; count: number }>;
	byModel: Array<{ modelId: string; count: number }>;
	byDay: Array<{ day: string; count: number }>;
	devices: Array<{ deviceId: string; totalRequests: number; generatedAt: string }>;
}

/**
 * Each device sends periodic snapshots with cumulative all-time totals (see
 * payload.ts), not incremental deltas — so summing every stored document
 * would wildly overcount. Instead, take only the MOST RECENT report per
 * `deviceId` and sum those across devices for an org-wide picture.
 */
export function aggregateCompanyReports(docs: DeviceReportDoc[]): CompanyAggregate {
	const latestByDevice = new Map<string, DeviceReportDoc>();
	for (const doc of docs) {
		const existing = latestByDevice.get(doc.deviceId);
		if (!existing || new Date(doc.generatedAt).getTime() > new Date(existing.generatedAt).getTime()) {
			latestByDevice.set(doc.deviceId, doc);
		}
	}
	const latest = [...latestByDevice.values()];

	const categoryMap = new Map<string, number>();
	const languageMap = new Map<string, number>();
	const modelMap = new Map<string, number>();
	const dayMap = new Map<string, number>();
	let totalRequests = 0;

	for (const doc of latest) {
		totalRequests += doc.totalRequests;
		for (const c of doc.byCategory) {
			categoryMap.set(c.category, (categoryMap.get(c.category) ?? 0) + c.count);
		}
		for (const l of doc.byLanguage) {
			languageMap.set(l.language, (languageMap.get(l.language) ?? 0) + l.count);
		}
		for (const m of doc.byModel) {
			modelMap.set(m.modelId, (modelMap.get(m.modelId) ?? 0) + m.count);
		}
		for (const d of doc.byDay) {
			dayMap.set(d.day, (dayMap.get(d.day) ?? 0) + d.count);
		}
	}

	return {
		deviceCount: latest.length,
		totalRequests,
		byCategory: [...categoryMap.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
		byLanguage: [...languageMap.entries()].map(([language, count]) => ({ language, count })).sort((a, b) => b.count - a.count),
		byModel: [...modelMap.entries()].map(([modelId, count]) => ({ modelId, count })).sort((a, b) => b.count - a.count),
		byDay: [...dayMap.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)),
		devices: latest
			.map((d) => ({ deviceId: d.deviceId, totalRequests: d.totalRequests, generatedAt: d.generatedAt }))
			.sort((a, b) => b.totalRequests - a.totalRequests)
	};
}
