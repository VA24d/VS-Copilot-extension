/**
 * Best-effort local detection of "sensitive label" keywords (e.g. bank
 * data-classification markers like "CONFIDENTIAL", "RESTRICTED") in prompt
 * text, response text, or attached file paths.
 *
 * IMPORTANT — honest scope statement (do not overclaim): this is a LOCAL
 * STORAGE control only. It decides whether prompt/response text gets
 * written into this extension's own local SQLite database. It has NO
 * ability to intercept, block, or redact anything before it reaches the
 * Copilot model itself — VS Code's chat APIs do not expose a hook for
 * that. The only mechanism that can actually stop proprietary content
 * from being sent to the model is GitHub Copilot's org-level Content
 * Exclusion policy, configured by a GitHub admin at the organization
 * level (github.com), which is entirely outside this extension.
 */
export function containsSensitiveLabel(text: string, keywords: readonly string[]): boolean {
	if (!text || keywords.length === 0) {
		return false;
	}
	const haystack = text.toUpperCase();
	return keywords.some((keyword) => {
		const trimmed = keyword.trim();
		return trimmed.length > 0 && haystack.includes(trimmed.toUpperCase());
	});
}

export function anyContainsSensitiveLabel(texts: readonly string[], keywords: readonly string[]): boolean {
	return texts.some((t) => containsSensitiveLabel(t, keywords));
}
