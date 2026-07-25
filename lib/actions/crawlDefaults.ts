// Identifies the crawler to the sites it visits. Many WAFs/CDNs block requests
// with an empty or generic User-Agent, and a well-behaved crawler should be
// self-identifying and contactable. Sent on every crawl request (static fetches,
// robots/sitemap probes, and the headless renderer).
export const CRAWLER_USER_AGENT =
	"UnitedWayMercedChatbotCrawler/1.0 (+https://www.unitedwaymerced.org)";

export const DEFAULT_CRAWL_OPTIONS = {
	maxDepth: 2,
	maxPages: 20,
	maxCharsPerPage: 50_000,
	includeSitemapSeeds: true,
	ignoreRobots: false,
	dropAllQuery: true,
} as const;

export type CrawlDefaults = typeof DEFAULT_CRAWL_OPTIONS;

// Safety backstop for "crawl entire domain" (crawlAllPages) runs: the crawl
// ignores maxCrawlDepth and the per-setting maxCrawlPages, but never exceeds
// this many pages, to bound cost/time on sites with huge or infinite URL spaces.
export const CRAWL_ALL_PAGES_CAP = 2000;
