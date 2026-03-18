"use server";

import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import { upsertResource } from "@/lib/actions/resources";
import { upsertCrawlSettings } from "./crawlSettings";
import { canonicalizeUrl, canonicalizeUrlString } from "@/lib/ai/url";
import { requireAuth } from "@/lib/auth/guards";

import { DEFAULT_CRAWL_OPTIONS } from "../crawlDefaults";
import { extractGoogleCalendarId, formatEventsforEmbedding } from "../calendar";
import { extractTextFromPdf } from "../pdf";
import { extractTextFromGoogleDoc } from "../googleDocs";

const verbose = process.env.NODE_ENV !== "production";

const absolutize = (base: string, href: string): URL | null => {
	try {
		return new URL(href, `https://${base}/`);
	} catch {
		return null;
	}
};

const extractLinks = (baseUrl: string, html: string, opts: { dropAllQuery: boolean }): URL[] => {
	const hrefs = Array.from(
		html.matchAll(/<a\s+(?:[^>]*?\s+)?href\s*=\s*["']([^"']+)["'](?:\s+[^>]*)?>/gi),
	)
		.map((match) => match[1])
		.filter(Boolean) as string[];

	const urls = hrefs
		.map((href) => absolutize(baseUrl, href))
		.filter((url): url is URL => !!url)
		.filter((url) => url.protocol.startsWith("http"))
		.filter((url) => !url.pathname.includes("__catapult_pages"))
		.map((url) => canonicalizeUrl(url, { dropAllQuery: opts.dropAllQuery }));

	const seen = new Set<string>();
	const unique: URL[] = [];
	for (const url of urls) {
		const urlKey = url.toString();
		if (!seen.has(urlKey)) {
			seen.add(urlKey);
			unique.push(url);
		}
	}
	return unique;
};

const extractTextFromHtml = (html: string, url: string): string => {
	try {
		const dom = new JSDOM(html, { url });
		const reader = new Readability(dom.window.document);
		const article = reader.parse();
		const text = (article?.textContent ?? "").trim();
		if (text.length > 0) return text;
	} catch {}

	const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "");
	const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, "");
	const text = withoutStyles.replace(/<[^>]+>/g, " ");
	return text.replace(/\s+/g, " ").trim();
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

const pathAllowed = (path: string, rules: RobotsRules): boolean => {
	const matchLen = (pattern: string) => (pattern && path.startsWith(pattern) ? pattern.length : -1);

	let allowLen = -1;
	for (const allowPattern of rules.allow) allowLen = Math.max(allowLen, matchLen(allowPattern));

	let disallowLen = -1;
	for (const disallowPattern of rules.disallow)
		disallowLen = Math.max(disallowLen, matchLen(disallowPattern));

	if (allowLen === -1 && disallowLen === -1) return true;
	return allowLen >= disallowLen;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const getFileTypeFromGoogleDrive = async (url: string): Promise<string> => {
	const response = await fetch(url, { method: "HEAD" });
	const contentDisposition = response.headers.get("content-disposition");

	if (contentDisposition) {
		const filenameMatch = contentDisposition.match(/filename[^;=\n]*=(['"]?)([^'"\n]*)\1/);

		if (filenameMatch?.[2]) {
			const filename = decodeURIComponent(filenameMatch[2]);
			const extension = filename.split(".").pop()?.toLowerCase();
			if (extension) return extension;
		}
	}

	return "";
};

export async function crawlSite(
	input: {
		url: string;
		maxDepth?: number;
		maxPages?: number;
		maxCharsPerPage?: number;
		includeSitemapSeeds?: boolean;
		ignoreRobots?: boolean;
		dropAllQuery?: boolean;
		urlsToIgnore?: string[];
		schoolId: string;
		domain?: string;
	},
	updateCrawlSetting: boolean,
) {
	await requireAuth();
	const startRaw = input.url.trim();
	const dropAllQuery = input.dropAllQuery ?? DEFAULT_CRAWL_OPTIONS.dropAllQuery;

	const startCanonical = canonicalizeUrlString(startRaw, { dropAllQuery });
	const start = new URL(startCanonical);

	const hostname = start.hostname.toLowerCase();
	const pathSegments = start.pathname.split("/").filter(Boolean);
	const basePrefix = pathSegments.length > 0 ? `/${pathSegments[0]}` : "";

	const domain = input.domain ? input.domain : basePrefix ? `${hostname}${basePrefix}` : hostname;

	const maxDepth = clampInt(input.maxDepth, 0, DEFAULT_CRAWL_OPTIONS.maxDepth);
	const maxPages = clampInt(input.maxPages, 1, DEFAULT_CRAWL_OPTIONS.maxPages);
	const maxCharsPerPage = clampInt(
		input.maxCharsPerPage,
		1000,
		DEFAULT_CRAWL_OPTIONS.maxCharsPerPage,
	);

	const includeSitemapSeeds =
		input.includeSitemapSeeds ?? DEFAULT_CRAWL_OPTIONS.includeSitemapSeeds;
	const ignoreRobots = input.ignoreRobots ?? DEFAULT_CRAWL_OPTIONS.ignoreRobots;

	const origin = `${start.protocol}//${hostname}`;
	const robots = ignoreRobots
		? { allow: ["/"], disallow: [], crawlDelay: 0 }
		: await fetchRobots(origin);
	const crawlDelay = ignoreRobots ? 0 : robots.crawlDelay || 0;

	const sitemapSeeds = includeSitemapSeeds ? await fetchSitemap(origin) : [];

	const urlsToIgnore = input.urlsToIgnore ? input.urlsToIgnore : [];

	const toVisit: Array<{ url: URL; depth: number }> = [{ url: start, depth: 0 }];
	const queued = new Set<string>([start.toString()]);
	const visited = new Set<string>();

	for (const seedUrlStr of sitemapSeeds) {
		try {
			const normalizedUrl = canonicalizeUrl(new URL(seedUrlStr), {
				dropAllQuery,
			});
			if (
				normalizedUrl.hostname.toLowerCase() === hostname &&
				(basePrefix === "" || normalizedUrl.pathname.startsWith(basePrefix))
			) {
				const urlKey = normalizedUrl.toString();
				if (!queued.has(urlKey) && !visited.has(urlKey)) {
					queued.add(urlKey);
					toVisit.push({ url: normalizedUrl, depth: 0 });
				}
			}
		} catch {}
	}

	let pagesProcessed = 0;
	let calendarIngested = false;

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
			schoolId: input.schoolId,
		},
		updateCrawlSetting,
	);

	if (!crawlSetting.ok) {
		throw new Error(crawlSetting.error);
	}

	const crawlSettingId = crawlSetting.crawlSettingId;

	while (toVisit.length > 0 && pagesProcessed < maxPages) {
		const { url, depth } = toVisit.shift()!;
		let key = url.toString();
		queued.delete(key);

		if (visited.has(key)) continue;
		visited.add(key);

		try {
			if (!ignoreRobots && !pathAllowed(url.pathname, robots)) {
				if (verbose) console.log(`Skipping disallowed URL: ${key}`);
				continue;
			}

			if (crawlDelay > 0) await sleep(crawlDelay * 1000);

			const response = await fetch(key, { cache: "no-store" });
			if (verbose) console.log(`Crawling ${key} (depth: ${depth}) - ${response.status}`);
			if (!response.ok) continue;

			let html = "";

			if (key.startsWith("https://tinyurl.com/")) {
				const response = await fetch(key, {
					redirect: "follow",
				});

				key = response.url;
			}

			if (key.endsWith(".pdf")) {
				const response = await extractTextFromPdf(key);

				if (!response.ok) {
					throw new Error(response.error);
				}

				const contentText = response.text.slice(0, maxCharsPerPage).replaceAll(/\s+/g, " ").trim();

				if (contentText.length > 0) {
					const result = await upsertResource({
						domain,
						url: key,
						content: contentText,
						crawlSettingId,
						schoolId: input.schoolId,
					});

					if (result.ok) pagesProcessed++;
					else if (verbose) console.warn(`Failed to upsert ${key}: ${result.error}`);
				}
			} else if (key.startsWith("https://drive.google.com/file/d/")) {
				const match = key.match(/\/file\/d\/([^/]+)/);

				if (match) {
					const directUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
					const fileType = await getFileTypeFromGoogleDrive(directUrl);

					if (fileType === "pdf") {
						const response = await extractTextFromPdf(directUrl);

						if (!response.ok) {
							throw new Error(response.error);
						}

						const contentText = response.text
							.slice(0, maxCharsPerPage)
							.replaceAll(/\s+/g, " ")
							.trim();

						if (contentText.length > 0) {
							const result = await upsertResource({
								domain,
								url: key,
								content: contentText,
								crawlSettingId,
								schoolId: input.schoolId,
							});

							if (result.ok) pagesProcessed++;
							else if (verbose) console.warn(`Failed to upsert ${key}: ${result.error}`);
						}
					}
				}
			} else if (key.startsWith("https://docs.google.com/document/d/")) {
				const match = key.match(/\/document\/d\/([^/]+)/);

				if (match) {
					const directUrl = `https://docs.google.com/document/d/${match[1]}/export?format=txt`;
					const response = await extractTextFromGoogleDoc(directUrl);

					if (!response.ok) {
						throw new Error(response.error);
					}

					const contentText = response.text
						.slice(0, maxCharsPerPage)
						.replaceAll(/\s+/g, " ")
						.trim();

					if (response.text.length > 0) {
						const result = await upsertResource({
							domain,
							url: key,
							content: contentText,
							crawlSettingId,
							schoolId: input.schoolId,
						});

						if (result.ok) pagesProcessed++;
						else if (verbose) console.warn(`Failed to upsert ${key}: ${result.error}`);
					}
				}
			} else {
				html = await response.text();
				let contentText = "";

				if (!calendarIngested) {
					const calendarId = extractGoogleCalendarId(html);
					if (calendarId) {
						contentText += `${await formatEventsforEmbedding(calendarId)}\n`;
						calendarIngested = true;
					}
				}

				const dom = new JSDOM(html, { url: key });
				const reader = new Readability(dom.window.document);
				const article = reader.parse();

				contentText += (article?.textContent ?? extractTextFromHtml(html, key))
					.slice(0, maxCharsPerPage)
					.replaceAll(/\s+/g, " ")
					.trim();

				if (contentText.length > 0) {
					const result = await upsertResource({
						domain,
						url: key,
						content: contentText,
						crawlSettingId,
						schoolId: input.schoolId,
					});

					if (result.ok) pagesProcessed++;
					else if (verbose) console.warn(`Failed to upsert ${key}: ${result.error}`);
				}
			}

			if (depth < maxDepth && html) {
				const links = extractLinks(domain, html, { dropAllQuery }).filter(
					(u) =>
						(u.hostname.toLowerCase() === hostname ||
							u.href.startsWith("https://drive.google.com/file/d/") ||
							u.href.startsWith("https://docs.google.com/document/d/") ||
							u.href.startsWith("https://tinyurl.com/") ||
							u.href.endsWith(".pdf")) &&
						!urlsToIgnore.includes(u.href),
				);

				for (const link of links) {
					const linkKey = link.toString();
					if (!visited.has(linkKey) && !queued.has(linkKey)) {
						queued.add(linkKey);
						toVisit.push({ url: link, depth: depth + 1 });
					}
				}
			}
		} catch {}
	}

	return { message: "Site crawled and embedded", domain, pagesProcessed };
}
