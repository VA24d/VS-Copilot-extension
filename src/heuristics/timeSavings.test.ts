import { describe, expect, it } from 'vitest';
import { DEFAULT_MINUTES_SAVED_PER_CATEGORY, estimateTimeSavings } from './timeSavings';

describe('estimateTimeSavings', () => {
	it('multiplies count by the configured minutes-per-category and totals across categories', () => {
		const result = estimateTimeSavings([
			{ category: 'code-gen', count: 10 },
			{ category: 'debug-fix', count: 5 }
		]);
		expect(result.byCategory).toEqual([
			{ category: 'code-gen', count: 10, minutesSaved: 150 },
			{ category: 'debug-fix', count: 5, minutesSaved: 100 }
		]);
		expect(result.totalMinutes).toBe(250);
		expect(result.totalHours).toBeCloseTo(250 / 60, 5);
	});

	it('falls back to the "other" default for an unrecognized category', () => {
		const result = estimateTimeSavings([{ category: 'made-up-category', count: 4 }]);
		expect(result.byCategory[0].minutesSaved).toBe(DEFAULT_MINUTES_SAVED_PER_CATEGORY['other'] * 4);
	});

	it('respects a caller-supplied override map', () => {
		const result = estimateTimeSavings([{ category: 'docs', count: 2 }], { docs: 100 });
		expect(result.byCategory).toEqual([{ category: 'docs', count: 2, minutesSaved: 200 }]);
	});

	it('returns zero totals for an empty input', () => {
		const result = estimateTimeSavings([]);
		expect(result).toEqual({ totalMinutes: 0, totalHours: 0, byCategory: [] });
	});
});
