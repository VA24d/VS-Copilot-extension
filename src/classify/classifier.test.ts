import { describe, expect, it } from 'vitest';
import { classify } from './classifier';
import { FALLBACK_CATEGORY } from './categories';

describe('classify', () => {
	it('matches a code-gen keyword', () => {
		expect(classify('write a function that sums an array', undefined)).toBe('code-gen');
	});

	it('matches a debug-fix keyword', () => {
		expect(classify('why is this throwing a null reference exception', undefined)).toBe('debug-fix');
	});

	it('prefers a slash command over a weaker keyword match elsewhere', () => {
		// slashCommand arrives without the leading "/" (matches vscode's ChatRequest.command shape)
		expect(classify('please help', 'fix')).toBe('debug-fix');
	});

	it('is case-insensitive', () => {
		expect(classify('REFACTOR this class to simplify it', undefined)).toBe('refactor');
	});

	it('picks the highest-scoring category when multiple keywords match', () => {
		// "test" keywords: test, unit test, jest, assert, mock -> 5 matches vs "fix" -> 1 match
		expect(classify('write a unit test with jest, assert the mock is called, then fix a typo', undefined)).toBe('test');
	});

	it('falls back to "other" when no keyword or slash command matches', () => {
		expect(classify('continue', undefined)).toBe(FALLBACK_CATEGORY);
	});

	it('falls back to "other" for empty input', () => {
		expect(classify('', undefined)).toBe(FALLBACK_CATEGORY);
	});
});
