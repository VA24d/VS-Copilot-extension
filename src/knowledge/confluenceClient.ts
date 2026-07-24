import * as https from 'https';
import * as vscode from 'vscode';
import { URL } from 'url';
import { buildSearchCql, cleanExcerpt, htmlToText } from './confluenceText';

/**
 * Minimal Confluence Cloud REST client used to ground chat answers in the
 * user's organization/institution knowledge base. Read-only.
 *
 * Auth: HTTP Basic with `<atlassian-account-email>:<api-token>`, per Atlassian's
 * "Basic auth for REST APIs" guidance. The API token is stored in
 * `vscode.ExtensionContext.secrets` (never settings.json). The base URL and email
 * live in normal settings since they aren't secrets.
 *
 * Security notes (OWASP-relevant):
 * - HTTPS is required (Atlassian Cloud is always TLS); http:// is refused to avoid
 *   sending Basic credentials in the clear.
 * - Bounded request timeout so an unreachable host can't hang the extension host.
 * - The token is never logged; only high-level errors are surfaced.
 * - Responses are size-capped to avoid unbounded memory use from a hostile/huge page.
 */

export const CONFLUENCE_TOKEN_SECRET_KEY = 'usageLogger.confluenceApiToken';

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB hard cap on any single response

export interface ConfluenceConfig {
	/** e.g. https://yourcompany.atlassian.net/wiki */
	baseUrl: string;
	email: string;
	apiToken: string;
}

export interface ConfluenceSearchResult {
	id: string;
	title: string;
	spaceKey?: string;
	url: string;
	excerpt: string;
	lastModified?: string;
}

export interface ConfluencePageContent {
	id: string;
	title: string;
	spaceKey?: string;
	url: string;
	text: string;
}

/** Resolves the full Confluence config from settings + secret storage, or undefined if not fully configured. */
export async function getConfluenceConfig(context: vscode.ExtensionContext): Promise<ConfluenceConfig | undefined> {
	const config = vscode.workspace.getConfiguration('usageLogger');
	const baseUrl = config.get<string>('confluenceBaseUrl', '').trim();
	const email = config.get<string>('confluenceEmail', '').trim();
	const apiToken = (await context.secrets.get(CONFLUENCE_TOKEN_SECRET_KEY))?.trim();
	if (!baseUrl || !email || !apiToken) {
		return undefined;
	}
	return { baseUrl: baseUrl.replace(/\/+$/, ''), email, apiToken };
}

function authHeader(config: ConfluenceConfig): string {
	const encoded = Buffer.from(`${config.email}:${config.apiToken}`, 'utf8').toString('base64');
	return `Basic ${encoded}`;
}

interface HttpJsonResult {
	statusCode: number;
	body: string;
}

function httpGetJson(targetUrl: URL, config: ConfluenceConfig, timeoutMs: number): Promise<HttpJsonResult> {
	if (targetUrl.protocol !== 'https:') {
		return Promise.reject(new Error(`Refusing to call Confluence over ${targetUrl.protocol} — the base URL must be https://.`));
	}
	return new Promise<HttpJsonResult>((resolve, reject) => {
		const req = https.request(
			targetUrl,
			{
				method: 'GET',
				timeout: timeoutMs,
				headers: {
					'Authorization': authHeader(config),
					'Accept': 'application/json'
				}
			},
			(res) => {
				const chunks: Buffer[] = [];
				let total = 0;
				res.on('data', (chunk: Buffer) => {
					total += chunk.length;
					if (total > MAX_RESPONSE_BYTES) {
						req.destroy(new Error('Confluence response exceeded size limit'));
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () => {
					resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
				});
			}
		);
		req.on('timeout', () => req.destroy(new Error('Confluence request timed out')));
		req.on('error', (err) => reject(err));
		req.end();
	});
}

/**
 * Searches Confluence content for the given free-text query and returns the top matches.
 * Uses CQL text search restricted to pages/blogposts.
 */
export async function searchConfluence(
	config: ConfluenceConfig,
	query: string,
	limit = 5,
	timeoutMs = 10_000
): Promise<ConfluenceSearchResult[]> {
	const boundedLimit = Math.min(Math.max(1, Math.floor(limit)), 15);
	const url = new URL(`${config.baseUrl}/rest/api/search`);
	url.searchParams.set('cql', buildSearchCql(query, 'siteSearch'));
	url.searchParams.set('limit', String(boundedLimit));
	url.searchParams.set('excerpt', 'highlight');

	let res: HttpJsonResult;
	try {
		res = await httpGetJson(url, config, timeoutMs);
	} catch (err) {
		// siteSearch requires a Confluence feature that some sites lack; fall back to plain text search.
		const fallback = new URL(`${config.baseUrl}/rest/api/search`);
		fallback.searchParams.set('cql', buildSearchCql(query, 'text'));
		fallback.searchParams.set('limit', String(boundedLimit));
		fallback.searchParams.set('excerpt', 'highlight');
		res = await httpGetJson(fallback, config, timeoutMs);
		void err;
	}

	if (res.statusCode === 401 || res.statusCode === 403) {
		throw new Error('Confluence authentication failed (check email + API token and that the account can view content).');
	}
	if (res.statusCode < 200 || res.statusCode >= 300) {
		throw new Error(`Confluence search failed with HTTP ${res.statusCode}.`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(res.body);
	} catch {
		throw new Error('Confluence returned a response that could not be parsed.');
	}

	const data = parsed as { results?: unknown[]; _links?: { base?: string } };
	const linkBase = (data._links?.base ?? config.baseUrl).replace(/\/+$/, '');
	const results = Array.isArray(data.results) ? data.results : [];

	return results.map((raw): ConfluenceSearchResult => {
		const item = raw as {
			content?: { id?: string; title?: string; _links?: { webui?: string } };
			title?: string;
			excerpt?: string;
			url?: string;
			lastModified?: string;
			resultGlobalContainer?: { title?: string };
		};
		const webui = item.content?._links?.webui ?? item.url ?? '';
		return {
			id: item.content?.id ?? '',
			title: cleanExcerpt(item.content?.title ?? item.title ?? '(untitled)'),
			spaceKey: item.resultGlobalContainer?.title,
			url: webui.startsWith('http') ? webui : `${linkBase}${webui}`,
			excerpt: cleanExcerpt(item.excerpt ?? ''),
			lastModified: item.lastModified
		};
	}).filter((r) => r.id !== '');
}

/** Fetches a single Confluence page's rendered body as plain text. */
export async function getConfluencePage(
	config: ConfluenceConfig,
	pageId: string,
	timeoutMs = 10_000
): Promise<ConfluencePageContent> {
	if (!/^\d+$/.test(pageId)) {
		throw new Error('Invalid Confluence page id — expected a numeric id (as returned by search_confluence).');
	}
	const url = new URL(`${config.baseUrl}/rest/api/content/${pageId}`);
	url.searchParams.set('expand', 'body.view,space');

	const res = await httpGetJson(url, config, timeoutMs);
	if (res.statusCode === 401 || res.statusCode === 403) {
		throw new Error('Confluence authentication failed (check email + API token and page permissions).');
	}
	if (res.statusCode === 404) {
		throw new Error(`Confluence page ${pageId} was not found (or you lack permission to view it).`);
	}
	if (res.statusCode < 200 || res.statusCode >= 300) {
		throw new Error(`Confluence page fetch failed with HTTP ${res.statusCode}.`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(res.body);
	} catch {
		throw new Error('Confluence returned a response that could not be parsed.');
	}

	const page = parsed as {
		id?: string;
		title?: string;
		space?: { key?: string };
		body?: { view?: { value?: string } };
		_links?: { base?: string; webui?: string };
	};
	const linkBase = (page._links?.base ?? config.baseUrl).replace(/\/+$/, '');
	const webui = page._links?.webui ?? '';
	return {
		id: page.id ?? pageId,
		title: page.title ?? '(untitled)',
		spaceKey: page.space?.key,
		url: webui.startsWith('http') ? webui : `${linkBase}${webui}`,
		text: htmlToText(page.body?.view?.value ?? '')
	};
}
