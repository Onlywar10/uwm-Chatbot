import { type CanonicalField, CANONICAL_MAPS } from "@/lib/data/canonical-maps";

/**
 * Applies the raw->canonical value maps. Lookup is exact-then-case-insensitive.
 * Unmapped values pass through unchanged and are recorded so the import can
 * print a report — nothing is silently dropped or bucketed.
 */
export class Canonicalizer {
	private unmapped = new Map<CanonicalField, Map<string, number>>();
	private lowerIndex = new Map<CanonicalField, Map<string, string>>();

	constructor() {
		for (const field of Object.keys(CANONICAL_MAPS) as CanonicalField[]) {
			const idx = new Map<string, string>();
			for (const [raw, canonical] of Object.entries(CANONICAL_MAPS[field])) {
				idx.set(raw.toLowerCase(), canonical);
			}
			this.lowerIndex.set(field, idx);
			this.unmapped.set(field, new Map());
		}
	}

	/** Returns the canonical value for a raw value, or the raw value if unmapped. */
	canonicalize(field: CanonicalField, raw: string | null): string | null {
		if (raw == null) return null;
		const map = CANONICAL_MAPS[field] as Record<string, string>;
		if (raw in map) return map[raw];

		const byLower = this.lowerIndex.get(field)?.get(raw.toLowerCase());
		if (byLower) return byLower;

		const counts = this.unmapped.get(field);
		if (counts) counts.set(raw, (counts.get(raw) ?? 0) + 1);
		return raw;
	}

	/** Unmapped values seen, by field, with occurrence counts. */
	report(): { field: CanonicalField; value: string; count: number }[] {
		const out: { field: CanonicalField; value: string; count: number }[] = [];
		for (const [field, counts] of this.unmapped) {
			for (const [value, count] of counts) out.push({ field, value, count });
		}
		return out.sort((a, b) => b.count - a.count);
	}
}
