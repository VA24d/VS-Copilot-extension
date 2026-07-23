import { CATEGORIES, FALLBACK_CATEGORY } from './categories';

/**
 * Keyword/regex scoring over prompt text + slash command. Deliberately rough
 * (plan §7): multi-intent prompts will misclassify, tuned post-launch via
 * `categories.ts` without a schema migration since category is stored as
 * free text.
 */
export function classify(promptText: string, slashCommand: string | undefined): string {
	const text = (promptText || '').toLowerCase();
	const command = (slashCommand || '').toLowerCase();

	let bestCategory = FALLBACK_CATEGORY;
	let bestScore = 0;

	for (const category of CATEGORIES) {
		let score = 0;

		if (command && category.slashCommands?.includes(command)) {
			score += 5;
		}

		for (const keyword of category.keywords) {
			if (text.includes(keyword)) {
				score += 1;
			}
		}

		if (score > bestScore) {
			bestScore = score;
			bestCategory = category.id;
		}
	}

	return bestScore > 0 ? bestCategory : FALLBACK_CATEGORY;
}
