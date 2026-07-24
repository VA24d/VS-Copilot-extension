import { describe, it, expect } from 'vitest';
import { buildGraphSearchRequest, flattenGraphSearchHits } from './graphText';

describe('buildGraphSearchRequest', () => {
	it('builds a single-request Graph search body with trimmed query and bounded size', () => {
		const body = buildGraphSearchRequest(['driveItem'], '  payments runbook  ', 5);
		expect(body.requests).toHaveLength(1);
		expect(body.requests[0]).toEqual({
			entityTypes: ['driveItem'],
			query: { queryString: 'payments runbook' },
			from: 0,
			size: 5
		});
	});

	it('clamps size to the 1-25 range', () => {
		expect(buildGraphSearchRequest(['chatMessage'], 'x', 0).requests[0].size).toBe(1);
		expect(buildGraphSearchRequest(['chatMessage'], 'x', 100).requests[0].size).toBe(25);
		expect(buildGraphSearchRequest(['chatMessage'], 'x', 3.9).requests[0].size).toBe(3);
	});
});

describe('flattenGraphSearchHits', () => {
	it('flattens value[].hitsContainers[].hits[] into a single array', () => {
		const parsed = {
			value: [
				{
					hitsContainers: [
						{ hits: [{ hitId: '1' }, { hitId: '2' }] },
						{ hits: [{ hitId: '3' }] }
					]
				}
			]
		};
		expect(flattenGraphSearchHits(parsed)).toEqual([{ hitId: '1' }, { hitId: '2' }, { hitId: '3' }]);
	});

	it('returns an empty array for missing/malformed shapes', () => {
		expect(flattenGraphSearchHits({})).toEqual([]);
		expect(flattenGraphSearchHits({ value: [] })).toEqual([]);
		expect(flattenGraphSearchHits({ value: [{ hitsContainers: [{}] }] })).toEqual([]);
	});
});
