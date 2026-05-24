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

/** master_file format, e.g. "2026-04-30 19:35:30". */
export function parseMasterDate(value: string | undefined | null): Date | null {
	const v = nullify(value);
	if (v == null) return null;
	const d = new Date(v.replace(" ", "T"));
	return Number.isNaN(d.getTime()) ? null : d;
}

/** unmet & met format, e.g. "4/30/2026 4:53:00 PM". */
export function parseReferralDate(value: string | undefined | null): Date | null {
	const v = nullify(value);
	if (v == null) return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d;
}
