"use server";

import type { FlowControl } from "@upstash/qstash";
import type { RobotsRules } from "@/lib/types/crawl";
import { canonicalizeUrl } from "@/lib/ai/url";
import {
	claimCrawlJob,
	getCrawlJobData,
	updateCrawlJobError,
	updateCrawlJobSuccess,
} from "./crawlJobs";
import { getFlowControl, publishCrawlJob } from "./publish";
import { generateCrawlSettingSnapshot, verbose } from "./utils";
import { processPage } from "./handlers/handler";
import { extractSchoolDirectory } from "./handlers/html";
import { renderHtml } from "./render";
import { upsertResource } from "../resources";
import { log } from "../logger";

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

const absolutize = (base: string, href: string): URL | null => {
	try {
		return new URL(href, `https://${base}/`);
	} catch {
		return null;
	}
};

const extractLinks = (
	baseUrl: string,
	html: string,
	opts: { dropAllQuery: boolean; followCatapultAliases: boolean },
): URL[] => {
	const hrefs = Array.from(
		html.matchAll(/<a\s+(?:[^>]*?\s+)?href\s*=\s*["']([^"']+)["'](?:\s+[^>]*)?>/gi),
	)
		.map((match) => match[1])
		.filter(Boolean) as string[];

	const urls = hrefs
		.map((href) => absolutize(baseUrl, href))
		.filter((url): url is URL => !!url)
		.filter((url) => url.protocol.startsWith("http"))
		// Don't queue media/binary assets (videos, images, archives). PDFs are
		// kept — they have a dedicated handler.
		.filter(
			(url) =>
				!/\.(mp4|m4v|mov|avi|wmv|mkv|webm|mp3|wav|m4a|ogg|jpe?g|png|gif|svg|webp|ico|zip|rar|7z|gz)$/i.test(
					url.pathname,
				),
		)
		// __catapult_pages are global-link aliases that 302 to real pages. Follow
		// them only when there's no sitemap; otherwise the sitemap already covers
		// the site and the aliases are redundant.
		.filter((url) => opts.followCatapultAliases || !url.pathname.includes("__catapult_pages"))
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

export async function processCrawlJob(crawlJobId: string) {
	const crawlData = await getCrawlJobData(crawlJobId);

	if (!crawlData.ok) {
		if (verbose) console.warn(crawlData.error);

		await log({
			level: "error",
			source: "crawler",
			message: "Failed to load crawl job data",
			metadata: { crawlJobId, error: crawlData.error },
		});

		throw new Error(crawlData.error);
	}

	const {
		crawlSettings,
		url,
		depth,
		crawlRunId,
		runStatus,
		robots,
		crawlDelay,
		jobType,
		usedSitemap,
	} = crawlData.crawlData;

	// Stop button / cancellation: if the run is no longer "running", drain this
	// in-flight QStash message as a no-op (return 200 so QStash doesn't retry) and
	// publish no children, which kills the rest of the cascade within one cycle.
	if (runStatus !== "running") {
		if (verbose) console.log(`Skipping ${url}: crawl run ${crawlRunId} is ${runStatus}`);
		return;
	}

	const settingsSnapshot = generateCrawlSettingSnapshot(crawlSettings);

	const start = performance.now();

	const urlObj = new URL(url);
	let key = urlObj.href;

	if (!crawlSettings.ignoreRobots && robots && !pathAllowed(urlObj.pathname, robots)) {
		if (verbose) console.log(`Skipping disallowed URL: ${key}`);

		await log({
			level: "info",
			source: "crawler",
			message: "Skipping robots-disallowed URL",
			metadata: { url: key, crawlJobId },
			crawlRunId,
		});

		await updateCrawlJobError({
			crawlJobId: crawlJobId,
			errorMessage: "Skipped disallowed URL",
			crawlRunId: crawlRunId,
		});
		return;
	}

	try {
		let response = await fetch(key, { cache: "no-store" });
		if (verbose) console.log(`Crawling ${key} (depth: ${depth}) - ${response.status}`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		key = response.url;

		// PDFs and Google Docs/Drive are handled by their own parsers; everything
		// else is treated as an HTML page (which is what gets rendered).
		const contentType = response.headers.get("content-type") ?? "";
		const isPdf = contentType.includes("application/pdf") || key.endsWith(".pdf");
		const isGoogleDoc =
			key.startsWith("https://drive.google.com/file/d/") ||
			key.startsWith("https://docs.google.com/document/d/");
		const isHtmlPage = !isPdf && !isGoogleDoc;

		// Skip binary assets (video, audio, images, archives, ...): there's nothing
		// to extract, and they must not be rendered or parsed as HTML.
		if (
			isHtmlPage &&
			contentType !== "" &&
			!contentType.includes("text/html") &&
			!contentType.includes("xhtml")
		) {
			await updateCrawlJobError({
				crawlJobId,
				errorMessage: `Skipped non-HTML content (${contentType})`,
				crawlRunId,
			});
			return;
		}

		// If the request redirected to a different host and it isn't a document we
		// handle cross-host (PDF / Google Doc / Drive), skip it. This covers CMS
		// shortcut links that redirect off-site (e.g. /AuroraPRIDE -> a Google Form)
		// and off-site __catapult_pages global-link aliases — we don't want external
		// content saved under this site's resources.
		if (isHtmlPage && new URL(key).hostname.toLowerCase() !== urlObj.hostname.toLowerCase()) {
			await updateCrawlJobError({
				crawlJobId,
				errorMessage: "Skipped off-site redirect",
				crawlRunId,
			});
			return;
		}

		// When JS rendering is enabled, replace the raw HTML with browser-rendered
		// HTML so both content extraction and link discovery see JS-injected DOM.
		let renderedHtml: string | null = null;
		if (isHtmlPage && crawlSettings.renderJavascript) {
			try {
				renderedHtml = await renderHtml(key);
				response = new Response(renderedHtml, {
					headers: { "content-type": "text/html; charset=utf-8" },
				});
			} catch (error) {
				await log({
					level: "warn",
					source: "crawler",
					message: "Renderer failed, falling back to static fetch",
					metadata: {
						url: key,
						crawlJobId,
						error: error instanceof Error ? error.message : String(error),
					},
					crawlRunId,
				});
			}
		}

		const result = await processPage(
			key,
			response.clone(),
			crawlSettings.entityId,
			crawlSettings.maxCharsPerPage,
			crawlSettings.domain,
			crawlSettings.id,
		);

		if (!result.ok) throw new Error(result.error);

		if (result.fileType !== "html") {
			const stop = performance.now();

			await updateCrawlJobSuccess(crawlJobId, crawlRunId, {
				fileType: result.fileType,
				resourceId: result.resourceId,
				time: Number(((stop - start) / 1000).toFixed(2)),
				contentSnapshot: result.contentSnapshot,
			});
		}

		const html = renderedHtml ?? (await response.text());

		// Embed the district school directory once: it's identical on every page,
		// so upsertResource's content-hash dedup means only the first occurrence
		// per crawl actually re-embeds. Kept out of per-page content to avoid
		// duplicating it across every page's embeddings.
		if (result.fileType === "html") {
			try {
				const directoryMd = extractSchoolDirectory(html);
				if (directoryMd) {
					await upsertResource({
						domain: crawlSettings.domain,
						url: `https://${urlObj.hostname}/__directory`,
						entityId: crawlSettings.entityId,
						content: directoryMd,
						crawlSettingId: crawlSettings.id,
						pageTitle: "School Directory",
						file_type: "html",
						categories: {
							topCategory: "Schools",
							subCategory: "",
							pageCategory: "Directory",
							fullPath: "Schools > Directory",
						},
					});
				}
			} catch (error) {
				await log({
					level: "warn",
					source: "crawler",
					message: "Failed to upsert school directory",
					metadata: {
						url: key,
						crawlJobId,
						error: error instanceof Error ? error.message : String(error),
					},
					crawlRunId,
				});
			}
		}

		if (
			jobType === "crawl" &&
			(crawlSettings.crawlAllPages || depth < crawlSettings.maxCrawlDepth)
		) {
			const links = extractLinks(crawlSettings.domain, html, {
				dropAllQuery: crawlSettings.dropAllQuery,
				followCatapultAliases: !usedSitemap,
			}).filter(
				(u) =>
					(u.hostname.toLowerCase() === urlObj.hostname ||
						u.href.startsWith("https://drive.google.com/file/d/") ||
						u.href.startsWith("https://docs.google.com/document/d/") ||
						u.href.startsWith("https://tinyurl.com/") ||
						u.href.endsWith(".pdf")) &&
					!crawlSettings.urlsToIgnore.includes(u.href),
			);

			const jobsToPublish: { crawlJobId: string; flowControl: FlowControl }[] = [];

			for (const link of links) {
				const crawlJob = await claimCrawlJob({
					url: link.href,
					depth: depth + 1,
					crawlSettingId: crawlSettings.id,
					crawlRunId: crawlRunId,
					settingsSnapshot,
				});

				if (!crawlJob.ok) {
					if (crawlJob.reason === "duplicate") continue;
					else if (crawlJob.reason === "max_pages") break;
					else {
						if (verbose) console.log(crawlJob.reason);

						await log({
							level: "warn",
							source: "crawler",
							message: "Unexpected claim crawl job failure",
							metadata: { reason: crawlJob.reason, url: link.href, crawlJobId },
							crawlRunId,
						});
						break;
					}
				}

				const flowControl = getFlowControl(link.href, crawlSettings.id);

				jobsToPublish.push({ crawlJobId: crawlJob.id, flowControl });
			}

			await Promise.all(
				jobsToPublish.map((j) => publishCrawlJob(j.crawlJobId, j.flowControl, crawlDelay)),
			);
		}

		const stop = performance.now();

		await updateCrawlJobSuccess(crawlJobId, crawlRunId, {
			fileType: "html",
			resourceId: result.resourceId,
			time: Number(((stop - start) / 1000).toFixed(2)),
			contentSnapshot: result.contentSnapshot,
		});
	} catch (error) {
		await log({
			level: "error",
			source: "crawler",
			message: "Crawl job failed",
			metadata: {
				url: key,
				crawlJobId,
				error: error instanceof Error ? error.message : "Unknown error",
			},
			crawlRunId,
		});

		await updateCrawlJobError({
			crawlJobId: crawlJobId,
			errorMessage: error instanceof Error ? error.message : "Unknown error",
			crawlRunId: crawlRunId,
		});

		return;
	}
}
