import { describe, expect, it } from 'vitest';
import { aggregateCompanyReports, type DeviceReportDoc } from './companyAggregate';

function makeDoc(overrides: Partial<DeviceReportDoc>): DeviceReportDoc {
	return {
		schemaVersion: 1,
		deviceId: 'device-a',
		generatedAt: '2026-07-01T00:00:00.000Z',
		windowDays: 30,
		totalRequests: 0,
		byCategory: [],
		byLanguage: [],
		byModel: [],
		byDay: [],
		...overrides
	};
}

describe('aggregateCompanyReports', () => {
	it('sums a single latest report per device across the org', () => {
		const docs: DeviceReportDoc[] = [
			makeDoc({ deviceId: 'device-a', totalRequests: 10, byCategory: [{ category: 'code-gen', count: 10 }] }),
			makeDoc({ deviceId: 'device-b', totalRequests: 5, byCategory: [{ category: 'code-gen', count: 5 }] })
		];
		const result = aggregateCompanyReports(docs);
		expect(result.deviceCount).toBe(2);
		expect(result.totalRequests).toBe(15);
		expect(result.byCategory).toEqual([{ category: 'code-gen', count: 15 }]);
	});

	it('takes only the most recent report per device (cumulative snapshots, not deltas)', () => {
		const docs: DeviceReportDoc[] = [
			makeDoc({ deviceId: 'device-a', generatedAt: '2026-07-01T00:00:00.000Z', totalRequests: 10 }),
			makeDoc({ deviceId: 'device-a', generatedAt: '2026-07-02T00:00:00.000Z', totalRequests: 25 }),
			makeDoc({ deviceId: 'device-a', generatedAt: '2026-06-30T00:00:00.000Z', totalRequests: 999 })
		];
		const result = aggregateCompanyReports(docs);
		// Must equal the latest snapshot's total (25), not a sum of all three (which would wildly overcount).
		expect(result.deviceCount).toBe(1);
		expect(result.totalRequests).toBe(25);
	});

	it('sorts byCategory/byLanguage/byModel descending by count and byDay ascending by date', () => {
		const docs: DeviceReportDoc[] = [
			makeDoc({
				deviceId: 'device-a',
				byCategory: [{ category: 'docs', count: 1 }, { category: 'code-gen', count: 9 }],
				byLanguage: [{ language: 'Python', count: 2 }, { language: 'TypeScript', count: 8 }],
				byModel: [{ modelId: 'small', count: 1 }, { modelId: 'big', count: 9 }],
				byDay: [{ day: '2026-07-02', count: 1 }, { day: '2026-07-01', count: 1 }]
			})
		];
		const result = aggregateCompanyReports(docs);
		expect(result.byCategory.map(c => c.category)).toEqual(['code-gen', 'docs']);
		expect(result.byLanguage.map(l => l.language)).toEqual(['TypeScript', 'Python']);
		expect(result.byModel.map(m => m.modelId)).toEqual(['big', 'small']);
		expect(result.byDay.map(d => d.day)).toEqual(['2026-07-01', '2026-07-02']);
	});

	it('returns an empty aggregate for no documents', () => {
		const result = aggregateCompanyReports([]);
		expect(result).toEqual({
			deviceCount: 0,
			totalRequests: 0,
			byCategory: [],
			byLanguage: [],
			byModel: [],
			byDay: [],
			devices: []
		});
	});
});
