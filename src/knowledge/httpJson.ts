import * as https from 'https';
import { URL } from 'url';

/**
 * Generic, vscode-free HTTPS GET-JSON helper shared by the knowledge integrations
 * (Confluence, Jira, GitHub). Kept dependency-light and defensive:
 * - HTTPS only (refuses http:// so credentials are never sent in the clear).
 * - Bounded response size and request timeout to protect the extension host.
 * - Never logs headers/credentials; callers pass an already-built auth header.
 */

const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface HttpJsonResult {
	statusCode: number;
	body: string;
}

export function httpGetJson(
	targetUrl: URL,
	headers: Record<string, string>,
	timeoutMs = 10_000,
	maxBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<HttpJsonResult> {
	if (targetUrl.protocol !== 'https:') {
		return Promise.reject(new Error(`Refusing to call ${targetUrl.host} over ${targetUrl.protocol} — the URL must be https://.`));
	}
	return new Promise<HttpJsonResult>((resolve, reject) => {
		const req = https.request(
			targetUrl,
			{ method: 'GET', timeout: timeoutMs, headers: { Accept: 'application/json', ...headers } },
			(res) => {
				const chunks: Buffer[] = [];
				let total = 0;
				res.on('data', (chunk: Buffer) => {
					total += chunk.length;
					if (total > maxBytes) {
						req.destroy(new Error('Response exceeded size limit'));
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
			}
		);
		req.on('timeout', () => req.destroy(new Error('Request timed out')));
		req.on('error', (err) => reject(err));
		req.end();
	});
}

/** Builds an HTTP Basic auth header value from an email/username and token/password. */
export function basicAuthHeader(user: string, secret: string): string {
	return `Basic ${Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')}`;
}
