import { describe, expect, it } from 'vitest';
import { detectLanguage } from './languageDetector';

describe('detectLanguage', () => {
	it('detects language from a single attachment path extension', () => {
		expect(detectLanguage(['/repo/src/index.ts'], '')).toBe('TypeScript');
	});

	it('picks the most common extension across multiple attachment paths', () => {
		const paths = ['/repo/a.py', '/repo/b.py', '/repo/c.ts'];
		expect(detectLanguage(paths, '')).toBe('Python');
	});

	it('falls back to a fenced code-block language tag when no paths are given', () => {
		const response = 'Here you go:\n```python\nprint("hi")\n```\n';
		expect(detectLanguage([], response)).toBe('Python');
	});

	it('prefers path-derived language over fenced code blocks when both are present', () => {
		const response = '```javascript\nconsole.log(1);\n```';
		expect(detectLanguage(['/repo/main.rs'], response)).toBe('Rust');
	});

	it('picks the most common fenced code-block tag when there are no usable paths', () => {
		const response = '```go\nfunc main() {}\n```\n```go\nfunc other() {}\n```\n```rust\nfn main() {}\n```';
		expect(detectLanguage([], response)).toBe('Go');
	});

	it('returns "unknown" when nothing matches', () => {
		expect(detectLanguage([], 'just plain text, no code fences')).toBe('unknown');
	});

	it('ignores paths with unrecognized or missing extensions', () => {
		expect(detectLanguage(['/repo/Makefile', '/repo/LICENSE'], '')).toBe('unknown');
	});
});
