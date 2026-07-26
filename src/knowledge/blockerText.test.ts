import { describe, it, expect } from 'vitest';
import {
	isSafeLink,
	tokenize,
	parseBlockerDirectory,
	scoreBlockerRoute,
	matchBlockerRoutes,
	formatBlockerRoutes,
	type BlockerRoute
} from './blockerText';

describe('isSafeLink', () => {
	it('accepts https, http, msteams, and mailto', () => {
		expect(isSafeLink('https://x')).toBe(true);
		expect(isSafeLink('http://x')).toBe(true);
		expect(isSafeLink('msteams:/l/chat')).toBe(true);
		expect(isSafeLink('mailto:a@b.com')).toBe(true);
	});
	it('rejects unsafe or empty schemes', () => {
		expect(isSafeLink('javascript:alert(1)')).toBe(false);
		expect(isSafeLink('file:///etc/passwd')).toBe(false);
		expect(isSafeLink('')).toBe(false);
		expect(isSafeLink(undefined)).toBe(false);
		expect(isSafeLink(42)).toBe(false);
	});
});

describe('tokenize', () => {
	it('lowercases and drops single-char and non-alphanumeric tokens', () => {
		expect(tokenize('GCP  access-request! a')).toEqual(['gcp', 'access', 'request']);
	});
});

describe('parseBlockerDirectory', () => {
	it('accepts a bare array and a { routes: [...] } wrapper', () => {
		const entry = { title: 'X', keywords: ['x'] };
		expect(parseBlockerDirectory([entry])).toHaveLength(1);
		expect(parseBlockerDirectory({ routes: [entry] })).toHaveLength(1);
	});
	it('skips entries missing a title or keywords', () => {
		const routes = parseBlockerDirectory([
			{ title: '', keywords: ['x'] },
			{ title: 'Y', keywords: [] },
			{ title: 'Z', keywords: ['z'] }
		]);
		expect(routes.map((r) => r.title)).toEqual(['Z']);
	});
	it('drops unsafe links but keeps safe ones', () => {
		const [route] = parseBlockerDirectory([
			{
				title: 'A',
				keywords: ['a'],
				url: 'javascript:alert(1)',
				teamsLink: 'https://teams.microsoft.com/l/chat',
				serviceNowUrl: 'https://sn.example/item'
			}
		]);
		expect(route.url).toBeUndefined();
		expect(route.teamsLink).toBe('https://teams.microsoft.com/l/chat');
		expect(route.serviceNowUrl).toBe('https://sn.example/item');
	});
	it('returns an empty array for malformed input', () => {
		expect(parseBlockerDirectory(null)).toEqual([]);
		expect(parseBlockerDirectory(42)).toEqual([]);
		expect(parseBlockerDirectory({})).toEqual([]);
	});
});

describe('scoreBlockerRoute', () => {
	const route: BlockerRoute = {
		title: 'GCP project access',
		category: 'access',
		keywords: ['gcp', 'google cloud', 'iam role'],
		summary: 'Request IAM roles on a GCP project.'
	};
	it('scores keyword token hits highest and rewards verbatim phrases', () => {
		expect(scoreBlockerRoute(route, 'I need gcp access')).toBeGreaterThan(0);
		const phrase = scoreBlockerRoute(route, 'how do I get google cloud permissions');
		const single = scoreBlockerRoute(route, 'cloud thing');
		expect(phrase).toBeGreaterThan(single);
	});
	it('returns 0 when nothing matches', () => {
		expect(scoreBlockerRoute(route, 'lunch menu today')).toBe(0);
		expect(scoreBlockerRoute(route, '')).toBe(0);
	});
});

describe('matchBlockerRoutes', () => {
	const routes: BlockerRoute[] = [
		{ title: 'GCP access', keywords: ['gcp', 'google cloud'] },
		{ title: 'VPN setup', keywords: ['vpn', 'network'] },
		{ title: 'Confluence access', keywords: ['confluence', 'wiki'] }
	];
	it('returns only matching routes, best first, bounded by limit', () => {
		const result = matchBlockerRoutes(routes, 'cannot reach gcp over vpn', 5);
		expect(result.map((r) => r.title)).toContain('GCP access');
		expect(result.map((r) => r.title)).toContain('VPN setup');
		expect(result.map((r) => r.title)).not.toContain('Confluence access');
	});
	it('clamps the limit to 1..10', () => {
		expect(matchBlockerRoutes(routes, 'gcp vpn confluence', 0)).toHaveLength(1);
	});
});

describe('formatBlockerRoutes', () => {
	it('renders contact, links, and steps', () => {
		const text = formatBlockerRoutes(
			[
				{
					title: 'GCP access',
					category: 'access',
					keywords: ['gcp'],
					contact: 'Platform Eng',
					teamsLink: 'https://teams.microsoft.com/l/chat',
					serviceNowUrl: 'https://sn/item',
					url: 'https://wiki/gcp',
					steps: ['Raise SN request', 'Ping platform channel']
				}
			],
			'gcp access'
		);
		expect(text).toContain('GCP access');
		expect(text).toContain('contact: Platform Eng');
		expect(text).toContain('teams: https://teams.microsoft.com/l/chat');
		expect(text).toContain('servicenow: https://sn/item');
		expect(text).toContain('page: https://wiki/gcp');
		expect(text).toContain('1. Raise SN request');
	});
	it('gives an actionable fallback when nothing matches', () => {
		const text = formatBlockerRoutes([], 'obscure thing');
		expect(text).toContain('No routing entry');
		expect(text).toContain('Open Help Directory');
	});
});
