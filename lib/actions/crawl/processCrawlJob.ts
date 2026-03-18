"use server";

import { claimCrawlJob, updateCrawlJobError, updateCrawlJobSuccess } from "./crawlJobs";
import { publishCrawlJob } from "./publish";

import { extractTextFromPdf } from "../pdf";
import { upsertResource } from "../resources";
import { extractGoogleCalendarId, formatEventsforEmbedding } from "../calendar";

import { canonicalizeUrl } from "@/lib/ai/url";

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { extractTextFromGoogleDoc } from "../googleDocs";
import { updateCalendarProcessed } from "./crawlSettings";

const verbose = process.env.NODE_ENV !== "production";

type CrawlSettings = {
	maxDepth: number;
	maxPages: number;
	maxCharsPerPage: number;
	includeSitemapSeeds: boolean;
	ignoreRobots: boolean;
	dropAllQuery: boolean;
	urlsToIgnore: string[];
	domain: string;
};

type RobotsRules = { allow: string[]; disallow: string[]; crawlDelay: number };

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

const absolutize = (base: string, href: string): URL | null => {
	try {
		return new URL(href, `https://${base}/`);
	} catch {
		return null;
	}
};

const processPdf = async (
	key: string,
	maxCharsPerPage: number,
	domain: string,
	crawlSettingId: string,
	schoolId: string,
) => {
	const response = await extractTextFromPdf(key);

	if (!response.ok) {
		return { ok: false as const, error: response.error };
	}

	const contentText = response.text.slice(0, maxCharsPerPage).replaceAll(/\s+/g, " ").trim();

	if (contentText.length > 0) {
		const result = await upsertResource({
			domain,
			url: key,
			content: contentText,
			crawlSettingId,
			schoolId: schoolId,
		});

		if (result.ok) {
			return { ok: true as const, resourceId: result.resourceId };
		} else {
			return { ok: false as const, error: `Failed to upsert ${key}: ${result.error}` };
		}
	} else {
		return {
			ok: false as const,
			error: "Parsed content has invalid length",
		};
	}
};

const processGoogleDrive = async (
	key: string,
	maxCharsPerPage: number,
	domain: string,
	crawlSettingId: string,
	schoolId: string,
) => {
	const match = key.match(/\/file\/d\/([^/]+)/);

	if (match) {
		const directUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
		const fileType = await getFileTypeFromGoogleDrive(directUrl);

		if (fileType === "pdf") {
			const response = await extractTextFromPdf(directUrl);

			if (!response.ok) {
				return { ok: false as const, error: `${key} ${response.error}` };
			}

			const contentText = response.text.slice(0, maxCharsPerPage).replaceAll(/\s+/g, " ").trim();

			if (contentText.length > 0) {
				const result = await upsertResource({
					domain,
					url: key,
					content: contentText,
					crawlSettingId,
					schoolId: schoolId,
				});

				if (result.ok) {
					return { ok: true as const, resourceId: result.resourceId };
				} else {
					return { ok: false as const, error: `Failed to upsert ${key}: ${result.error}` };
				}
			} else {
				return { ok: false as const, error: `Invalid text content length for ${key}` };
			}
		} else {
			return { ok: false as const, error: `Google drive link: ${key} not in PDF format.` };
		}
	} else {
		return { ok: false as const, error: `Google drive ID not found in ${key}.` };
	}
};

const processGoogleDoc = async (
	key: string,
	maxCharsPerPage: number,
	domain: string,
	crawlSettingId: string,
	schoolId: string,
) => {
	const match = key.match(/\/document\/d\/([^/]+)/);

	if (match) {
		const directUrl = `https://docs.google.com/document/d/${match[1]}/export?format=txt`;
		const response = await extractTextFromGoogleDoc(directUrl);

		if (!response.ok) {
			throw new Error(response.error);
		}

		const contentText = response.text.slice(0, maxCharsPerPage).replaceAll(/\s+/g, " ").trim();

		if (response.text.length > 0) {
			const result = await upsertResource({
				domain,
				url: key,
				content: contentText,
				crawlSettingId,
				schoolId: schoolId,
			});

			if (result.ok) {
				return { ok: true as const, resourceId: result.resourceId };
			} else {
				return { ok: false as const, error: `Failed to upsert ${key}: ${result.error}` };
			}
		} else {
			return { ok: false as const, error: `Invalid text content length for ${key}` };
		}
	} else {
		return { ok: false as const, error: `Google document ID not found in ${key}.` };
	}
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

const processHtml = async (
	key: string,
	response: Response,
	maxCharsPerPage: number,
	domain: string,
	crawlSettingId: string,
	schoolId: string,
) => {
	const html = await response.text();
	let contentText = "";

	const calendarId = extractGoogleCalendarId(html);
	if (calendarId) {
		const canProcess = await updateCalendarProcessed(crawlSettingId);
		if (canProcess) contentText += `${await formatEventsforEmbedding(calendarId)}\n`;
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
			schoolId: schoolId,
		});

		if (result.ok) {
			return { ok: true as const, resourceId: result.resourceId, html: html };
		} else {
			return { ok: false as const, error: `Failed to upsert ${key}: ${result.error}` };
		}
	} else {
		return { ok: false as const, error: `Invalid text content length for ${key}` };
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

const getFlowControl = async (
	link: string,
	crawlSetting: string,
): Promise<{ key: string; parallelism: number; rate: number; period: `${bigint}m` }> => {
	if (link.startsWith("https://drive.google.com/file/d/") || link.endsWith(".pdf")) {
		return { key: `${crawlSetting}-pdf`, parallelism: 2, rate: 30, period: "1m" as `${bigint}m` };
	} else if (link.startsWith("https://docs.google.com/document/d/")) {
		return { key: `${crawlSetting}-docs`, parallelism: 5, rate: 50, period: "1m" };
	} else {
		return { key: `${crawlSetting}-html`, parallelism: 10, rate: 100, period: "1m" };
	}
};

export async function processCrawlJob(
	crawlSettings: CrawlSettings,
	crawlSettingId: string,
	crawlJobId: string,
	schoolId: string,
	url: string,
	domain: string,
	depth: number,
	robots: RobotsRules,
	crawlDelay: number,
) {
	const start = performance.now();

	const urlObj = new URL(url);
	let key = urlObj.href;

	if (!crawlSettings.ignoreRobots && !pathAllowed(urlObj.pathname, robots)) {
		if (verbose) console.log(`Skipping disallowed URL: ${key}`);
		await updateCrawlJobError({ crawlJobId: crawlJobId, errorMessage: "Skipped disallowed URL" });
		return;
	}

	if (crawlDelay > 0) await sleep(crawlDelay * 1000);

	try {
		const response = await fetch(key, { cache: "no-store" });
		if (verbose) console.log(`Crawling ${key} (depth: ${depth}) - ${response.status}`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		let html = "";

		if (key.startsWith("https://tinyurl.com/")) {
			const response = await fetch(key, {
				redirect: "follow",
			});

			key = response.url;
		}

		if (key.endsWith(".pdf")) {
			const result = await processPdf(
				key,
				crawlSettings.maxCharsPerPage,
				domain,
				crawlSettingId,
				schoolId,
			);

			if (result.ok) {
				const stop = performance.now();

				await updateCrawlJobSuccess({
					crawlJobId: crawlJobId,
					fileType: "pdf",
					resourceId: result.resourceId,
					time: Number(((stop - start) / 1000).toFixed(2)),
				});
			} else {
				if (verbose) console.warn(result.error);
				throw new Error(result.error);
			}
		} else if (key.startsWith("https://drive.google.com/file/d/")) {
			const result = await processGoogleDrive(
				key,
				crawlSettings.maxCharsPerPage,
				domain,
				crawlSettingId,
				schoolId,
			);

			if (result.ok) {
				const stop = performance.now();

				await updateCrawlJobSuccess({
					crawlJobId: crawlJobId,
					fileType: "pdf",
					resourceId: result.resourceId,
					time: Number(((stop - start) / 1000).toFixed(2)),
				});
			} else {
				if (verbose) console.warn(result.error);
				throw new Error(result.error);
			}
		} else if (key.startsWith("https://docs.google.com/document/d/")) {
			const result = await processGoogleDoc(
				key,
				crawlSettings.maxCharsPerPage,
				domain,
				crawlSettingId,
				schoolId,
			);

			if (result.ok) {
				const stop = performance.now();

				await updateCrawlJobSuccess({
					crawlJobId: crawlJobId,
					fileType: "doc",
					resourceId: result.resourceId,
					time: Number(((stop - start) / 1000).toFixed(2)),
				});
			} else {
				if (verbose) console.warn(result.error);
				throw new Error(result.error);
			}
		} else {
			const result = await processHtml(
				key,
				response,
				crawlSettings.maxCharsPerPage,
				domain,
				crawlSettingId,
				schoolId,
			);

			if (result.ok) {
				const stop = performance.now();

				await updateCrawlJobSuccess({
					crawlJobId: crawlJobId,
					fileType: "html",
					resourceId: result.resourceId,
					time: Number(((stop - start) / 1000).toFixed(2)),
				});
			} else {
				if (verbose) console.warn(result.error);
				throw new Error(result.error);
			}

			html = result.html;
		}

		if (depth < crawlSettings.maxDepth && html) {
			const links = extractLinks(domain, html, { dropAllQuery: crawlSettings.dropAllQuery }).filter(
				(u) =>
					(u.hostname.toLowerCase() === urlObj.hostname ||
						u.href.startsWith("https://drive.google.com/file/d/") ||
						u.href.startsWith("https://docs.google.com/document/d/") ||
						u.href.startsWith("https://tinyurl.com/") ||
						u.href.endsWith(".pdf")) &&
					!crawlSettings.urlsToIgnore.includes(u.href),
			);

			for (const link of links) {
				const crawlJob = await claimCrawlJob({ url: link.href, depth: depth + 1, crawlSettingId });
				if (!crawlJob.ok) {
					if (crawlJob.reason === "duplicate") continue;
					else if (crawlJob.reason === "max_pages") break;
					else {
						if (verbose) console.log(crawlJob.reason);
						break;
					}
				}

				const crawlJobId = crawlJob.id;

				const flowControl = await getFlowControl(link.href, crawlSettingId);

				await publishCrawlJob(
					domain,
					link.href,
					schoolId,
					depth + 1,
					crawlDelay,
					robots,
					crawlSettingId,
					crawlJobId,
					{
						maxDepth: crawlSettings.maxDepth,
						maxPages: crawlSettings.maxPages,
						maxCharsPerPage: crawlSettings.maxCharsPerPage,
						ignoreRobots: crawlSettings.ignoreRobots,
						dropAllQuery: crawlSettings.dropAllQuery,
						urlsToIgnore: crawlSettings.urlsToIgnore,
						domain: domain,
					},
					flowControl,
				);
			}
		}
	} catch (error) {
		if (verbose)
			console.warn(
				`Error processing ${key}: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		await updateCrawlJobError({
			crawlJobId: crawlJobId,
			errorMessage: error instanceof Error ? error.message : "Unknown error",
		});
		return;
	}
}
