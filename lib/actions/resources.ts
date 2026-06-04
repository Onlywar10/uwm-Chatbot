"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { generateChildEmbeddings, generatePdfChildEmbeddings } from "@/lib/ai/embedding";
import { canonicalizeUrlString } from "@/lib/ai/url";
import { db } from "@/lib/db";
import { embeddings as embeddingsTable } from "@/lib/db/schema/embeddings";
import { resources } from "@/lib/db/schema/resources";
import { parentChunks } from "@/lib/db/schema/parentChunks";

const upsertResourceInputSchema = z.object({
	domain: z.string().min(1),
	url: z.string().min(1),
	entityId: z.string().min(1),
	content: z.string().min(1),
	crawlSettingId: z.string().min(1),
	pageTitle: z.string(),
	file_type: z.enum(["html", "pdf", "doc"]),
	categories: z
		.object({
			topCategory: z.string(),
			subCategory: z.string(),
			pageCategory: z.string(),
			fullPath: z.string(),
		})
		.optional(),
});

const upsertPdfResourceInputSchema = z.object({
	domain: z.string().min(1),
	url: z.string().min(1),
	entityId: z.string().min(1),
	crawlSettingId: z.string().min(1),
	pdfName: z.string().min(1),
	content: z.string().min(1),
	pages: z.string().array(),
	pdfCreation: z.string().min(1),
	headings: z.string().array(),
});

function hashContent(content: string) {
	const normalized = content.trim().replace(/\s+/g, " ");
	return createHash("sha256").update(normalized).digest("hex");
}

export const upsertResource = async (input: unknown) => {
	try {
		let resourceId: string = "";
		let skipped: boolean = false;

		const { domain, content, crawlSettingId, entityId, url, pageTitle, file_type, categories } =
			upsertResourceInputSchema.parse(input);

		const cleanedUrl = canonicalizeUrlString(url, { dropAllQuery: false });
		const contentHash = hashContent(content);

		const [resource] = await db
			.select({ id: resources.id, contentHash: resources.contentHash })
			.from(resources)
			.where(and(eq(resources.domain, domain), eq(resources.url, cleanedUrl)));

		if (!resource) {
			resourceId = nanoid();
		} else if (resource.contentHash === contentHash) {
			resourceId = resource.id;
			skipped = true;
		} else {
			resourceId = resource.id;
		}

		if (skipped) {
			return {
				ok: true as const,
				resourceId,
				embeddedChunks: 0,
				skipped,
				canonicalUrl: url,
			};
		} else {
			const result = await generateChildEmbeddings(
				content,
				pageTitle,
				cleanedUrl,
				file_type,
				categories,
			);

			const parents = result.parentChunks.map((chunk) => ({
				id: chunk.id,
				source_url: cleanedUrl,
				content: chunk.content,
				resourceId,
			}));

			const embeddings = result.childEmbeddings.map((e) => ({
				domain,
				content: e.content,
				metadata: e.metadata,
				embedding: e.embeddings,
				parentId: e.parentId,
				resourceId,
			}));

			const insertResourceQuery = db.insert(resources).values({
				id: resourceId,
				domain,
				url: cleanedUrl,
				entityId,
				content,
				contentHash,
				crawlSettingId,
			});

			const updateResourceQuery = db
				.update(resources)
				.set({ content, contentHash })
				.where(eq(resources.id, resourceId));

			const deleteParentChunksQuery = db
				.delete(parentChunks)
				.where(eq(parentChunks.resourceId, resourceId));

			const insertParentChunksQuery = db.insert(parentChunks).values(parents);

			const deleteEmbeddingsQuery = db
				.delete(embeddingsTable)
				.where(and(eq(embeddingsTable.resourceId, resourceId), eq(embeddingsTable.domain, domain)));

			const insertChildEmbeddingsQuery = db.insert(embeddingsTable).values(embeddings);

			await db.batch([
				resource ? updateResourceQuery : insertResourceQuery,
				deleteParentChunksQuery,
				deleteEmbeddingsQuery,
				insertParentChunksQuery,
				insertChildEmbeddingsQuery,
			]);

			return {
				ok: true as const,
				resourceId,
				embeddedChunks: embeddings.length,
				skipped,
				canonicalUrl: url,
			};
		}
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

export const upsertPdfResource = async (input: unknown) => {
	try {
		let resourceId: string = "";
		let skipped: boolean = false;

		const {
			domain,
			crawlSettingId,
			entityId,
			url,
			pdfName,
			content,
			pages,
			pdfCreation,
			headings,
		} = upsertPdfResourceInputSchema.parse(input);

		const cleanedUrl = canonicalizeUrlString(url, { dropAllQuery: false });
		const contentHash = hashContent(content);

		const [resource] = await db
			.select({ id: resources.id, contentHash: resources.contentHash })
			.from(resources)
			.where(and(eq(resources.domain, domain), eq(resources.url, cleanedUrl)));

		if (!resource) {
			resourceId = nanoid();
		} else if (resource.contentHash === contentHash) {
			resourceId = resource.id;
			skipped = true;
		} else {
			resourceId = resource.id;
		}

		if (skipped) {
			return {
				ok: true as const,
				resourceId,
				embeddedChunks: 0,
				skipped,
				canonicalUrl: url,
			};
		} else {
			const result = await generatePdfChildEmbeddings(
				pages,
				pdfName,
				pdfCreation,
				headings,
				cleanedUrl,
			);

			const parents = result.parentChunks.map((chunk) => ({
				id: chunk.id,
				source_url: cleanedUrl,
				content: chunk.content,
				resourceId,
			}));

			const embeddings = result.childEmbeddings.map((e) => ({
				domain,
				content: e.content,
				metadata: e.metadata,
				embedding: e.embeddings,
				parentId: e.parentId,
				resourceId,
			}));

			const insertResourceQuery = db.insert(resources).values({
				id: resourceId,
				domain,
				url: cleanedUrl,
				entityId,
				content,
				contentHash,
				crawlSettingId,
			});

			const updateResourceQuery = db
				.update(resources)
				.set({ content, contentHash })
				.where(eq(resources.id, resourceId));

			const deleteParentChunksQuery = db
				.delete(parentChunks)
				.where(eq(parentChunks.resourceId, resourceId));

			const insertParentChunksQuery = db.insert(parentChunks).values(parents);

			const deleteEmbeddingsQuery = db
				.delete(embeddingsTable)
				.where(and(eq(embeddingsTable.resourceId, resourceId), eq(embeddingsTable.domain, domain)));

			const insertChildEmbeddingsQuery = db.insert(embeddingsTable).values(embeddings);

			await db.batch([
				resource ? updateResourceQuery : insertResourceQuery,
				deleteParentChunksQuery,
				deleteEmbeddingsQuery,
				insertParentChunksQuery,
				insertChildEmbeddingsQuery,
			]);

			return {
				ok: true as const,
				resourceId,
				embeddedChunks: embeddings.length,
				skipped,
				canonicalUrl: url,
			};
		}
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
