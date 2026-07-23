import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import type { ReportPayload } from './payload';

export interface SendReportOptions {
	endpointUrl: string;
	apiKey: string | undefined;
	allowInsecureHttp: boolean;
	timeoutMs: number;
}

export interface SendReportResult {
	ok: boolean;
	statusCode?: number;
	error?: string;
}

/**
 * POSTs an aggregate-only payload to a configured internal endpoint.
 * Security notes (OWASP-relevant):
 * - Refuses non-HTTPS endpoints unless the operator explicitly opts into
 *   `allowInsecureHttp` (for isolated intranets that genuinely have no TLS).
 * - The API key is passed in, never read from plain settings — callers are
 *   expected to source it from `vscode.ExtensionContext.secrets`.
 * - Bounded request timeout so a hung/unreachable endpoint can't block the
 *   extension host indefinitely.
 * - No cookies/credentials are sent beyond the explicit bearer header.
 */
export function sendReport(payload: ReportPayload, options: SendReportOptions): Promise<SendReportResult> {
	let url: URL;
	try {
		url = new URL(options.endpointUrl);
	} catch {
		return Promise.resolve({ ok: false, error: `Invalid reporting endpoint URL: ${options.endpointUrl}` });
	}

	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && options.allowInsecureHttp)) {
		return Promise.resolve({
			ok: false,
			error: `Refusing to send report over ${url.protocol} — endpoint must be https:// (or set usageLogger.allowInsecureHttp to override for a trusted internal intranet).`
		});
	}

	const body = Buffer.from(JSON.stringify(payload), 'utf8');
	const transport = url.protocol === 'https:' ? https : http;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'Content-Length': String(body.length)
	};
	if (options.apiKey) {
		headers['Authorization'] = `Bearer ${options.apiKey}`;
	}

	return new Promise<SendReportResult>((resolve) => {
		const req = transport.request(
			url,
			{ method: 'POST', headers, timeout: options.timeoutMs },
			(res) => {
				const statusCode = res.statusCode ?? 0;
				res.resume(); // drain response body, we don't need it
				res.on('end', () => {
					resolve({ ok: statusCode >= 200 && statusCode < 300, statusCode });
				});
			}
		);

		req.on('timeout', () => {
			req.destroy(new Error('Request timed out'));
		});

		req.on('error', (err) => {
			resolve({ ok: false, error: String(err) });
		});

		req.write(body);
		req.end();
	});
}
