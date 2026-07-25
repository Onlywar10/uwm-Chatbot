/**
 * Detects when the assistant has just asked the visitor where they are.
 *
 * That question is the moment the "Use my location" button is worth offering —
 * tapping it answers the question outright, and it arrives BEFORE the first search
 * rather than after, so the very first set of results is already distance-ranked.
 *
 * Text matching is used deliberately rather than a structured flag: the model
 * composes this question freely and phrasing it as a tool call or sentinel would
 * constrain a reply that should stay natural. The referral prompt steers it toward
 * a consistent form ("what city or zip are you in?"), and the patterns below cover
 * the reasonable variations around that. A miss is harmless — the button still
 * appears once a search runs.
 */

const PATTERNS: RegExp[] = [
	// The prompt's own suggested phrasing and near variants.
	/\bcity or zip\b/i,
	/\bzip or city\b/i,
	/\bnearby options\b/i,
	// Direct questions about place.
	/\bwhat (?:city|town|area|zip)\b/i,
	/\bwhich (?:city|town|area)\b/i,
	/\bwhere are you\b/i,
	/\bwhere do you live\b/i,
	/\byour zip\b/i,
	/\bzip code\b/i,
	/\bwhat part of (?:merced|mariposa|the county)\b/i,
];

export function asksForLocation(text: string | null | undefined): boolean {
	const value = text?.trim();
	if (!value) return false;
	return PATTERNS.some((p) => p.test(value));
}
