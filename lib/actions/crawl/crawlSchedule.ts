"use server";

import { db } from "../../db";
import { z } from "zod";
import { and, eq, lte, ne, sql } from "drizzle-orm";

import { crawlSettings } from "@/lib/db/schema/crawlSettings";
import { crawlSchedule } from "@/lib/db/schema/crawlSchedule";

import { startScheduledCrawl } from "./start";
import { log } from "../logger";

const updateCrawlScheduleStateSchema = z.object({
	status: z.enum(["success", "failure", "pending"]).optional(),
	errorMessage: z.string().min(1).optional(),
	lastCrawlMethod: z.enum(["automatic", "manual"]).optional(),
});

export async function searchAndStartDueCrawls() {
	await log({ level: "info", source: "scheduler", message: "Checking for due crawl schedules" });

	try {
		const due = await db
			.select({
				url: crawlSchedule.url,
				entityId: crawlSettings.entityId,
				entityType: crawlSettings.entityType,
				crawlSettingId: crawlSettings.id,
			})
			.from(crawlSchedule)
			.innerJoin(crawlSettings, eq(crawlSchedule.crawlSettingId, crawlSettings.id))
			.where(and(lte(crawlSchedule.nextCrawlAt, new Date()), ne(crawlSchedule.status, "pending")));

		if (due.length <= 0) {
			await log({
				level: "info",
				source: "scheduler",
				message: "No due crawl schedules found",
			});

			return {
				total: due.length,
				succeeded: 0,
				failed: 0,
			};
		}

		await log({
			level: "info",
			source: "scheduler",
			message: `${due.length} due crawls found, starting...`,
			metadata: { count: due.length },
		});

		const results = await Promise.allSettled(
			due.map(({ url, entityId, entityType, crawlSettingId }) =>
				startScheduledCrawl(url, entityType, entityId, crawlSettingId),
			),
		);

		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			const { crawlSettingId } = due[i];

			if (result.status === "rejected") {
				const error =
					result.reason instanceof Error
						? result.reason.message
						: "Unknown crawl API network error.";

				await log({
					level: "error",
					source: "scheduler",
					message: "Scheduled crawl threw unexpectedly",
					metadata: { crawlSettingId, error },
				});

				await updateCrawlScheduleState(crawlSettingId, {
					status: "failure",
					errorMessage: error,
				});
			} else if (!result.value.ok) {
				await log({
					level: "error",
					source: "scheduler",
					message: "Scheduled crawl failed",
					metadata: { crawlSettingId, error: result.value.error },
				});

				await updateCrawlScheduleState(crawlSettingId, {
					status: "failure",
					errorMessage: result.value.error,
				});
			}
		}

		const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
		const failed = results.filter(
			(r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
		).length;

		await log({
			level: "info",
			source: "scheduler",
			message: "Crawl schedule run complete",
			metadata: { total: due.length, succeeded, failed },
		});

		return {
			total: due.length,
			succeeded,
			failed,
		};
	} catch (error) {
		await log({
			level: "error",
			source: "scheduler",
			message: "Failed to query due crawl schedules",
			metadata: { error: error instanceof Error ? error.message : String(error) },
		});

		return { error: error instanceof Error ? error.message : String(error) };
	}
}

export async function updateCrawlScheduleState(crawlSettingId: string, input: unknown) {
	try {
		const parsed = updateCrawlScheduleStateSchema.parse(input);

		if (Object.keys(parsed).length === 0) throw new Error("Empty state to update.");

		await db
			.update(crawlSchedule)
			.set(parsed)
			.where(eq(crawlSchedule.crawlSettingId, crawlSettingId));

		return { ok: true as const };
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof Error && error.message.length > 0
					? error.message
					: "Error updating crawl schedule state.",
		};
	}
}

export async function updateCrawlScheduleSuccess(crawlSettingId: string) {
	await db.transaction(async (tx) => {
		await tx
			.update(crawlSchedule)
			.set({
				status: "success",
			})
			.where(eq(crawlSchedule.crawlSettingId, crawlSettingId));

		await tx
			.update(crawlSchedule)
			.set({
				lastCrawlAt: sql`now()`,
				nextCrawlAt: sql`now() + (${crawlSchedule.interval} * interval '1 hour')`,
			})
			.where(
				and(
					eq(crawlSchedule.crawlSettingId, crawlSettingId),
					eq(crawlSchedule.lastCrawlMethod, "automatic"),
				),
			);
	});
}
