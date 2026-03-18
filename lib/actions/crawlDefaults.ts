export const DEFAULT_CRAWL_OPTIONS = {
	maxDepth: 2,
	maxPages: 20,
	maxCharsPerPage: 50_000,
	includeSitemapSeeds: true,
	ignoreRobots: false,
	dropAllQuery: true,
} as const;

export type CrawlDefaults = typeof DEFAULT_CRAWL_OPTIONS;
