"use server";

import { requireAuth } from "@/lib/auth/guards";
import { canonicalizeUrl, canonicalizeUrlString } from "@/lib/ai/url";
import { upsertCrawlSettings } from "./crawlSettings";
import { publishCrawlJob } from "./publish";

import { DEFAULT_CRAWL_OPTIONS } from "../crawlDefaults";
import { claimCrawlJob } from "./crawlJobs";

type CrawlSettings = {
	maxDepth?: number;
	maxPages?: number;
	maxCharsPerPage?: number;
	includeSitemapSeeds?: boolean;
	ignoreRobots?: boolean;
	dropAllQuery?: boolean;
	urlsToIgnore?: string[];
	domain?: string;
};

type RobotsRules = { allow: string[]; disallow: string[]; crawlDelay: number };

const fetchRobots = async (origin: string): Promise<RobotsRules> => {
	try {
		const response = await fetch(`${origin}/robots.txt`, { cache: "no-store" });
		if (!response.ok) return { allow: [], disallow: [], crawlDelay: 0 };

		const text = await response.text();
		const lines = text.split(/\r?\n/);
		let currentUA: string | null = null;
		const rules: Record<string, RobotsRules> = {};

		for (const rawLine of lines) {
			const line = rawLine.split("#")[0]?.trim() ?? "";
			if (!line) continue;

			const m = line.match(/^\s*User-agent\s*:\s*(.+)\s*$/i);
			if (m) {
				currentUA = m[1].trim();
				if (!rules[currentUA]) rules[currentUA] = { allow: [], disallow: [], crawlDelay: 0 };
				continue;
			}

			const allow = line.match(/^\s*Allow\s*:\s*(.*)\s*$/i);
			if (allow && currentUA) {
				const val = allow[1].trim();
				if (val) rules[currentUA].allow.push(val);
				continue;
			}

			const disallow = line.match(/^\s*Disallow\s*:\s*(.*)\s*$/i);
			if (disallow && currentUA) {
				const val = disallow[1].trim();
				if (val) rules[currentUA].disallow.push(val);
				continue;
			}

			const delay = line.match(/^\s*Crawl-delay\s*:\s*(\d+)\s*$/i);
			if (delay && currentUA) {
				rules[currentUA].crawlDelay = parseInt(delay[1], 10) || 0;
			}
		}

		return rules["*"] ?? { allow: [], disallow: [], crawlDelay: 0 };
	} catch {
		return { allow: [], disallow: [], crawlDelay: 0 };
	}
};

const fetchSitemap = async (origin: string): Promise<string[]> => {
	try {
		const response = await fetch(`${origin}/sitemap.xml`, {
			cache: "no-store",
		});
		if (!response.ok) return [];

		const xml = await response.text();
		return Array.from(xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)).map((match) => match[1].trim());
	} catch {
		return [];
	}
};

const clampInt = (value: unknown, min: number, fallback: number) => {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.floor(n));
};

export async function startCrawl(
	url: string,
	crawlSettings: CrawlSettings,
	schoolId: string,
	updateCrawlSettings: boolean,
) {
	await requireAuth();

	const startRaw = url.trim();
	const dropAllQuery = crawlSettings.dropAllQuery ?? DEFAULT_CRAWL_OPTIONS.dropAllQuery;

	const startCanonical = canonicalizeUrlString(startRaw, { dropAllQuery });
	const start = new URL(startCanonical);

	const hostname = start.hostname.toLowerCase();
	const pathSegments = start.pathname.split("/").filter(Boolean);
	const basePrefix = pathSegments.length > 0 ? `/${pathSegments[0]}` : "";

	const domain = crawlSettings.domain
		? crawlSettings.domain
		: basePrefix
			? `${hostname}${basePrefix}`
			: hostname;

	const maxDepth = clampInt(crawlSettings.maxDepth, 0, DEFAULT_CRAWL_OPTIONS.maxDepth);
	const maxPages = clampInt(crawlSettings.maxPages, 1, DEFAULT_CRAWL_OPTIONS.maxPages);
	const maxCharsPerPage = clampInt(
		crawlSettings.maxCharsPerPage,
		1000,
		DEFAULT_CRAWL_OPTIONS.maxCharsPerPage,
	);

	const includeSitemapSeeds =
		crawlSettings.includeSitemapSeeds ?? DEFAULT_CRAWL_OPTIONS.includeSitemapSeeds;
	const ignoreRobots = crawlSettings.ignoreRobots ?? DEFAULT_CRAWL_OPTIONS.ignoreRobots;

	const origin = `${start.protocol}//${hostname}`;
	const robots = ignoreRobots
		? { allow: ["/"], disallow: [], crawlDelay: 0 }
		: await fetchRobots(origin);
	const crawlDelay = ignoreRobots ? 0 : robots.crawlDelay || 0;

	const sitemapSeeds = includeSitemapSeeds ? await fetchSitemap(origin) : [];

	const urlsToIgnore = crawlSettings.urlsToIgnore ? crawlSettings.urlsToIgnore : [];

	const crawlSetting = await upsertCrawlSettings(
		{
			domain: domain,
			maxCrawlDepth: maxDepth,
			maxCrawlPages: maxPages,
			maxCharsPerPage,
			useSitemaps: includeSitemapSeeds,
			ignoreRobots,
			dropAllQuery,
			urlsToIgnore,
			schoolId: schoolId,
		},
		updateCrawlSettings,
	);

	if (!crawlSetting.ok) {
		return {
			ok: false as const,
			error: crawlSetting.error,
		};
	}

	const crawlSettingId = crawlSetting.crawlSettingId;

	sitemapSeeds.unshift(url);

	for (const seedUrlStr of sitemapSeeds) {
		try {
			const normalizedUrl = canonicalizeUrl(new URL(seedUrlStr), {
				dropAllQuery,
			});
			if (
				normalizedUrl.hostname.toLowerCase() === hostname &&
				(basePrefix === "" || normalizedUrl.pathname.startsWith(basePrefix))
			) {
				const crawlJob = await claimCrawlJob({
					url: normalizedUrl.toString(),
					depth: 0,
					crawlSettingId,
				});

				if (!crawlJob.ok) throw new Error(crawlJob.reason);

				const crawlJobId = crawlJob.id;

				await publishCrawlJob(
					domain,
					normalizedUrl.toString(),
					schoolId,
					0,
					crawlDelay,
					robots,
					crawlSettingId,
					crawlJobId,
					{
						maxDepth: maxDepth,
						maxPages: maxPages,
						maxCharsPerPage: maxCharsPerPage,
						ignoreRobots: ignoreRobots,
						dropAllQuery: dropAllQuery,
						urlsToIgnore: urlsToIgnore,
						domain: domain,
					},
					{
						key: `${crawlSettingId}-html`,
						parallelism: 10,
						rate: 100,
						period: "1m",
					},
				);
			}
		} catch {}
	}
}
