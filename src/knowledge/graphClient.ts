import * as vscode from 'vscode';
import { URL } from 'url';
import { htmlToText } from './confluenceText';
import { buildGraphSearchRequest, flattenGraphSearchHits, type GraphEntityType } from './graphText';
import { httpPostJson } from './httpJson';

/**
 * Microsoft Graph search client used to ground chat answers in the org's SharePoint
 * documents and Microsoft Teams messages. Read-only (Graph `/search/query` only).
 *
 * Auth: a Microsoft Graph access token (delegated, e.g. `az account get-access-token
 * --resource https://graph.microsoft.com`) stored in secret storage, sent as a
 * Bearer token. One token authenticates both SharePoint and Teams search, since
 * both go through the same Graph search endpoint. Unlike the GitHub/Atlassian
 * tokens, Graph access tokens are short-lived (typically ~1 hour) and must be
 * refreshed periodically by the user — this is called out in the setup command
 * and README, not solved automatically (no OAuth flow is implemented here).
 *
 * Same defensive posture as the other knowledge clients: HTTPS only, bounded
 * timeout/size, token never logged, honors the token's own Graph permissions
 * (Sites.Read.All / Files.Read.All for SharePoint, Chat.Read / ChannelMessage.Read.All
 * for Teams).
 */

export const GRAPH_TOKEN_SECRET_KEY = 'usageLogger.graphToken';

const GRAPH_SEARCH_URL = 'https://graph.microsoft.com/v1.0/search/query';

export interface GraphConfig {
	token: string;
}

export interface GraphSearchItem {
	title: string;
	url: string;
	detail: string;
}

/** Resolves the Microsoft Graph access token from secret storage, or undefined if none is stored. */
export async function getGraphConfig(context: vscode.ExtensionContext): Promise<GraphConfig | undefined> {
	const token = (await context.secrets.get(GRAPH_TOKEN_SECRET_KEY))?.trim();
	if (!token) {
		return undefined;
	}
	return { token };
}

async function graphSearch(config: GraphConfig, entityTypes: GraphEntityType[], query: string, limit: number, timeoutMs: number): Promise<unknown[]> {
	const trimmed = query.trim();
	if (!trimmed) {
		throw new Error('Provide a non-empty search query.');
	}
	const body = buildGraphSearchRequest(entityTypes, trimmed, limit);
	const res = await httpPostJson(new URL(GRAPH_SEARCH_URL), { Authorization: `Bearer ${config.token}` }, body, timeoutMs);

	if (res.statusCode === 401 || res.statusCode === 403) {
		throw new Error(
			'Microsoft Graph authentication failed, or the token lacks the required permissions/consent ' +
			'(Sites.Read.All for SharePoint, Chat.Read / ChannelMessage.Read.All for Teams). ' +
			'Graph tokens are also short-lived — try re-running "Copilot Usage: Set Microsoft Graph Token" with a fresh one.'
		);
	}
	if (res.statusCode < 200 || res.statusCode >= 300) {
		throw new Error(`Microsoft Graph search failed with HTTP ${res.statusCode}.`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(res.body);
	} catch {
		throw new Error('Microsoft Graph returned a response that could not be parsed.');
	}
	return flattenGraphSearchHits(parsed);
}

interface DriveItemResource {
	name?: string;
	webUrl?: string;
	lastModifiedDateTime?: string;
}

interface ChatMessageResource {
	webUrl?: string;
	createdDateTime?: string;
	from?: { user?: { displayName?: string } };
	body?: { content?: string };
}

/** Searches SharePoint/OneDrive documents matching the query. Requires Sites.Read.All (or Files.Read.All). */
export async function searchSharePoint(config: GraphConfig, query: string, limit = 5, timeoutMs = 10_000): Promise<GraphSearchItem[]> {
	const hits = await graphSearch(config, ['driveItem'], query, limit, timeoutMs);
	return (hits as Array<{ resource?: DriveItemResource; summary?: string }>)
		.map((hit) => {
			const resource = hit.resource ?? {};
			const detailParts = [
				hit.summary ? htmlToText(hit.summary) : undefined,
				resource.lastModifiedDateTime ? `modified ${resource.lastModifiedDateTime}` : undefined
			].filter((p): p is string => Boolean(p));
			return {
				title: resource.name ?? '(untitled)',
				url: resource.webUrl ?? '',
				detail: detailParts.join(' — ')
			};
		})
		.filter((item) => item.url !== '');
}

/** Searches Microsoft Teams chat/channel messages matching the query. Requires Chat.Read and/or ChannelMessage.Read.All. */
export async function searchTeams(config: GraphConfig, query: string, limit = 5, timeoutMs = 10_000): Promise<GraphSearchItem[]> {
	const hits = await graphSearch(config, ['chatMessage'], query, limit, timeoutMs);
	return (hits as Array<{ resource?: ChatMessageResource; summary?: string }>)
		.map((hit) => {
			const resource = hit.resource ?? {};
			const from = resource.from?.user?.displayName ?? 'unknown sender';
			const snippet = htmlToText(resource.body?.content ?? hit.summary ?? '');
			const detailParts = [snippet, resource.createdDateTime].filter((p): p is string => Boolean(p));
			return {
				title: `Message from ${from}`,
				url: resource.webUrl ?? '',
				detail: detailParts.join(' — ')
			};
		})
		.filter((item) => item.url !== '');
}
