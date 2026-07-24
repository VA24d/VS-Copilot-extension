/**
 * Pure, vscode-free JQL helper for the Jira integration, kept separate so it can
 * be unit-tested under vitest.
 */

/**
 * Builds a JQL query for a free-text issue search, most-recently-updated first.
 * The user's text is embedded as a JQL string literal, so backslashes and double
 * quotes are escaped to prevent breaking out of the literal.
 */
export function buildIssueSearchJql(query: string): string {
	const safe = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	return `text ~ "${safe}" ORDER BY updated DESC`;
}
