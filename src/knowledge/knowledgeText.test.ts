import { describe, expect, it } from 'vitest';
import { buildIssueSearchJql } from './jiraText';
import { buildGithubQuery } from './githubText';

describe('buildIssueSearchJql', () => {
	it('builds a text search ordered by most recently updated', () => {
		expect(buildIssueSearchJql('payment timeout')).toBe('text ~ "payment timeout" ORDER BY updated DESC');
	});

	it('escapes double quotes to prevent breaking out of the JQL literal', () => {
		expect(buildIssueSearchJql('say "hi"')).toBe('text ~ "say \\"hi\\"" ORDER BY updated DESC');
	});

	it('escapes backslashes before quotes', () => {
		expect(buildIssueSearchJql('a\\b')).toBe('text ~ "a\\\\b" ORDER BY updated DESC');
	});
});

describe('buildGithubQuery', () => {
	it('appends org qualifier when an org is provided', () => {
		expect(buildGithubQuery('retry logic', 'acme')).toBe('retry logic org:acme');
	});

	it('leaves the query unchanged when no org is provided', () => {
		expect(buildGithubQuery('retry logic', undefined)).toBe('retry logic');
		expect(buildGithubQuery('retry logic', '')).toBe('retry logic');
	});

	it('does not add org when the query already scopes with org/user/repo', () => {
		expect(buildGithubQuery('bug repo:acme/api', 'acme')).toBe('bug repo:acme/api');
		expect(buildGithubQuery('bug org:other', 'acme')).toBe('bug org:other');
		expect(buildGithubQuery('bug user:someone', 'acme')).toBe('bug user:someone');
	});

	it('trims surrounding whitespace', () => {
		expect(buildGithubQuery('  spaced  ', 'acme')).toBe('spaced org:acme');
	});
});
