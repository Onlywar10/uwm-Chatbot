"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resources } from "@/lib/db/schema/resources";
import { crawlRuns } from "@/lib/db/schema/crawlRuns";
import { requireRole } from "@/lib/auth/guards";

/**
 * Deletes the data a crawl produces for an entity — resources (cascading to
 * embeddings + parent chunks) and crawl runs (cascading to crawl jobs) — while
 * keeping the crawl_settings and crawl_schedule rows intact. Lets you re-crawl
 * from a clean slate without losing configuration (e.g. the Render JavaScript
 * toggle). Contrast with resetDistrict, which also drops the settings row.
 */
export async function clearCrawlData(entityId: string) {
	try {
		await requireRole("admin");

		const deleteResourcesQuery = db.delete(resources).where(eq(resources.entityId, entityId));
		const deleteCrawlRunsQuery = db.delete(crawlRuns).where(eq(crawlRuns.entityId, entityId));

		await db.batch([deleteResourcesQuery, deleteCrawlRunsQuery]);

		return { ok: true as const };
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof Error && error.message.length > 0
					? error.message
					: "Error clearing crawl data.",
		};
	}
}
