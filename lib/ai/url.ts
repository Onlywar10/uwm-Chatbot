const TRACKING_PARAMS = new Set([
	"gclid",
	"fbclid",
	"msclkid",
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"utm_term",
	"utm_content",
]);

/**
 * Canonicalize URLs so we don't crawl/index duplicates.
 * - Force https
 * - Lowercase host
 * - Drop hash
 * - Drop common tracking params
 * - Normalize trailing slash (remove for non-root)
 * - Optionally drop all query params (crawler defaults to true)
 */
export function canonicalizeUrlString(raw: string, opts?: { dropAllQuery?: boolean }) {
	const u = new URL(raw.trim());
	if (u.protocol !== "http:" && u.protocol !== "https:") return u.toString();

	u.protocol = "https:";
	u.hostname = u.hostname.toLowerCase();
	u.hash = "";

	if (opts?.dropAllQuery) {
		u.search = "";
	} else {
		for (const key of TRACKING_PARAMS) u.searchParams.delete(key);
	}

	if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
		u.pathname = u.pathname.slice(0, -1);
	}

	return u.toString();
}

export function canonicalizeUrl(u: URL, opts?: { dropAllQuery?: boolean }) {
	return new URL(canonicalizeUrlString(u.toString(), opts));
}
