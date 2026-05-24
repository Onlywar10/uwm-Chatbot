/**
 * Primitive value normalizers for raw CSV strings. All return null for
 * missing/blank/unparseable values — sparsity is the norm in this data.
 */

/** Trim; treat empty and "N/A" as missing. */
export function nullify(value: string | undefined | null): string | null {
	if (value == null) return null;
	const trimmed = value.trim();
	if (trimmed === "" || trimmed.toUpperCase() === "N/A") return null;
	return trimmed;
}

export function parseIntOrNull(value: string | undefined | null): number | null {
	const v = nullify(value);
	if (v == null || !/^\d+$/.test(v)) return null;
	return Number.parseInt(v, 10);
}

/** "Yes"/"No" (and "True"/"False") -> boolean; anything else -> null. */
export function parseBool(value: string | undefined | null): boolean | null {
	const v = nullify(value);
	if (v == null) return null;
	const lower = v.toLowerCase();
	if (lower === "yes" || lower === "true") return true;
	if (lower === "no" || lower === "false") return false;
	return null;
}

/** Age: pure integers pass through; "100+" -> 100; refusals/blank -> null numeric. */
export function parseAge(value: string | undefined | null): {
	raw: string | null;
	numeric: number | null;
} {
	const raw = nullify(value);
	if (raw == null) return { raw: null, numeric: null };
	if (/^\d+$/.test(raw)) return { raw, numeric: Number.parseInt(raw, 10) };
	if (raw === "100+") return { raw, numeric: 100 };
	return { raw, numeric: null };
}

/** master_file format, e.g. "2026-04-30 19:35:30" or "2026-04-27 9:29:26" (1-digit hour). */
export function parseMasterDate(value: string | undefined | null): Date | null {
	const v = nullify(value);
	if (v == null) return null;
	const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})$/);
	if (m) {
		const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** unmet & met format, e.g. "4/30/2026 4:53:00 PM" (US, 12-hour, AM/PM). */
export function parseReferralDate(value: string | undefined | null): Date | null {
	const v = nullify(value);
	if (v == null) return null;
	const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
	if (m) {
		let hour = +m[4];
		const meridiem = m[7]?.toUpperCase();
		if (meridiem === "PM" && hour !== 12) hour += 12;
		if (meridiem === "AM" && hour === 12) hour = 0;
		const d = new Date(+m[3], +m[1] - 1, +m[2], hour, +m[5], +m[6]);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d;
}
