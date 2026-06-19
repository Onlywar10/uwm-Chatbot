"use server";

import { db } from "@/lib/db";
import { crawlJobs } from "@/lib/db/schema/crawlJobs";
import { crawlRuns } from "@/lib/db/schema/crawlRuns";
import { crawlSettings } from "@/lib/db/schema/crawlSettings";
import { districts } from "@/lib/db/schema/districts";
import { schools } from "@/lib/db/schema/schools";
import { and, eq, sql } from "drizzle-orm";

import { updateCrawlScheduleSuccess } from "./crawlSchedule";
import { log } from "../logger";
import { CRAWL_ALL_PAGES_CAP } from "../crawlDefaults";

import { z } from "zod";

const claimCrawlJobSchema = z.object({
	url: z.string().min(1),
	depth: z.number().min(0),
	crawlSettingId: z.string().min(1),
	crawlRunId: z.string().min(1),
	jobType: z.enum(["crawl", "recrawl"]).optional(),
	settingsSnapshot: z.object({
		maxDepth: z.number(),
		maxPages: z.number(),
		maxCharsPerPage: z.number(),
		includeSitemapSeeds: z.boolean(),
		ignoreRobots: z.boolean(),
		dropAllQuery: z.boolean(),
		renderJavascript: z.boolean(),
		crawlAllPages: z.boolean(),
		urlsToIgnore: z.array(z.string()),
	}),
});

/**
 * - Atomically claims a crawl job by registering a new URL
 * to be crawled within a crawl run. Increments the run's
 * pagesDiscovered count (enforcing the maxPages limit) and
 * inserts a new crawl job record. If the URL has already
 * been claimed for this run, rolls back the page count
 * increment and rejects the job as a duplicate.
 * @param input - Unvalidated input object conforming to the {@link claimCrawlJobSchema} below:
 * @param input.url - The URL to crawl.
 * @param input.depth - The crawl depth at which this URL was discovered.
 * @param input.crawlSettingId - ID of the crawl settings configuration.
 * @param input.settingsSnapshot - A snapshot of the crawl settings at job creation time.
 * @returns On success returns an object with “ok: true” and the new crawl
 * job id. On failure returns an object with “ok: false” and the reason
 * string for failure either [”max_pages”, “duplicate”, “unknown_error”].
 */
export async function claimCrawlJob(input: unknown) {
	try {
		const parsed = claimCrawlJobSchema.parse(input);

		const [{ count }] = await db
			.select({ count: sql<number>`cast(count(*) as integer)` })
			.from(crawlJobs)
			.where(eq(crawlJobs.crawlRunId, parsed.crawlRunId));

		// In crawl-all mode we ignore the per-setting page limit but still enforce a
		// hard safety cap so runaway sites (infinite calendars, faceted nav) can't
		// crawl forever.
		const effectiveMaxPages = parsed.settingsSnapshot.crawlAllPages
			? CRAWL_ALL_PAGES_CAP
			: parsed.settingsSnapshot.maxPages;
		if (count >= effectiveMaxPages) throw new Error("max_pages");

		const [crawlJob] = await db
			.insert(crawlJobs)
			.values({
				url: parsed.url,
				depth: parsed.depth,
				crawlSettingId: parsed.crawlSettingId,
				crawlRunId: parsed.crawlRunId,
				jobType: parsed.jobType,
				settingsSnapshot: parsed.settingsSnapshot,
			})
			.onConflictDoNothing({
				target: [crawlJobs.url, crawlJobs.crawlSettingId, crawlJobs.crawlRunId],
			})
			.returning({ id: crawlJobs.id });

		if (!crawlJob) throw new Error("duplicate");

		return { ok: true as const, id: crawlJob.id };
	} catch (error) {
		const reason =
			error instanceof Error && error.message.length > 0
				? error.message
				: "Error claiming crawl job.";

		if (reason !== "max_pages" && reason !== "duplicate") {
			await log({
				level: "error",
				source: "db",
				message: "Unexpected error claiming crawl job",
				metadata: { error: reason },
			});
		}

		return {
			ok: false as const,
			reason,
		};
	}
}

/**
 * - Fetches the full data needed to execute a crawl job, which includes the
 * crawl settings, the crawl run data (robots rules and crawl delay), and job
 * specific fields (URL, depth, job type).
 * @param id - The ID of the crawl job to look up.
 * @returns On success returns an object with “ok: true” and a
 * CrawlData object that contains a crawl jobs crawl settings
 * configuration, url, depth, crawlRunId,  robots, crawl delay, and job type.
 * On failure return an object with “ok: false” and the error string for failure.
 */
export async function getCrawlJobData(id: string) {
	try {
		const [crawlData] = await db
			.select({
				crawlSettings: crawlSettings,
				url: crawlJobs.url,
				depth: crawlJobs.depth,
				crawlRunId: crawlRuns.id,
				runStatus: crawlRuns.status,
				robots: crawlRuns.robots,
				crawlDelay: crawlRuns.crawlDelay,
				usedSitemap: crawlRuns.usedSitemap,
				jobType: crawlJobs.jobType,
				districtName: districts.name,
				schoolName: schools.name,
			})
			.from(crawlJobs)
			.where(eq(crawlJobs.id, id))
			.innerJoin(crawlSettings, eq(crawlSettings.id, crawlJobs.crawlSettingId))
			.innerJoin(crawlRuns, eq(crawlRuns.id, crawlJobs.crawlRunId))
			.leftJoin(districts, eq(districts.id, crawlRuns.entityId))
			.leftJoin(schools, eq(schools.id, crawlRuns.entityId));

		if (!crawlData) throw new Error(`Unable to find crawl job data for ${id}`);

		return {
			ok: true as const,
			crawlData: crawlData,
		};
	} catch (error) {
		const errorMsg =
			error instanceof Error && error.message.length > 0
				? error.message
				: "Error fetching crawl job data";

		await log({
			level: "error",
			source: "db",
			message: "Failed to fetch crawl job data",
			metadata: { crawlJobId: id, error: errorMsg },
		});

		return {
			ok: false as const,
			error: errorMsg,
		};
	}
}

/**
 * - Marks a crawl job as failed by setting its status to “failure” and recording
 * the error message. Also increments the crawl run’s pagesCrawled count which
 * could potentially complete the crawl run.
 * @param crawlJobId - The ID of the crawl job to mark as failed.
 * @param errorMessage - A description of the error that occurred.
 * @param crawlRunId - The ID of the associated crawl run, or null if none.
 * @returns On success returns an object with “ok: true”.
 */
export async function updateCrawlJobError(input: {
	crawlJobId: string;
	errorMessage: string;
	crawlRunId: string;
}) {
	const { crawlJobId, crawlRunId, errorMessage } = input;

	try {
		await db
			.update(crawlJobs)
			.set({ errorMessage: errorMessage, status: "failure" })
			.where(eq(crawlJobs.id, crawlJobId));

		await updatePagesCrawled(crawlRunId);
	} catch (error) {
		await log({
			level: "error",
			source: "db",
			message: "Failed to update crawl job error status",
			crawlRunId,
			metadata: {
				crawlJobId,
				error: error instanceof Error && error.message.length > 0 ? error.message : String(error),
			},
		});
	}
}

/**
 * - Marks a crawl job as successfully completed, recording the file type,
 * the associated resource ID, and time it took to process the resource.
 * Also increments the crawl run’s pagesCrawled count which could potentially
 * complete the crawl run.
 * @param crawlJobId - The ID of the crawl job to mark as successful.
 * @param crawlRunID - The ID of the associated crawl run, or null if none.
 * @param input - Unvalidated input object conforming to the {@link updateCrawlJobSuccessSchema} below:
 * @param input.fileType - The type of the crawled file [”html”, “pdf”, “doc”, or “api”]
 * @param input.resourceId - The ID of the resource created from the crawled content.
 * @param input.time - The time taken to crawl the URL, in seconds.
 * @returns On success returns an object with “ok: true”.
 */
export async function updateCrawlJobSuccess(
	crawlJobId: string,
	crawlRunId: string,
	input: {
		fileType: "html" | "pdf" | "doc";
		resourceId: string;
		contentSnapshot: string;
		time: number;
	},
) {
	try {
		const { fileType, resourceId, time, contentSnapshot } = input;

		await db
			.update(crawlJobs)
			.set({
				fileType: fileType,
				status: "success",
				time: time.toString(),
				contentSnapshot,
				// Empty when the page had no indexable content (skipped upsert);
				// store null rather than "" so the resources FK stays valid.
				resourceId: resourceId || null,
			})
			.where(eq(crawlJobs.id, crawlJobId));

		await updatePagesCrawled(crawlRunId);

		return { ok: true as const };
	} catch (error) {
		await log({
			level: "error",
			source: "db",
			message: "Failed to update crawl job success status",
			crawlRunId,
			metadata: {
				crawlJobId: crawlJobId,
				error: error instanceof Error ? error.message : String(error),
			},
		});

		throw error;
	}
}

/**
 * - Increments the pagesCrawled for a crawl run and marks the run as completed if
 * all discovered pages are crawled or the max pages limit is reached. This is
 * called internally after a crawl job success or failure.
 * @param id - The ID of the crawl run to update.
 */
async function updatePagesCrawled(id: string) {
	try {
		const [result] = await db
			.update(crawlRuns)
			.set({
				pagesCrawled: sql`${crawlRuns.pagesCrawled} + 1`,
				status: sql`
        CASE
          WHEN ${crawlRuns.pagesCrawled} + 1 >= ${crawlRuns.maxPages}
            OR NOT EXISTS (
              SELECT 1 FROM crawl_jobs
              WHERE crawl_run_id = ${id}
                AND status = 'pending'
            )
          THEN 'completed'
          ELSE ${crawlRuns.status}
        END
      `,
			})
			.where(and(eq(crawlRuns.id, id), eq(crawlRuns.status, "running")))
			.returning({
				status: crawlRuns.status,
				crawlSettingId: crawlRuns.crawlSettingId,
				pagesCrawled: crawlRuns.pagesCrawled,
				maxPages: crawlRuns.maxPages,
			});

		if (result?.status === "completed") {
			if (result.pagesCrawled >= result.maxPages) {
				await log({
					level: "warn",
					source: "crawler",
					message: "Max pages reached",
					crawlRunId: id,
					metadata: {
						pagesCrawled: result.pagesCrawled,
						maxPages: result.maxPages,
					},
				});
			}

			await log({
				level: "info",
				source: "crawler",
				message: "Crawl run completed",
				crawlRunId: id,
				metadata: {
					pagesCrawled: result.pagesCrawled,
					maxPages: result.maxPages,
				},
			});

			await updateCrawlScheduleSuccess(result.crawlSettingId);
		}
	} catch (error) {
		await log({
			level: "error",
			source: "db",
			message: "Failed to update pages crawled count",
			metadata: { crawlRunId: id, error: error instanceof Error ? error.message : String(error) },
		});

		throw error;
	}
}

/**
 * - Looks up the pending recrawl jobs in progress matching a specific crawl setting ID
 * @param crawlSettingId - ID of the crawl settings configuration.
 * @returns An array of objects containing the “url” field for pending recrawl jobs.
 */
export async function getRecrawlJobs(crawlSettingId: string) {
	return await db
		.select({ url: crawlJobs.url })
		.from(crawlJobs)
		.where(
			and(
				eq(crawlJobs.jobType, "recrawl"),
				eq(crawlJobs.crawlSettingId, crawlSettingId),
				eq(crawlJobs.status, "pending"),
			),
		);
}
