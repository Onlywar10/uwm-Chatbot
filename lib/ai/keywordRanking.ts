export type KeywordRankConfig<T> = {
	query: string;
	getFields: (item: T) => Array<string | null | undefined>;
	tieBreaker?: (a: T, b: T) => number;
};

export function normalizeForKeywordMatch(s: string): string {
	return s
		.replace(/(\w)\.(?=\w)/g, "$1")
		.replace(/[^\w\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

export function rankByKeyword<T>(items: T[], config: KeywordRankConfig<T>): T[] {
	const q = normalizeForKeywordMatch(config.query);
	if (!q) return items;
	const sorted = [...items];
	sorted.sort((a, b) => {
		const ra = scoreFields(config.getFields(a), q);
		const rb = scoreFields(config.getFields(b), q);
		if (ra.exact !== rb.exact) return ra.exact ? -1 : 1;
		if (ra.minLength !== rb.minLength) return ra.minLength - rb.minLength;
		return config.tieBreaker?.(a, b) ?? 0;
	});
	return sorted;
}

function scoreFields(
	fields: Array<string | null | undefined>,
	queryNormalized: string,
): { exact: boolean; minLength: number } {
	let exact = false;
	let minLength = Number.POSITIVE_INFINITY;
	for (const field of fields) {
		if (!field) continue;
		const trimmed = field.trim();
		if (!trimmed) continue;
		const normalized = normalizeForKeywordMatch(trimmed);
		if (!normalized) continue;
		if (normalized === queryNormalized) exact = true;
		if (normalized.includes(queryNormalized)) {
			minLength = Math.min(minLength, trimmed.length);
		}
	}
	return { exact, minLength };
}
