/**
 * Pure, vscode-free helper for the GitHub integration, kept separate so it can be
 * unit-tested under vitest.
 */

export type GithubSearchType = 'issues' | 'code' | 'repositories';

/**
 * Appends an `org:<org>` qualifier to a GitHub search query to scope results to a
 * single organization, unless the caller already specified an `org:`/`user:`/`repo:`
 * qualifier. The user's free text is preserved as-is (GitHub search operates on
 * qualifiers, not a quoted-string grammar, so no escaping is required here).
 */
export function buildGithubQuery(query: string, org: string | undefined): string {
	const trimmed = query.trim();
	if (!org || /\b(org|user|repo):/i.test(trimmed)) {
		return trimmed;
	}
	return `${trimmed} org:${org}`.trim();
}
