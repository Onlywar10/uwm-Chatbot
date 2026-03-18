import { crawlSettings } from "../../db/schema/crawlSettings";
import { db } from "../../db";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

const upsertCrawlSettingsInputSchema = z.object({
	domain: z.string().min(1),
	maxCrawlDepth: z.number(),
	maxCrawlPages: z.number(),
	maxCharsPerPage: z.number(),
	useSitemaps: z.boolean(),
	ignoreRobots: z.boolean(),
	dropAllQuery: z.boolean(),
	urlsToIgnore: z.string().array(),
	schoolId: z.string().min(1),
});

export const upsertCrawlSettings = async (input: unknown, updateCrawlSetting: boolean) => {
	try {
		const parsed = upsertCrawlSettingsInputSchema.parse(input);

		return await db.transaction(async (tx) => {
			if (updateCrawlSetting) {
				const [crawlSetting] = await tx
					.insert(crawlSettings)
					.values(parsed)
					.onConflictDoUpdate({
						target: crawlSettings.domain,
						set: parsed,
					})
					.returning({ id: crawlSettings.id });

				return {
					ok: true as const,
					crawlSettingId: crawlSetting.id,
				};
			} else {
				const crawlSettingId = await tx
					.select({
						id: crawlSettings.id,
					})
					.from(crawlSettings)
					.where(eq(crawlSettings.domain, parsed.domain));

				return {
					ok: true as const,
					crawlSettingId: crawlSettingId[0].id,
				};
			}
		});
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

export const updateCalendarProcessed = async (crawlSettingId: string) => {
	const [processed] = await db
		.update(crawlSettings)
		.set({ calenderProcessed: true })
		.where(and(eq(crawlSettings.calenderProcessed, false), eq(crawlSettings.id, crawlSettingId)))
		.returning({ processed: crawlSettings.calenderProcessed });

	return processed;
};
