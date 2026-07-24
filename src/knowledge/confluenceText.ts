/**
 * Pure text helpers for the Confluence integration, kept free of any `vscode`
 * import so they can be unit-tested under vitest (which has no `vscode` module).
 */

/** Removes Confluence search-highlight markers and collapses whitespace from an excerpt. */
export function cleanExcerpt(raw: string): string {
	return raw.replace(/@@@(end)?hl@@@/g, '').replace(/\s+/g, ' ').trim();
}

/** Strips HTML tags/entities from Confluence rendered body to plain-ish text. */
export function htmlToText(html: string): string {
	return html
		.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Builds a CQL query string for a free-text Confluence search restricted to pages/blogposts.
 * The user's query is embedded as a CQL string literal, so any double-quotes are escaped to
 * prevent breaking out of the literal.
 */
export function buildSearchCql(query: string, field: 'siteSearch' | 'text' = 'siteSearch'): string {
	const safeQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	return `${field} ~ "${safeQuery}" AND type in (page, blogpost)`;
}
