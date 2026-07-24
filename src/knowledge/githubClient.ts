import * as vscode from 'vscode';
import { URL } from 'url';
import { buildGithubQuery, type GithubSearchType } from './githubText';
import { httpGetJson, type HttpJsonResult } from './httpJson';

/**
 * Minimal GitHub REST search client used to ground chat answers in the org's issues,
 * pull requests, code, and repositories beyond the currently-open workspace. Read-only.
 *
 * Auth: a personal access token (classic or fine-grained) stored in secret storage
 * (never settings.json), sent as a Bearer token. Same defensive posture as the other
 * knowledge clients (HTTPS only, bounded timeout/size, token never logged, honors the
 * token's own repo permissions).
 */

export const GITHUB_TOKEN_SECRET_KEY = 'usageLogger.githubToken';

const GITHUB_API_BASE = 'https://api.github.com';

export interface GithubConfig {
	token: string;
	/** Optional org/login to scope searches to. */
	org?: string;
}

export interface GithubSearchItem {
	title: string;
	url: string;
	detail: string;
}

/** Resolves GitHub config from secret storage (token) + settings (optional org), or undefined if no token. */
export async function getGithubConfig(context: vscode.ExtensionContext): Promise<GithubConfig | undefined> {
	const token = (await context.secrets.get(GITHUB_TOKEN_SECRET_KEY))?.trim();
	if (!token) {
		return undefined;
	}
	const org = vscode.workspace.getConfiguration('usageLogger').get<string>('githubOrg', '').trim() || undefined;
	return { token, org };
}

function githubGet(config: GithubConfig, targetUrl: URL, timeoutMs: number): Promise<HttpJsonResult> {
	return httpGetJson(
		targetUrl,
		{
			Authorization: `Bearer ${config.token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'User-Agent': 'copilot-usage-logger'
		},
		timeoutMs
	);
}

interface RawIssue {
	title?: string;
	html_url?: string;
	number?: number;
	state?: string;
	repository_url?: string;
	user?: { login?: string };
	updated_at?: string;
	pull_request?: unknown;
}
interface RawCode {
	name?: string;
	path?: string;
	html_url?: string;
	repository?: { full_name?: string };
}
interface RawRepo {
	full_name?: string;
	html_url?: string;
	description?: string;
	stargazers_count?: number;
}

function repoFromApiUrl(repositoryUrl: string | undefined): string {
	// https://api.github.com/repos/OWNER/NAME -> OWNER/NAME
	if (!repositoryUrl) {
		return '';
	}
	const m = repositoryUrl.match(/repos\/([^/]+\/[^/]+)$/);
	return m ? m[1] : '';
}

/**
 * Searches GitHub for issues/PRs, code, or repositories matching the query.
 * Results are scoped to `config.org` when set (unless the query already has an org/user/repo qualifier).
 */
export async function searchGithub(
	config: GithubConfig,
	query: string,
	type: GithubSearchType = 'issues',
	limit = 5,
	timeoutMs = 10_000
): Promise<GithubSearchItem[]> {
	const boundedLimit = Math.min(Math.max(1, Math.floor(limit)), 20);
	const q = buildGithubQuery(query, config.org);
	if (!q) {
		throw new Error('Provide a non-empty GitHub search query.');
	}
	const url = new URL(`${GITHUB_API_BASE}/search/${type}`);
	url.searchParams.set('q', q);
	url.searchParams.set('per_page', String(boundedLimit));

	const res = await githubGet(config, url, timeoutMs);
	if (res.statusCode === 401 || res.statusCode === 403) {
		throw new Error('GitHub authentication failed or rate-limited (check the token and its scopes; code search requires an authenticated token).');
	}
	if (res.statusCode === 422) {
		throw new Error('GitHub rejected the search query (422) — try simpler terms, or add an org/repo qualifier.');
	}
	if (res.statusCode < 200 || res.statusCode >= 300) {
		throw new Error(`GitHub search failed with HTTP ${res.statusCode}.`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(res.body);
	} catch {
		throw new Error('GitHub returned a response that could not be parsed.');
	}
	const items = (parsed as { items?: unknown[] }).items ?? [];

	if (type === 'code') {
		return (items as RawCode[]).map((it) => ({
			title: `${it.repository?.full_name ?? ''}: ${it.path ?? it.name ?? ''}`.trim(),
			url: it.html_url ?? '',
			detail: it.path ?? ''
		})).filter((r) => r.url !== '');
	}
	if (type === 'repositories') {
		return (items as RawRepo[]).map((it) => ({
			title: it.full_name ?? '',
			url: it.html_url ?? '',
			detail: (it.description ?? '') + (typeof it.stargazers_count === 'number' ? ` (★${it.stargazers_count})` : '')
		})).filter((r) => r.url !== '');
	}
	// issues (and pull requests)
	return (items as RawIssue[]).map((it) => {
		const repo = repoFromApiUrl(it.repository_url);
		const kind = it.pull_request ? 'PR' : 'issue';
		return {
			title: `${repo ? repo + ' ' : ''}#${it.number ?? '?'} ${it.title ?? ''}`.trim(),
			url: it.html_url ?? '',
			detail: `${kind}, ${it.state ?? ''}${it.user?.login ? ', by ' + it.user.login : ''}`
		};
	}).filter((r) => r.url !== '');
}
