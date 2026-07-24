import { describe, expect, it } from 'vitest';
import { buildSearchCql, cleanExcerpt, htmlToText } from './confluenceText';

describe('htmlToText', () => {
	it('strips tags and decodes common entities', () => {
		const html = '<p>Hello&nbsp;<strong>world</strong> &amp; friends</p>';
		expect(htmlToText(html)).toBe('Hello world & friends');
	});

	it('drops script and style contents entirely', () => {
		const html = '<div>keep<script>alert(1)</script>this</div><style>.x{color:red}</style>';
		expect(htmlToText(html)).toBe('keep this');
	});

	it('collapses whitespace and trims', () => {
		expect(htmlToText('  <p>a</p>\n\n   <p>b</p>  ')).toBe('a b');
	});

	it('returns empty string for empty input', () => {
		expect(htmlToText('')).toBe('');
	});
});

describe('cleanExcerpt', () => {
	it('removes highlight markers', () => {
		expect(cleanExcerpt('the @@@hl@@@payments@@@endhl@@@ runbook')).toBe('the payments runbook');
	});

	it('collapses whitespace and trims', () => {
		expect(cleanExcerpt('  a   b\tc  ')).toBe('a b c');
	});
});

describe('buildSearchCql', () => {
	it('builds a siteSearch query restricted to pages and blogposts', () => {
		expect(buildSearchCql('deployment guide')).toBe('siteSearch ~ "deployment guide" AND type in (page, blogpost)');
	});

	it('supports the text field fallback', () => {
		expect(buildSearchCql('deployment guide', 'text')).toBe('text ~ "deployment guide" AND type in (page, blogpost)');
	});

	it('escapes double quotes to prevent breaking out of the CQL literal', () => {
		expect(buildSearchCql('say "hi"')).toBe('siteSearch ~ "say \\"hi\\"" AND type in (page, blogpost)');
	});

	it('escapes backslashes before quotes', () => {
		expect(buildSearchCql('path\\to')).toBe('siteSearch ~ "path\\\\to" AND type in (page, blogpost)');
	});
});
