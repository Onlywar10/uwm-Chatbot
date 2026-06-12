"use server";

import { db } from "../../db";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { crawlRuns } from "@/lib/db/schema/crawlRuns";
import { crawlJobs } from "@/lib/db/schema/crawlJobs";
import { log } from "../logger";
import type { RobotsRules } from "@/lib/types/crawl";

const robotsRulesSchema: z.ZodType<RobotsRules> = z.object({
	allow: z.array(z.string()),
	disallow: z.array(z.string()),
	crawlDelay: z.number(),
});

const insertCrawlRunSchema = z.object({
	domain: z.string().min(1),
	startUrl: z.string().min(1),
	entityType: z.enum(["district", "school"]),
	entityId: z.string().min(1),
	maxPages: z.number(),
	robots: robotsRulesSchema,
	crawlDelay: z.number(),
	crawlRunType: z.enum(["crawl", "recrawl"]),
	crawlSettingId: z.string().min(1),
	usedSitemap: z.boolean().default(false),
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

const updateCrawlStatusSchema = z.object({
	status: z.enum(["running", "completed", "failure"]),
	errorMessage: z.string().min(1),
});

export async function createCrawlRun(input: unknown) {
	try {
		const parsed = insertCrawlRunSchema.parse(input);

		const [crawlRun] = await db.insert(crawlRuns).values(parsed).returning({
			id: crawlRuns.id,
		});

		return {
			ok: true as const,
			crawlRunId: crawlRun.id,
		};
	} catch (error) {
		const errorMsg =
			error instanceof Error && error.message.length > 0
				? error.message
				: "Failed to create crawl run.";

		await log({
			level: "error",
			source: "db",
			message: "Failed to create crawl run",
			metadata: { error: errorMsg },
		});

		return {
			ok: false as const,
			error: errorMsg,
		};
	}
}

export async function updateCrawlRunError(id: string, input: unknown) {
	try {
		const parsed = updateCrawlStatusSchema.parse(input);

		await db.update(crawlRuns).set(parsed).where(eq(crawlRuns.id, id));
	} catch (error) {
		const errorMsg =
			error instanceof Error && error.message.length > 0
				? error.message
				: "Error in updating crawl run.";

		await log({
			level: "error",
			source: "db",
			message: "Failed to update crawl run error status",
			metadata: { crawlRunId: id, error: errorMsg },
		});

		throw error;
	}
}

export async function getActiveCrawlRun(entityId: string) {
	const [run] = await db
		.select({ id: crawlRuns.id })
		.from(crawlRuns)
		.innerJoin(crawlJobs, eq(crawlJobs.crawlRunId, crawlRuns.id))
		.where(and(eq(crawlRuns.entityId, entityId), eq(crawlJobs.status, "pending")))
		.limit(1);

	return run;
}

export async function getCrawlRunStatus(id: string) {
	const [pendingJobs] = await db
		.select({
			pagesCrawled: crawlRuns.pagesCrawled,
			pagesDiscovered: sql<number>`cast(count(${crawlJobs.id}) as integer)`,
			status: crawlRuns.status,
		})
		.from(crawlRuns)
		.leftJoin(crawlJobs, eq(crawlJobs.crawlRunId, crawlRuns.id))
		.where(eq(crawlRuns.id, id))
		.groupBy(crawlRuns.id, crawlRuns.pagesCrawled, crawlRuns.status);

	return pendingJobs;
}
