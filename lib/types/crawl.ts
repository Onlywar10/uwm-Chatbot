export type CrawlType = "crawl" | "recrawl" | null;

export type RobotsRules = { allow: string[]; disallow: string[]; crawlDelay: number };

export type CrawlSettings = {
	id: string;
	domain: string;
	useSitemaps: boolean;
	ignoreRobots: boolean;
	dropAllQuery: boolean;
	renderJavascript: boolean;
	maxCrawlDepth: number;
	maxCrawlPages: number;
	maxCharsPerPage: number;
	urlsToIgnore: string[];
	entityType: "district" | "school";
	entityId: string;
	createdAt: Date;
	updatedAt: Date;
};

export type CrawlSetup = {
	domain: string;
	basePrefix: string;
	hostname: string;
	robots: RobotsRules;
	crawlDelay: number;
	sitemapSeeds: string[];
	dropAllQuery: boolean;
	settingsSnapshot: {
		maxDepth: number;
		maxPages: number;
		maxCharsPerPage: number;
		includeSitemapSeeds: boolean;
		ignoreRobots: boolean;
		dropAllQuery: boolean;
		renderJavascript: boolean;
		urlsToIgnore: string[];
	};
	crawlSettings: {
		id: string;
		domain: string;
		useSitemaps: boolean;
		ignoreRobots: boolean;
		dropAllQuery: boolean;
		renderJavascript: boolean;
		maxCrawlDepth: number;
		maxCrawlPages: number;
		maxCharsPerPage: number;
		urlsToIgnore: string[];
		entityType: "district" | "school";
		entityId: string;
		createdAt: Date;
		updatedAt: Date;
	};
};

export type CrawlSettingsSnapshot = {
	maxDepth: number;
	maxPages: number;
	maxCharsPerPage: number;
	includeSitemapSeeds: boolean;
	ignoreRobots: boolean;
	dropAllQuery: boolean;
	renderJavascript: boolean;
	urlsToIgnore: string[];
};

export type Metadata = {
	pageTitle: string;
	sectionHeaders: string;
	topCategory: string;
	subCategory: string;
	pageCategory: string;
	fullPath: string;
	sourceUrl: string;
	fileType: "html" | "pdf" | "doc";
};
