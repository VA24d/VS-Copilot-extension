/**
 * Pure, vscode-free helpers for the "find help" skill — routing a non-code
 * blocker (access request, environment issue, tooling, permission, onboarding,
 * process question) to the right contact, page, Teams chat, or ServiceNow
 * catalog item. Kept separate so the matching/formatting logic can be
 * unit-tested under vitest without any editor dependency.
 */

/** A single routing entry in the org's blocker directory. */
export interface BlockerRoute {
	/** Short human label, e.g. "GCP project access". */
	title: string;
	/** Optional grouping, e.g. "access", "environment", "tooling", "onboarding". */
	category?: string;
	/** Match terms — the more specific, the better the routing. */
	keywords: string[];
	/** One or two sentences: what this covers / when it applies. */
	summary?: string;
	/** Person or team to contact, e.g. "Platform Engineering (Jane Doe)". */
	contact?: string;
	/** Microsoft Teams deep link (https://teams.microsoft.com/... or msteams:...). */
	teamsLink?: string;
	/** ServiceNow catalog item / request URL. */
	serviceNowUrl?: string;
	/** Confluence/SharePoint/intranet page URL. */
	url?: string;
	/** Optional ordered steps the user should take. */
	steps?: string[];
}

/** URL schemes we are willing to surface. Anything else is dropped defensively. */
const SAFE_LINK_SCHEMES = ['https:', 'http:', 'msteams:', 'mailto:'];

/** Returns true if `value` is a link with a scheme we are willing to render. */
export function isSafeLink(value: unknown): value is string {
	if (typeof value !== 'string' || value.trim() === '') {
		return false;
	}
	const trimmed = value.trim();
	// msteams: and mailto: are not parseable by URL without special handling.
	for (const scheme of SAFE_LINK_SCHEMES) {
		if (trimmed.toLowerCase().startsWith(scheme)) {
			return true;
		}
	}
	return false;
}

/** Lowercases and splits a string into alphanumeric word tokens. */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 1);
}

/**
 * Normalizes arbitrary parsed JSON into a validated list of routes. Accepts
 * either a bare array or an object of the form `{ routes: [...] }`. Entries
 * missing a title or keywords are skipped. Unsafe links are dropped.
 */
export function parseBlockerDirectory(raw: unknown): BlockerRoute[] {
	const list: unknown[] = Array.isArray(raw)
		? raw
		: Array.isArray((raw as { routes?: unknown[] })?.routes)
			? (raw as { routes: unknown[] }).routes
			: [];

	const routes: BlockerRoute[] = [];
	for (const item of list) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const obj = item as Record<string, unknown>;
		const title = typeof obj.title === 'string' ? obj.title.trim() : '';
		const keywords = Array.isArray(obj.keywords)
			? obj.keywords.filter((k): k is string => typeof k === 'string' && k.trim() !== '').map((k) => k.trim())
			: [];
		if (!title || keywords.length === 0) {
			continue;
		}
		const steps = Array.isArray(obj.steps)
			? obj.steps.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim())
			: undefined;
		routes.push({
			title,
			keywords,
			category: typeof obj.category === 'string' && obj.category.trim() ? obj.category.trim() : undefined,
			summary: typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : undefined,
			contact: typeof obj.contact === 'string' && obj.contact.trim() ? obj.contact.trim() : undefined,
			teamsLink: isSafeLink(obj.teamsLink) ? obj.teamsLink.trim() : undefined,
			serviceNowUrl: isSafeLink(obj.serviceNowUrl) ? obj.serviceNowUrl.trim() : undefined,
			url: isSafeLink(obj.url) ? obj.url.trim() : undefined,
			steps: steps && steps.length > 0 ? steps : undefined
		});
	}
	return routes;
}

/**
 * Scores how well a route matches the free-text blocker description. Keyword hits
 * are weighted highest, then title, then category, then summary. A keyword phrase
 * appearing verbatim in the query earns a bonus so multi-word keywords beat
 * incidental single-token overlaps.
 */
export function scoreBlockerRoute(route: BlockerRoute, query: string): number {
	const queryLower = query.toLowerCase();
	const queryTokens = new Set(tokenize(query));
	if (queryTokens.size === 0) {
		return 0;
	}
	let score = 0;

	for (const keyword of route.keywords) {
		const kwLower = keyword.toLowerCase();
		if (kwLower.includes(' ') && queryLower.includes(kwLower)) {
			score += 5; // verbatim multi-word phrase match
		}
		for (const token of tokenize(keyword)) {
			if (queryTokens.has(token)) {
				score += 3;
			}
		}
	}
	for (const token of tokenize(route.title)) {
		if (queryTokens.has(token)) {
			score += 2;
		}
	}
	if (route.category) {
		for (const token of tokenize(route.category)) {
			if (queryTokens.has(token)) {
				score += 2;
			}
		}
	}
	if (route.summary) {
		for (const token of tokenize(route.summary)) {
			if (queryTokens.has(token)) {
				score += 1;
			}
		}
	}
	return score;
}

/**
 * Returns the top `limit` routes whose score is > 0, highest first. Ties keep the
 * directory's original order (stable), so authors can prioritise entries by
 * placing them earlier in the file.
 */
export function matchBlockerRoutes(routes: BlockerRoute[], query: string, limit: number): BlockerRoute[] {
	const bounded = Math.min(Math.max(1, Math.floor(limit)), 10);
	const scored = routes
		.map((route, index) => ({ route, index, score: scoreBlockerRoute(route, query) }))
		.filter((s) => s.score > 0)
		.sort((a, b) => (b.score - a.score) || (a.index - b.index));
	return scored.slice(0, bounded).map((s) => s.route);
}

/** Renders matched routes into a compact, model-friendly plain-text block. */
export function formatBlockerRoutes(matches: BlockerRoute[], query: string): string {
	if (matches.length === 0) {
		return (
			`No routing entry in the blocker directory matched "${query}". ` +
			'Suggest the user broaden their description, or ask a team lead / their manager who owns this area — ' +
			'and consider adding an entry via "Copilot Usage: Open Help Directory" so the next person is routed automatically.'
		);
	}
	const blocks = matches.map((r, i) => {
		const lines: string[] = [`${i + 1}. ${r.title}${r.category ? `  [${r.category}]` : ''}`];
		if (r.summary) {
			lines.push(`   ${r.summary}`);
		}
		if (r.contact) {
			lines.push(`   contact: ${r.contact}`);
		}
		if (r.teamsLink) {
			lines.push(`   teams: ${r.teamsLink}`);
		}
		if (r.serviceNowUrl) {
			lines.push(`   servicenow: ${r.serviceNowUrl}`);
		}
		if (r.url) {
			lines.push(`   page: ${r.url}`);
		}
		if (r.steps && r.steps.length > 0) {
			lines.push('   steps:');
			r.steps.forEach((s, si) => lines.push(`     ${si + 1}. ${s}`));
		}
		return lines.join('\n');
	});
	return (
		`Found ${matches.length} routing suggestion(s) for "${query}". ` +
		'Point the user at the most relevant contact / link below rather than guessing — ' +
		'these are the sanctioned owners for this kind of blocker.\n\n' +
		blocks.join('\n\n')
	);
}
