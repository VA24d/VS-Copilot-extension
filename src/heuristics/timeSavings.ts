/**
 * Estimated developer time saved from Copilot usage, by category.
 *
 * IMPORTANT — this is a rough, order-of-magnitude ESTIMATE, not a
 * measurement. Nothing about this extension can observe how long a
 * developer would have taken without Copilot. The per-category minute
 * values below are a heuristic starting point loosely informed by publicly
 * reported industry research on AI pair-programming (e.g. GitHub's 2022
 * controlled study reporting developers completed a benchmark task ~55%
 * faster with Copilot; various vendor/analyst surveys reporting roughly
 * 20-45 minutes/day saved per active developer). Treat the resulting totals
 * as directional, not as a precise productivity metric — and prefer
 * replacing the defaults with your own org's measured benchmarks via
 * `usageLogger.timeSavingsMinutesPerCategory` if you have them.
 */
export const DEFAULT_MINUTES_SAVED_PER_CATEGORY: Record<string, number> = {
	'code-gen': 15,
	'debug-fix': 20,
	'refactor': 15,
	'test': 15,
	'explain': 6,
	'docs': 10,
	'git-terminal': 3,
	'search-navigate': 5,
	'other': 5
};

export interface TimeSavingsEstimate {
	totalMinutes: number;
	totalHours: number;
	byCategory: Array<{ category: string; count: number; minutesSaved: number }>;
}

export function estimateTimeSavings(
	categoryCounts: Array<{ category: string; count: number }>,
	minutesPerCategory: Record<string, number> = DEFAULT_MINUTES_SAVED_PER_CATEGORY
): TimeSavingsEstimate {
	let totalMinutes = 0;
	const byCategory = categoryCounts.map(({ category, count }) => {
		const perRequest = minutesPerCategory[category] ?? minutesPerCategory['other'] ?? 5;
		const minutesSaved = perRequest * count;
		totalMinutes += minutesSaved;
		return { category, count, minutesSaved };
	});
	return { totalMinutes, totalHours: totalMinutes / 60, byCategory };
}
