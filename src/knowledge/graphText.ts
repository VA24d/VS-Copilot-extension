/**
 * Pure, vscode-free helpers for the Microsoft Graph integration (SharePoint +
 * Teams search), kept separate so they can be unit-tested under vitest.
 */

export type GraphEntityType = 'driveItem' | 'chatMessage';

/**
 * Builds the JSON body for a Microsoft Graph `/search/query` request.
 * See https://learn.microsoft.com/graph/api/search-query — one search request
 * per call, `from`/`size` bound the page, `query.queryString` is the free text.
 */
export function buildGraphSearchRequest(entityTypes: GraphEntityType[], query: string, limit: number): {
	requests: Array<{ entityTypes: GraphEntityType[]; query: { queryString: string }; from: number; size: number }>;
} {
	const size = Math.min(Math.max(1, Math.floor(limit)), 25);
	return {
		requests: [
			{
				entityTypes,
				query: { queryString: query.trim() },
				from: 0,
				size
			}
		]
	};
}

/** Flattens the `value[].hitsContainers[].hits[]` shape returned by Graph search into a single array. */
export function flattenGraphSearchHits(parsed: unknown): unknown[] {
	const value = (parsed as { value?: Array<{ hitsContainers?: Array<{ hits?: unknown[] }> }> }).value ?? [];
	const hits: unknown[] = [];
	for (const v of value) {
		for (const container of v.hitsContainers ?? []) {
			hits.push(...(container.hits ?? []));
		}
	}
	return hits;
}
