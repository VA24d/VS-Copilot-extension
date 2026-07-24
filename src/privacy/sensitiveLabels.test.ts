import { describe, expect, it } from 'vitest';
import { anyContainsSensitiveLabel, containsSensitiveLabel } from './sensitiveLabels';

describe('containsSensitiveLabel', () => {
	it('matches a keyword regardless of case', () => {
		expect(containsSensitiveLabel('this file is CONFIDENTIAL', ['confidential'])).toBe(true);
		expect(containsSensitiveLabel('this file is confidential', ['CONFIDENTIAL'])).toBe(true);
	});

	it('returns false when no keyword matches', () => {
		expect(containsSensitiveLabel('just a normal prompt', ['restricted', 'confidential'])).toBe(false);
	});

	it('returns false for empty text or an empty keyword list', () => {
		expect(containsSensitiveLabel('', ['restricted'])).toBe(false);
		expect(containsSensitiveLabel('some text', [])).toBe(false);
	});

	it('ignores blank keyword entries', () => {
		expect(containsSensitiveLabel('some text', ['   ', ''])).toBe(false);
	});
});

describe('anyContainsSensitiveLabel', () => {
	it('returns true if any text in the list matches', () => {
		expect(anyContainsSensitiveLabel(['clean text', 'has RESTRICTED marker'], ['restricted'])).toBe(true);
	});

	it('returns false if none match', () => {
		expect(anyContainsSensitiveLabel(['clean text', 'also clean'], ['restricted'])).toBe(false);
	});
});
