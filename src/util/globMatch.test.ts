import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesAnyGlob } from './globMatch';

describe('globToRegExp / matchesAnyGlob', () => {
	it('matches "**" across any depth', () => {
		expect(matchesAnyGlob('/repo/a/b/secrets/key.pem', ['**/secrets/**'])).toBe(true);
		expect(matchesAnyGlob('/repo/secrets/key.pem', ['**/secrets/**'])).toBe(true);
		expect(matchesAnyGlob('/repo/a/b/config.json', ['**/secrets/**'])).toBe(false);
	});

	it('matches "*" only within a single path segment', () => {
		expect(matchesAnyGlob('/repo/a.pem', ['**/*.pem'])).toBe(true);
		expect(matchesAnyGlob('/repo/nested/a.pem', ['*.pem'])).toBe(false);
	});

	it('matches "?" as exactly one character', () => {
		expect(globToRegExp('a?c').test('abc')).toBe(true);
		expect(globToRegExp('a?c').test('ac')).toBe(false);
		expect(globToRegExp('a?c').test('abbc')).toBe(false);
	});

	it('normalizes backslashes to forward slashes for cross-platform matching', () => {
		expect(matchesAnyGlob('C:\\repo\\secrets\\key.pem', ['**/secrets/**'])).toBe(true);
	});

	it('is case-insensitive', () => {
		expect(matchesAnyGlob('/repo/SECRETS/key.pem', ['**/secrets/**'])).toBe(true);
	});

	it('escapes regex-special characters literally', () => {
		expect(matchesAnyGlob('/repo/file(1).txt', ['**/file(1).txt'])).toBe(true);
	});

	it('returns false for an empty glob list', () => {
		expect(matchesAnyGlob('/repo/anything.txt', [])).toBe(false);
	});

	it('ignores blank/whitespace-only glob entries without throwing', () => {
		expect(matchesAnyGlob('/repo/anything.txt', ['   ', ''])).toBe(false);
	});
});
