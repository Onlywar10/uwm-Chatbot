"use server";

import { requireAuth } from "@/lib/auth/guards";
import { canonicalizeUrl, canonicalizeUrlString, isUrlIgnored } from "@/lib/ai/url";
import { createCrawlRun, updateCrawlRunError } from "./crawlRun";
import { claimCrawlJob } from "./crawlJobs";
import { updateCrawlScheduleState } from "./crawlSchedule";
import { getFlowControl, isCrawlEndpointReachable, publishCrawlJob } from "./publish";
import { generateCrawlSettingSnapshot } from "./utils";
import { log } from "../logger";

import { CRAWL_ALL_PAGES_CAP, DEFAULT_CRAWL_OPTIONS } from "../crawlDefaults";
import { getCrawlSettings } from "./crawlSettings";
import { fetchWithRetry } from "./fetchWithRetry";

import type { CrawlSetup, RobotsRules } from "@/lib/types/crawl";
import type { FlowControl } from "@upstash/qstash";

const fetchRobots = async (origin: string): Promise<RobotsRules> => {
	try {
		const response = await fetchWithRetry(`${origin}/robots.txt`, { cache: "no-store" });
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
	} catch (error) {
		await log({
			level: "warn",
			source: "crawler/setup",
			message: "Failed to fetch robots.txt, proceeding without rules",
			metadata: {
				url: origin,
				error: error instanceof Error ? error.message : String(error),
			},
		});

		return { allow: [], disallow: [], crawlDelay: 0 };
	}
};

// Catapult sites running the ADA scanner expose a JSON sitemap of the full page
// tree at /scripts/CCMSADAR-SiteMap.php. Each entry's `href` is a root-relative
// path; map them to absolute URLs. This is the authoritative page list when present.
const fetchCatapultSitemap = async (origin: string): Promise<string[]> => {
	try {
		const response = await fetchWithRetry(`${origin}/scripts/CCMSADAR-SiteMap.php`, {
			cache: "no-store",
		});
		if (!response.ok) return [];

		const text = await response.text();
		// Strip a leading UTF-8 BOM if present so JSON.parse doesn't choke.
		const json = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
		const data = JSON.parse(json) as Array<{ href?: string; isLink?: boolean }>;
		if (!Array.isArray(data)) return [];

		const urls: string[] = [];
		for (const entry of data) {
			// isLink entries are CMS shortcut links that redirect elsewhere — often
			// to an internal page already in the tree, sometimes off-site (e.g. a
			// Google Form). Skip them; the real pages are the isLink:false entries.
			if (entry?.isLink === true) continue;
			const href = entry?.href?.trim();
			if (!href) continue;
			urls.push(href.startsWith("http") ? href : `${origin}/${href.replace(/^\/+/, "")}/`);
		}
		return urls;
	} catch {
		return [];
	}
};

const fetchSitemap = async (origin: string): Promise<string[]> => {
	const catapultSitemap = await fetchCatapultSitemap(origin);
	if (catapultSitemap.length > 0) {
		await log({
			level: "info",
			source: "crawler/setup",
			message: "Using Catapult ADA scanner sitemap",
			metadata: { url: origin, count: catapultSitemap.length },
		});

		return catapultSitemap;
	}

	try {
		const response = await fetchWithRetry(`${origin}/sitemap.xml`, {
			cache: "no-store",
		});
		if (!response.ok) {
			await log({
				level: "warn",
				source: "crawler/setup",
				message: "Sitemap empty or unavailable",
				metadata: {
					url: origin,
				},
			});

			return [];
		}

		const xml = await response.text();
		return Array.from(xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)).map((match) => match[1].trim());
	} catch (error) {
		await log({
			level: "warn",
			source: "crawler/setup",
			message: "Failed to fetch sitemap.xml",
			metadata: {
				url: origin,
				error: error instanceof Error ? error.message : String(error),
			},
		});

		return [];
	}
};

async function buildCrawlSetup(url: string, crawlSettingId: string): Promise<CrawlSetup> {
	const crawlSettings = await getCrawlSettings(crawlSettingId);
	if (!crawlSettings) {
		await log({
			level: "error",
			source: "crawler/setup",
			message: "Crawl settings not found",
			metadata: { crawlSettingId },
		});

		throw new Error(`Crawl settings not found ${url}`);
	}

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

	const origin = `${start.protocol}//${hostname}`;
	const robots = crawlSettings.ignoreRobots
		? { allow: ["/"], disallow: [], crawlDelay: 0 }
		: await fetchRobots(origin);
	const crawlDelay = crawlSettings.ignoreRobots ? 0 : robots.crawlDelay || 0;

	const sitemapSeeds = crawlSettings.useSitemaps ? await fetchSitemap(origin) : [];

	const settingsSnapshot = generateCrawlSettingSnapshot(crawlSettings);

	return {
		domain,
		basePrefix,
		hostname,
		robots,
		crawlDelay,
		sitemapSeeds,
		dropAllQuery,
		settingsSnapshot,
		crawlSettings,
	};
}

async function syncCrawlSchedule(input: {
	crawlSettingId: string;
	crawlRunId: string;
	lastCrawlMethod: "manual" | "automatic";
	status?: "pending" | "success" | "failure";
}) {
	const { crawlSettingId, crawlRunId, lastCrawlMethod, status } = input;

	const state = await updateCrawlScheduleState(crawlSettingId, {
		lastCrawlMethod,
		status,
	});

	if (!state.ok) {
		await log({
			level: "error",
			source: "crawler",
			message: "Failed to update crawl schedule state",
			metadata: { crawlSettingId, crawlRunId: crawlRunId, error: state.error },
			crawlRunId: crawlRunId,
		});
	}
}

async function executeCrawl(
	url: string,
	setup: CrawlSetup,
	crawlSettingId: string,
	crawlRunId: string,
) {
	if (!(await isCrawlEndpointReachable())) throw new Error("Crawl API endpoint is not reachable");

	const { basePrefix, hostname, crawlDelay, sitemapSeeds, dropAllQuery, settingsSnapshot } = setup;

	const seeds = [url, ...sitemapSeeds];

	const jobsToPublish: { crawlJobId: string; flowControl: FlowControl }[] = [];

	for (const seedUrlStr of seeds) {
		const normalizedUrl = canonicalizeUrl(new URL(seedUrlStr), {
			dropAllQuery,
		});
		if (
			normalizedUrl.hostname.toLowerCase() === hostname &&
			(basePrefix === "" || normalizedUrl.pathname.startsWith(basePrefix)) &&
			!isUrlIgnored(normalizedUrl.toString(), settingsSnapshot.urlsToIgnore, { dropAllQuery })
		) {
			const crawlJob = await claimCrawlJob({
				url: normalizedUrl.toString(),
				depth: 0,
				crawlSettingId,
				crawlRunId: crawlRunId,
				settingsSnapshot,
			});

			if (!crawlJob.ok) {
				if (crawlJob.reason === "duplicate") continue;
				if (crawlJob.reason === "max_pages") break;
				throw new Error(`Failed to claim crawl job: ${crawlJob.reason}`);
			}

			const flowControl = getFlowControl(normalizedUrl.toString(), crawlSettingId);

			jobsToPublish.push({ crawlJobId: crawlJob.id, flowControl });
		}
	}

	await Promise.all(
		jobsToPublish.map((j) => publishCrawlJob(j.crawlJobId, j.flowControl, crawlDelay)),
	);

	await log({
		level: "info",
		source: "crawler",
		message: "Seed jobs published",
		metadata: {
			count: jobsToPublish.length,
			crawlRunId: crawlRunId,
		},
		crawlRunId: crawlRunId,
	});
}

async function executeRecrawl(
	urls: string[],
	setup: CrawlSetup,
	crawlSettingId: string,
	crawlRunId: string,
) {
	if (!(await isCrawlEndpointReachable())) throw new Error("Crawl API endpoint is not reachable");

	const { crawlDelay, settingsSnapshot } = setup;

	const jobsToPublish: { crawlJobId: string; flowControl: FlowControl }[] = [];

	for (const url of urls) {
		const crawlJob = await claimCrawlJob({
			url: url,
			depth: 0,
			crawlSettingId,
			jobType: "recrawl",
			crawlRunId: crawlRunId,
			settingsSnapshot,
		});

		if (!crawlJob.ok) {
			if (crawlJob.reason === "duplicate") continue;
			if (crawlJob.reason === "max_pages") break;
			throw new Error(`Failed to claim crawl job: ${crawlJob.reason}`);
		}

		const flowControl = getFlowControl(url, crawlSettingId);

		jobsToPublish.push({ crawlJobId: crawlJob.id, flowControl });
	}

	await Promise.all(
		jobsToPublish.map((j) => publishCrawlJob(j.crawlJobId, j.flowControl, crawlDelay)),
	);

	await log({
		level: "info",
		source: "crawler",
		message: "Recrawl jobs published",
		metadata: {
			count: jobsToPublish.length,
			crawlRunId: crawlRunId,
		},
		crawlRunId: crawlRunId,
	});
}

export async function startCrawl(
	url: string,
	entityType: string,
	entityId: string,
	crawlSettingId: string,
) {
	try {
		await requireAuth();

		await log({
			level: "info",
			source: "crawler",
			message: "Starting crawl",
			metadata: {
				url,
				entityId,
				crawlSettingId,
			},
		});

		const setup = await buildCrawlSetup(url, crawlSettingId);
		const { domain, robots, crawlDelay, settingsSnapshot, crawlSettings } = setup;

		const crawlRun = await createCrawlRun({
			domain,
			startUrl: url,
			entityType,
			entityId,
			maxPages: crawlSettings.crawlAllPages ? CRAWL_ALL_PAGES_CAP : crawlSettings.maxCrawlPages,
			robots,
			crawlDelay,
			crawlRunType: "crawl",
			crawlSettingId,
			settingsSnapshot,
			usedSitemap: setup.sitemapSeeds.length > 0,
		});

		if (!crawlRun.ok) {
			await log({
				level: "error",
				source: "crawler",
				message: "Failed to create crawl run",
				metadata: {
					entityId,
					crawlSettingId,
					error: crawlRun.error,
				},
			});

			throw new Error(crawlRun.error);
		}

		await syncCrawlSchedule({
			crawlSettingId: crawlSettingId,
			crawlRunId: crawlRun.crawlRunId,
			lastCrawlMethod: "manual",
		});

		return await executeCrawl(url, setup, crawlSettingId, crawlRun.crawlRunId)
			.then(async () => {
				await log({
					level: "info",
					source: "crawler",
					message: "Crawl started",
					metadata: {
						crawlRunId: crawlRun.crawlRunId,
					},
					crawlRunId: crawlRun.crawlRunId,
				});

				return { ok: true as const, crawlRunId: crawlRun.crawlRunId };
			})
			.catch(async (error) => {
				const errorMessage =
					error instanceof Error && error.message.length > 0 ? error.message : "unknown_error";

				await log({
					level: "error",
					source: "crawler",
					message: errorMessage,
					metadata: {
						crawlRunId: crawlRun.crawlRunId,
					},
					crawlRunId: crawlRun.crawlRunId,
				});

				await updateCrawlRunError(crawlRun.crawlRunId, { status: "failure", errorMessage });

				return { ok: false as const, error: errorMessage };
			});
	} catch (error) {
		return {
			ok: false as const,
			error: error instanceof Error && error.message.length > 0 ? error.message : "unknown_error",
		};
	}
}

export async function startRecrawl(urls: string[], startUrl: string, crawlSettingId: string) {
	try {
		await requireAuth();

		await log({
			level: "info",
			source: "crawler",
			message: "Starting recrawl",
			metadata: {
				urlCount: urls.length,
				crawlSettingId,
			},
		});

		const setup = await buildCrawlSetup(startUrl, crawlSettingId);
		const { robots, crawlDelay, settingsSnapshot, crawlSettings } = setup;

		const crawlRun = await createCrawlRun({
			domain: crawlSettings.domain,
			startUrl,
			entityType: crawlSettings.entityType,
			entityId: crawlSettings.entityId,
			maxPages: urls.length,
			robots,
			crawlDelay,
			crawlRunType: "recrawl",
			crawlSettingId,
			settingsSnapshot,
			usedSitemap: setup.sitemapSeeds.length > 0,
		});

		if (!crawlRun.ok) {
			await log({
				level: "error",
				source: "crawler",
				message: "Failed to create crawl run",
				metadata: {
					crawlSettingId,
					error: crawlRun.error,
				},
			});

			throw new Error(crawlRun.error);
		}

		await syncCrawlSchedule({
			crawlSettingId: crawlSettingId,
			crawlRunId: crawlRun.crawlRunId,
			lastCrawlMethod: "manual",
		});

		return await executeRecrawl(urls, setup, crawlSettingId, crawlRun.crawlRunId)
			.then(async () => {
				await log({
					level: "info",
					source: "crawler",
					message: "Recrawl started",
					metadata: { crawlRunId: crawlRun.crawlRunId },
					crawlRunId: crawlRun.crawlRunId,
				});

				return { ok: true as const };
			})
			.catch(async (error) => {
				const errorMessage =
					error instanceof Error && error.message.length > 0 ? error.message : "unknown_error";

				await log({
					level: "error",
					source: "crawler",
					message: errorMessage,
					metadata: { crawlRunId: crawlRun.crawlRunId },
					crawlRunId: crawlRun.crawlRunId,
				});

				await updateCrawlRunError(crawlRun.crawlRunId, { status: "failure", errorMessage });

				return { ok: false as const, error: errorMessage };
			});
	} catch (error) {
		return {
			ok: false as const,
			error: error instanceof Error && error.message.length > 0 ? error.message : "unknown_error",
		};
	}
}

export async function startScheduledCrawl(
	url: string,
	entityType: string,
	entityId: string,
	crawlSettingId: string,
) {
	try {
		await log({
			level: "info",
			source: "scheduler",
			message: "Starting scheduled crawl",
			metadata: { url, crawlSettingId },
		});

		const setup = await buildCrawlSetup(url, crawlSettingId);
		const { domain, robots, crawlDelay, settingsSnapshot, crawlSettings } = setup;

		const crawlRun = await createCrawlRun({
			domain,
			startUrl: url,
			entityType,
			entityId,
			maxPages: crawlSettings.crawlAllPages ? CRAWL_ALL_PAGES_CAP : crawlSettings.maxCrawlPages,
			robots,
			crawlDelay,
			crawlRunType: "crawl",
			crawlSettingId,
			settingsSnapshot,
			usedSitemap: setup.sitemapSeeds.length > 0,
		});

		if (!crawlRun.ok) {
			await log({
				level: "error",
				source: "scheduler",
				message: "Failed to create crawl run",
				metadata: {
					entityId,
					crawlSettingId,
					error: crawlRun.error,
				},
			});

			throw new Error(crawlRun.error);
		}

		await syncCrawlSchedule({
			crawlSettingId: crawlSettingId,
			crawlRunId: crawlRun.crawlRunId,
			lastCrawlMethod: "automatic",
		});

		return await executeCrawl(url, setup, crawlSettingId, crawlRun.crawlRunId)
			.then(async () => {
				await log({
					level: "info",
					source: "scheduler",
					message: "Scheduled crawl started",
					metadata: { crawlRunId: crawlRun.crawlRunId },
					crawlRunId: crawlRun.crawlRunId,
				});

				return { ok: true as const, crawlSettingId };
			})
			.catch(async (error) => {
				const errorMessage =
					error instanceof Error && error.message.length > 0 ? error.message : "unknown_error";

				await log({
					level: "error",
					source: "scheduler",
					message: errorMessage,
					metadata: { crawlRunId: crawlRun.crawlRunId },
					crawlRunId: crawlRun.crawlRunId,
				});

				await updateCrawlRunError(crawlRun.crawlRunId, { status: "failure", errorMessage });

				return { ok: false as const, error: errorMessage, crawlSettingId };
			});
	} catch (error) {
		return {
			ok: false as const,
			error: error instanceof Error && error.message.length > 0 ? error.message : "unknown_error",
		};
	}
}
