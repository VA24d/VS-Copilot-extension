import { describe, expect, it } from 'vitest';
import { assessModelFit, modelTierFor, summarizeModelFit, taskComplexityFor } from './modelFit';

describe('modelTierFor', () => {
	it('classifies powerful-tier models', () => {
		expect(modelTierFor('claude-opus-4.8')).toBe('powerful');
		expect(modelTierFor('gpt-5')).toBe('powerful');
	});

	it('classifies balanced-tier models', () => {
		expect(modelTierFor('claude-sonnet-4.5')).toBe('balanced');
		expect(modelTierFor('gpt-4o')).toBe('balanced');
	});

	it('classifies lightweight-tier models, and gpt-4o-mini is not mistaken for balanced gpt-4o', () => {
		expect(modelTierFor('gpt-4o-mini')).toBe('lightweight');
		expect(modelTierFor('claude-haiku-4')).toBe('lightweight');
	});

	it('returns "unknown" for an unrecognized or empty model id', () => {
		expect(modelTierFor('some-custom-model')).toBe('unknown');
		expect(modelTierFor('')).toBe('unknown');
	});
});

describe('taskComplexityFor', () => {
	it('returns the configured complexity for known categories', () => {
		expect(taskComplexityFor('debug-fix')).toBe('high');
		expect(taskComplexityFor('docs')).toBe('low');
	});

	it('defaults to "medium" for an unknown category', () => {
		expect(taskComplexityFor('made-up-category')).toBe('medium');
	});
});

describe('assessModelFit', () => {
	it('flags a powerful model on a low-complexity task as possibly overpowered', () => {
		expect(assessModelFit('gpt-5', 'docs')).toBe('possibly-overpowered');
	});

	it('flags a lightweight model on a high-complexity task as possibly underpowered', () => {
		expect(assessModelFit('gpt-4o-mini', 'debug-fix')).toBe('possibly-underpowered');
	});

	it('treats a balanced model on a medium task as well-matched', () => {
		expect(assessModelFit('gpt-4o', 'code-gen')).toBe('well-matched');
	});

	it('returns "unknown" when the model tier cannot be determined', () => {
		expect(assessModelFit('mystery-model', 'debug-fix')).toBe('unknown');
	});
});

describe('summarizeModelFit', () => {
	it('tallies fit categories across pairs', () => {
		const summary = summarizeModelFit([
			{ category: 'docs', modelId: 'gpt-5' }, // overpowered
			{ category: 'debug-fix', modelId: 'gpt-4o-mini' }, // underpowered
			{ category: 'code-gen', modelId: 'gpt-4o' }, // well-matched
			{ category: 'debug-fix', modelId: 'unknown-model' } // unknown
		]);
		expect(summary).toEqual({ wellMatched: 1, possiblyOverpowered: 1, possiblyUnderpowered: 1, unknown: 1, total: 4 });
	});

	it('returns all zeros for an empty list', () => {
		expect(summarizeModelFit([])).toEqual({ wellMatched: 0, possiblyOverpowered: 0, possiblyUnderpowered: 0, unknown: 0, total: 0 });
	});
});
