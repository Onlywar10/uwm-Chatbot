"use server";

import { generateEmbeddings } from "@/lib/ai/embedding";
import { canonicalizeUrlString } from "@/lib/ai/url";
import { db } from "@/lib/db";
import { embeddings as embeddingsTable } from "@/lib/db/schema/embeddings";
import { resources } from "@/lib/db/schema/resources";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";

const upsertResourceInputSchema = z.object({
	domain: z.string().min(1),
	url: z.url(),
	content: z.string().min(1),
	crawlSettingId: z.string().min(1),
	schoolId: z.string().min(1),
});

function hashContent(content: string) {
	const normalized = content.trim().replace(/\s+/g, " ");
	return createHash("sha256").update(normalized).digest("hex");
}

export const upsertResource = async (input: unknown) => {
	try {
		const parsed = upsertResourceInputSchema.parse(input);

		const url = canonicalizeUrlString(parsed.url, { dropAllQuery: false });
		const contentHash = hashContent(parsed.content);

		return await db.transaction(async (tx) => {
			const existing = await tx
				.select({
					id: resources.id,
					contentHash: resources.contentHash,
				})
				.from(resources)
				.where(and(eq(resources.domain, parsed.domain), eq(resources.url, url)))
				.limit(1);

			if (existing[0]?.contentHash === contentHash) {
				return {
					ok: true as const,
					resourceId: existing[0].id,
					embeddedChunks: 0,
					skipped: true,
					canonicalUrl: url,
				};
			}

			const [resource] = await tx
				.insert(resources)
				.values({
					domain: parsed.domain,
					url,
					content: parsed.content,
					contentHash,
					crawlSettingId: parsed.crawlSettingId,
					schoolId: parsed.schoolId,
				})
				.onConflictDoUpdate({
					target: [resources.domain, resources.url],
					set: {
						content: parsed.content,
						contentHash,
					},
				})
				.returning();

			const vectors = await generateEmbeddings(parsed.content);

			await tx
				.delete(embeddingsTable)
				.where(
					and(
						eq(embeddingsTable.resourceId, resource.id),
						eq(embeddingsTable.domain, parsed.domain),
					),
				);

			if (vectors.length > 0) {
				await tx.insert(embeddingsTable).values(
					vectors.map((v) => ({
						resourceId: resource.id,
						domain: parsed.domain,
						content: v.content,
						embedding: v.embedding,
					})),
				);
			}

			return {
				ok: true as const,
				resourceId: resource.id,
				embeddedChunks: vectors.length,
				skipped: false,
				canonicalUrl: url,
			};
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
