"use server";

import { db } from "@/lib/db";
import { crawlJobs } from "@/lib/db/schema/crawlJobs";
import { crawlSettings } from "@/lib/db/schema/crawlSettings";
import { and, eq, lt, sql } from "drizzle-orm";

import z from "zod";

const claimCrawlJobSchema = z.object({
	url: z.string().min(1),
	depth: z.number().min(0),
	crawlSettingId: z.string().min(1),
});

const updateCrawlJobErrorSchema = z.object({
	crawlJobId: z.string().min(1),
	errorMessage: z.string().min(1),
});

const updateCrawlJobSuccessSchema = z.object({
	crawlJobId: z.string().min(1),
	fileType: z.enum(["html", "pdf", "doc", "api"]),
	resourceId: z.string().min(1),
	time: z.number(),
});

export async function claimCrawlJob(input: unknown) {
	try {
		const parsed = claimCrawlJobSchema.parse(input);

		const result = await db.transaction(async (tx) => {
			const [crawlJob] = await tx
				.insert(crawlJobs)
				.values({
					url: parsed.url,
					depth: parsed.depth,
					crawlSettingId: parsed.crawlSettingId,
				})
				.onConflictDoNothing({ target: [crawlJobs.url, crawlJobs.crawlSettingId] })
				.returning({ id: crawlJobs.id });

			if (!crawlJob) throw new Error("duplicate");

			const [pages] = await tx
				.update(crawlSettings)
				.set({ pagesProcessed: sql`${crawlSettings.pagesProcessed} + 1` })
				.where(
					and(
						eq(crawlSettings.id, parsed.crawlSettingId),
						lt(crawlSettings.pagesProcessed, crawlSettings.maxCrawlPages),
					),
				)
				.returning({ pagesProcessed: crawlSettings.pagesProcessed });

			if (!pages) throw new Error("max_pages");

			return {
				ok: true as const,
				id: crawlJob.id,
			};
		});

		return result;
	} catch (error) {
		return {
			ok: false as const,
			reason: error instanceof Error && error.message.length > 0 ? error.message : "unknown_error",
		};
	}
}

export async function updateCrawlJobError(input: unknown) {
	const parsed = updateCrawlJobErrorSchema.parse(input);

	await db
		.update(crawlJobs)
		.set({ errorMessage: parsed.errorMessage, status: "failure" })
		.where(eq(crawlJobs.id, parsed.crawlJobId));

	return { ok: true as const };
}

export async function updateCrawlJobSuccess(input: unknown) {
	const parsed = updateCrawlJobSuccessSchema.parse(input);

	await db
		.update(crawlJobs)
		.set({
			fileType: parsed.fileType,
			status: "success",
			time: parsed.time.toString(),
			resourceId: parsed.resourceId,
		})
		.where(eq(crawlJobs.id, parsed.crawlJobId));

	return { ok: true as const };
}
