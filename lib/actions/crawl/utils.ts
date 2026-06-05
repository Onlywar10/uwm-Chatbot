import type { CrawlSettings } from "@/lib/types/crawl";

export const verbose = process.env.NODE_ENV !== "production";

export function generateCrawlSettingSnapshot(crawlSettings: CrawlSettings) {
	return {
		maxDepth: crawlSettings.maxCrawlDepth,
		maxPages: crawlSettings.maxCrawlPages,
		maxCharsPerPage: crawlSettings.maxCharsPerPage,
		includeSitemapSeeds: crawlSettings.useSitemaps,
		ignoreRobots: crawlSettings.ignoreRobots,
		dropAllQuery: crawlSettings.dropAllQuery,
		renderJavascript: crawlSettings.renderJavascript,
		urlsToIgnore: crawlSettings.urlsToIgnore,
	};
}
