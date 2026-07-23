/**
 * Heuristic "is this model a reasonable fit for the task?" check.
 *
 * This is a rough cost/capability heuristic, not a quality judgment — it
 * flags patterns worth a human glance (e.g. "opus-tier model used for a
 * one-line docs tweak"), it does not mean the choice was wrong. Task
 * complexity by category and model tier by id are both approximate and
 * meant to be tuned per-org over time.
 */
export type ModelTier = 'lightweight' | 'balanced' | 'powerful' | 'unknown';
export type TaskComplexity = 'low' | 'medium' | 'high';
export type ModelFit = 'well-matched' | 'possibly-overpowered' | 'possibly-underpowered' | 'unknown';

/** Substring match against modelId (e.g. "copilot/claude-opus-4.8", "gpt-4o-mini") — order matters, first match wins. */
const MODEL_TIER_PATTERNS: Array<{ pattern: RegExp; tier: ModelTier }> = [
	{ pattern: /opus|o1-pro|o3-pro|gpt-5|grok-4/i, tier: 'powerful' },
	{ pattern: /sonnet|gpt-4\.1|gpt-4o(?!-mini)|o1(?!-mini)|o3(?!-mini)|gemini-.*pro/i, tier: 'balanced' },
	{ pattern: /haiku|mini|nano|gpt-3\.5|gemini-.*flash/i, tier: 'lightweight' }
];

const CATEGORY_COMPLEXITY: Record<string, TaskComplexity> = {
	'code-gen': 'medium',
	'debug-fix': 'high',
	'refactor': 'high',
	'test': 'medium',
	'explain': 'low',
	'docs': 'low',
	'git-terminal': 'low',
	'search-navigate': 'low',
	'other': 'medium'
};

export function modelTierFor(modelId: string): ModelTier {
	if (!modelId) {
		return 'unknown';
	}
	for (const { pattern, tier } of MODEL_TIER_PATTERNS) {
		if (pattern.test(modelId)) {
			return tier;
		}
	}
	return 'unknown';
}

export function taskComplexityFor(category: string): TaskComplexity {
	return CATEGORY_COMPLEXITY[category] ?? 'medium';
}

export function assessModelFit(modelId: string, category: string): ModelFit {
	const tier = modelTierFor(modelId);
	if (tier === 'unknown') {
		return 'unknown';
	}
	const complexity = taskComplexityFor(category);

	if (tier === 'powerful' && complexity === 'low') {
		return 'possibly-overpowered';
	}
	if (tier === 'lightweight' && complexity === 'high') {
		return 'possibly-underpowered';
	}
	return 'well-matched';
}

export interface ModelFitSummary {
	wellMatched: number;
	possiblyOverpowered: number;
	possiblyUnderpowered: number;
	unknown: number;
	total: number;
}

export function summarizeModelFit(pairs: Array<{ category: string; modelId: string }>): ModelFitSummary {
	const summary: ModelFitSummary = { wellMatched: 0, possiblyOverpowered: 0, possiblyUnderpowered: 0, unknown: 0, total: pairs.length };
	for (const { category, modelId } of pairs) {
		switch (assessModelFit(modelId, category)) {
			case 'well-matched': summary.wellMatched++; break;
			case 'possibly-overpowered': summary.possiblyOverpowered++; break;
			case 'possibly-underpowered': summary.possiblyUnderpowered++; break;
			default: summary.unknown++;
		}
	}
	return summary;
}
