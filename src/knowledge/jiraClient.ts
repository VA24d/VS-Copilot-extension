import * as vscode from 'vscode';
import { URL } from 'url';
import { getAtlassianCredentials } from './atlassianAuth';
import { htmlToText } from './confluenceText';
import { basicAuthHeader, httpGetJson, type HttpJsonResult } from './httpJson';
import { buildIssueSearchJql } from './jiraText';

/**
 * Minimal Jira Cloud REST client used to ground chat answers in the org's issue
 * tracker (tickets, acceptance criteria, status). Read-only. Shares the Atlassian
 * account email + API token with the Confluence integration (see atlassianAuth.ts);
 * only the Jira base URL is separate. Same security posture as the Confluence client
 * (HTTPS only, bounded timeout/size, token never logged, honors Jira permissions).
 */

export interface JiraConfig {
	/** e.g. https://yourcompany.atlassian.net (no /wiki suffix) */
	baseUrl: string;
	email: string;
	apiToken: string;
}

export interface JiraSearchResult {
	key: string;
	summary: string;
	status?: string;
	issueType?: string;
	assignee?: string;
	updated?: string;
	url: string;
}

export interface JiraIssueDetail {
	key: string;
	summary: string;
	status?: string;
	issueType?: string;
	priority?: string;
	assignee?: string;
	reporter?: string;
	updated?: string;
	url: string;
	description: string;
}

/** Resolves the Jira config from settings + shared Atlassian credentials, or undefined if not fully configured. */
export async function getJiraConfig(context: vscode.ExtensionContext): Promise<JiraConfig | undefined> {
	const baseUrl = vscode.workspace.getConfiguration('usageLogger').get<string>('jiraBaseUrl', '').trim();
	const creds = await getAtlassianCredentials(context);
	if (!baseUrl || !creds) {
		return undefined;
	}
	return { baseUrl: baseUrl.replace(/\/+$/, ''), email: creds.email, apiToken: creds.apiToken };
}

function jiraGet(config: JiraConfig, targetUrl: URL, timeoutMs: number): Promise<HttpJsonResult> {
	return httpGetJson(targetUrl, { Authorization: basicAuthHeader(config.email, config.apiToken) }, timeoutMs);
}

function issueUrl(baseUrl: string, key: string): string {
	return `${baseUrl}/browse/${key}`;
}

function checkStatus(res: HttpJsonResult, whatFailed: string): void {
	if (res.statusCode === 401 || res.statusCode === 403) {
		throw new Error('Jira authentication failed (check the Atlassian email + API token and that the account can view issues).');
	}
	if (res.statusCode === 404) {
		throw new Error(`${whatFailed} — not found (or you lack permission to view it).`);
	}
	if (res.statusCode < 200 || res.statusCode >= 300) {
		throw new Error(`${whatFailed} with HTTP ${res.statusCode}.`);
	}
}

/** Searches Jira issues by free text, most-recently-updated first. */
export async function searchJira(
	config: JiraConfig,
	query: string,
	limit = 5,
	timeoutMs = 10_000
): Promise<JiraSearchResult[]> {
	const boundedLimit = Math.min(Math.max(1, Math.floor(limit)), 20);
	const url = new URL(`${config.baseUrl}/rest/api/3/search/jql`);
	url.searchParams.set('jql', buildIssueSearchJql(query));
	url.searchParams.set('maxResults', String(boundedLimit));
	url.searchParams.set('fields', 'summary,status,assignee,issuetype,updated');

	const res = await jiraGet(config, url, timeoutMs);
	checkStatus(res, 'Jira search failed');

	let parsed: unknown;
	try {
		parsed = JSON.parse(res.body);
	} catch {
		throw new Error('Jira returned a response that could not be parsed.');
	}

	const data = parsed as { issues?: unknown[] };
	const issues = Array.isArray(data.issues) ? data.issues : [];
	return issues.map((raw): JiraSearchResult => {
		const issue = raw as {
			key?: string;
			fields?: {
				summary?: string;
				status?: { name?: string };
				assignee?: { displayName?: string };
				issuetype?: { name?: string };
				updated?: string;
			};
		};
		const key = issue.key ?? '';
		return {
			key,
			summary: issue.fields?.summary ?? '(no summary)',
			status: issue.fields?.status?.name,
			issueType: issue.fields?.issuetype?.name,
			assignee: issue.fields?.assignee?.displayName,
			updated: issue.fields?.updated,
			url: issueUrl(config.baseUrl, key)
		};
	}).filter((r) => r.key !== '');
}

/** Fetches a single Jira issue's key fields and rendered (HTML-stripped) description. */
export async function getJiraIssue(
	config: JiraConfig,
	issueKey: string,
	timeoutMs = 10_000
): Promise<JiraIssueDetail> {
	if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(issueKey)) {
		throw new Error('Invalid Jira issue key — expected a key like "PROJ-123" (as returned by search_jira).');
	}
	const url = new URL(`${config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`);
	url.searchParams.set('fields', 'summary,status,assignee,reporter,issuetype,priority,updated');
	url.searchParams.set('expand', 'renderedFields');

	const res = await jiraGet(config, url, timeoutMs);
	checkStatus(res, `Jira issue ${issueKey} fetch failed`);

	let parsed: unknown;
	try {
		parsed = JSON.parse(res.body);
	} catch {
		throw new Error('Jira returned a response that could not be parsed.');
	}

	const issue = parsed as {
		key?: string;
		fields?: {
			summary?: string;
			status?: { name?: string };
			assignee?: { displayName?: string };
			reporter?: { displayName?: string };
			issuetype?: { name?: string };
			priority?: { name?: string };
			updated?: string;
		};
		renderedFields?: { description?: string };
	};
	const key = issue.key ?? issueKey;
	return {
		key,
		summary: issue.fields?.summary ?? '(no summary)',
		status: issue.fields?.status?.name,
		issueType: issue.fields?.issuetype?.name,
		priority: issue.fields?.priority?.name,
		assignee: issue.fields?.assignee?.displayName,
		reporter: issue.fields?.reporter?.displayName,
		updated: issue.fields?.updated,
		url: issueUrl(config.baseUrl, key),
		description: htmlToText(issue.renderedFields?.description ?? '')
	};
}
