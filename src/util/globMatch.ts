/**
 * Minimal, dependency-free glob matcher for path-based exclusion rules
 * (`usageLogger.excludedPathGlobs`). Supports `**` (any depth), `*` (any
 * chars except path separator), and `?` (single char). Intentionally small
 * in scope rather than pulling in a glob library for a handful of
 * user-authored exclusion patterns.
 */
export function globToRegExp(glob: string): RegExp {
	let out = '';
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === '*') {
			if (glob[i + 1] === '*') {
				out += '.*';
				i++;
				// swallow an optional following slash so "**/" matches zero segments too
				if (glob[i + 1] === '/') {
					i++;
				}
			} else {
				out += '[^/]*';
			}
		} else if (ch === '?') {
			out += '[^/]';
		} else if ('.+^${}()|[]\\'.includes(ch)) {
			out += '\\' + ch;
		} else {
			out += ch;
		}
	}
	return new RegExp(`^${out}$`, 'i');
}

/** Normalizes path separators to `/` so glob patterns work the same on Windows and POSIX. */
function normalizeSlashes(p: string): string {
	return p.replace(/\\/g, '/');
}

export function matchesAnyGlob(filePath: string, globs: readonly string[]): boolean {
	if (globs.length === 0) {
		return false;
	}
	const normalizedPath = normalizeSlashes(filePath);
	return globs.some((glob) => {
		const trimmed = glob.trim();
		if (!trimmed) {
			return false;
		}
		try {
			return globToRegExp(normalizeSlashes(trimmed)).test(normalizedPath);
		} catch {
			return false;
		}
	});
}
