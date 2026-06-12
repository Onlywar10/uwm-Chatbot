"use server";

import { crawlSettings } from "../../db/schema/crawlSettings";
import { db } from "../../db";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDomain } from "@/lib/ai/url";

const upsertCrawlSettingsInputSchema = z.object({
	domain: z.string().min(1),
	maxCrawlDepth: z.number().min(0),
	maxCrawlPages: z.number().min(1),
	maxCharsPerPage: z.number().min(1000),
	useSitemaps: z.boolean(),
	ignoreRobots: z.boolean(),
	dropAllQuery: z.boolean(),
	renderJavascript: z.boolean(),
	crawlAllPages: z.boolean(),
	urlsToIgnore: z.string().array(),
	entityType: z.enum(["district", "school"]),
	entityId: z.string().min(1),
});

export const upsertCrawlSettings = async (input: unknown) => {
	try {
		const parsed = upsertCrawlSettingsInputSchema.parse(input);

		const [crawlSetting] = await db
			.insert(crawlSettings)
			.values(parsed)
			.onConflictDoUpdate({
				target: crawlSettings.domain,
				set: {
					maxCrawlDepth: parsed.maxCrawlDepth,
					maxCrawlPages: parsed.maxCrawlPages,
					maxCharsPerPage: parsed.maxCharsPerPage,
					useSitemaps: parsed.useSitemaps,
					ignoreRobots: parsed.ignoreRobots,
					dropAllQuery: parsed.dropAllQuery,
					renderJavascript: parsed.renderJavascript,
					crawlAllPages: parsed.crawlAllPages,
					urlsToIgnore: parsed.urlsToIgnore,
					entityType: parsed.entityType,
					entityId: parsed.entityId,
				},
			})
			.returning({ id: crawlSettings.id });

		return {
			ok: true as const,
			id: crawlSetting.id,
		};
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof Error && error.message.length > 0
					? error.message
					: "Error, please try again.",
		};
	}
};

export async function updateCrawlSettingsDomain(id: string, url: string) {
	await db
		.update(crawlSettings)
		.set({ domain: getDomain(url) })
		.where(eq(crawlSettings.entityId, id));
}

export async function getCrawlSettings(id: string) {
	const [settings] = await db.select().from(crawlSettings).where(eq(crawlSettings.id, id));

	return settings;
}
