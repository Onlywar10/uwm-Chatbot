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

export function getDomain(url: string) {
	const startCanonical = canonicalizeUrlString(url.trim(), { dropAllQuery: true });
	const start = new URL(startCanonical);

	const hostname = start.hostname.toLowerCase();
	const pathSegments = start.pathname.split("/").filter(Boolean);
	const basePrefix = pathSegments.length > 0 ? `/${pathSegments[0]}` : "";
	const domain = basePrefix ? `${hostname}${basePrefix}` : hostname;

	return domain;
}

const stripTrailingSlash = (s: string) => s.replace(/\/+$/, "");

/**
 * True if `href` should be skipped given the crawl's ignore list. Matching is by
 * canonicalized path PREFIX, so an entry like ".../community-calendar-1" skips
 * that page AND all of its sub-pages (".../community-calendar-1/some-event"),
 * but not a sibling like ".../community-calendar-10". Both sides are canonicalized
 * so user-entered values (trailing slash, query, casing) still match.
 */
export function isUrlIgnored(
	href: string,
	ignoreList: string[] | null | undefined,
	opts?: { dropAllQuery?: boolean },
): boolean {
	if (!ignoreList || ignoreList.length === 0) return false;

	let target: string;
	try {
		target = stripTrailingSlash(canonicalizeUrlString(href, opts));
	} catch {
		target = stripTrailingSlash(href);
	}

	for (const raw of ignoreList) {
		const trimmed = raw?.trim();
		if (!trimmed) continue;

		let prefix: string;
		try {
			prefix = stripTrailingSlash(canonicalizeUrlString(trimmed, opts));
		} catch {
			prefix = stripTrailingSlash(trimmed);
		}
		if (!prefix) continue;

		if (target === prefix || target.startsWith(`${prefix}/`)) return true;
	}

	return false;
}
