import { db } from "@/lib/db";
import { embeddings } from "@/lib/db/schema/embeddings";
import { MarkdownTextSplitter, RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { embed, embedMany } from "ai";
import { and, cosineDistance, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Metadata } from "../types/crawl";
import { nanoid } from "nanoid";
import { parentChunks } from "../db/schema/parentChunks";
import { bm25Search, buildMiniSearchIndex } from "./retrieval/bm25";
import { rankByKeyword } from "./keywordRanking";

const embeddingModel = "text-embedding-3-small";

const DEFAULT_SIMILARITY_THRESHOLD = 0.3;
const DEFAULT_LIMIT = 30;
const VECTOR_WEIGHT = 0.7;
const BM25_WEIGHT = 0.3;
const TOP_K = 10;

export type ParentChunk = {
	content: string;
	id: string;
};

export type ChildChunk = {
	content: string;
	parentId: string;
	metadata: Metadata;
};

function normalizeText(input: string) {
	return input.trim().replace(/\s+/g, " ");
}

function extractHeaders(content: string) {
	return [...content.matchAll(/^#{1,6}\s+(.+)$/gm)]
		.map((m) =>
			m[1]
				.trim()
				.replace(/\*\*/g, "")
				.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // strip markdown links → keep label only
				.trim(),
		)
		.filter(Boolean);
}

async function generateParentChildChunks(
	md: string,
	pageTitle: string,
	source_url: string,
	file_type: "html" | "pdf" | "doc",
	categories?: {
		topCategory: string;
		subCategory: string;
		pageCategory: string;
		fullPath: string;
	},
) {
	const parentSplitter = new MarkdownTextSplitter({
		chunkSize: 2000,
		chunkOverlap: 0,
		keepSeparator: true,
	});

	const childSplitter = new RecursiveCharacterTextSplitter({
		chunkSize: 700,
		chunkOverlap: 0,
		separators: ["\n\n", "\n", ". ", "? ", "! ", " ", ""],
		keepSeparator: true,
	});

	const parentSplits = await parentSplitter.splitText(md);

	const parentChunks: ParentChunk[] = [];
	const childChunks: ChildChunk[] = [];

	const { topCategory = "", subCategory = "", pageCategory = "", fullPath = "" } = categories ?? {};

	for (const split of parentSplits) {
		const parentId = nanoid();

		const headers = extractHeaders(split);
		const sectionHeaders = headers.length > 0 ? headers : [pageTitle ?? ""];

		const children = await childSplitter.splitText(split);
		const cleanedChildren = children
			.map((chunk) => chunk.replace(/^[.!?,;:\s]+/, "").trim())
			.filter((chunk) => chunk.trim().length > 100);

		parentChunks.push({ content: split, id: parentId });

		childChunks.push(
			...cleanedChildren.map((content) => ({
				content: content,
				parentId,
				metadata: {
					pageTitle: pageTitle ?? "",
					sectionHeaders: sectionHeaders.join(", "),
					topCategory,
					subCategory,
					pageCategory,
					fullPath,
					sourceUrl: source_url,
					fileType: file_type,
				},
			})),
		);
	}

	return { parentChunks, childChunks };
}

export async function generateChildEmbeddings(
	md: string,
	pageTitle: string,
	source_url: string,
	file_type: "html" | "pdf" | "doc",
	categories?: {
		topCategory: string;
		subCategory: string;
		pageCategory: string;
		fullPath: string;
	},
) {
	const { parentChunks, childChunks } = await generateParentChildChunks(
		md,
		pageTitle,
		source_url,
		file_type,
		categories,
	);

	const { embeddings } = await embedMany({
		model: embeddingModel,
		values: childChunks.map((c) => c.content),
	});

	const childEmbeddings = childChunks.map((chunk, i) => ({
		content: chunk.content,
		parentId: chunk.parentId,
		embeddings: embeddings[i],
		metadata: chunk.metadata,
	}));

	return { parentChunks, childEmbeddings };
}

async function generatePdfParentChildChunks(
	pages: string[],
	pdfName: string,
	pdfCreation: string,
	headings: string[],
	source_url: string,
) {
	const initialParentSplits: string[] = [];
	const childChunks: ChildChunk[] = [];
	const parentChunks: ParentChunk[] = [];

	const parentSplitter = new MarkdownTextSplitter({
		chunkSize: 2000,
		chunkOverlap: 0,
		keepSeparator: true,
	});

	const childSplitter = new RecursiveCharacterTextSplitter({
		chunkSize: 700,
		chunkOverlap: 100,
		separators: ["\n\n", "\n", ". ", "? ", "! ", " ", ""],
	});

	for (const [i, page] of pages.entries()) {
		let cleaned = page.replace(
			new RegExp(
				`(${headings.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
				"g",
			),
			"\n---\n$1",
		);

		if (i === 0) cleaned = [pdfCreation, cleaned].join("\n");

		const splits = await parentSplitter.splitText(cleaned);

		const cleanedSplits = splits
			.map((chunk) => chunk.replace(/^-{3}\s*\n?/gm, "").trim())
			.filter((chunk) => chunk.length > 100);

		initialParentSplits.push(...cleanedSplits);
	}

	for (const split of initialParentSplits) {
		const parentId = nanoid();

		const headers = headings.filter((heading) => split.includes(heading));

		const sectionHeaders = headers.length > 0 ? headers : [pdfName ?? ""];
		const cleanedSplit = split.replace(/^-{3}\s*\n?/gm, "").trim();

		const children = await childSplitter.splitText(cleanedSplit);
		const cleanedChildren = children
			.map((chunk) => chunk.replace(/^[.!?,;:\s]+/, "").trim())
			.filter((chunk) => chunk.trim().length > 50);

		parentChunks.push({ content: cleanedSplit, id: parentId });

		childChunks.push(
			...cleanedChildren.map((content) => ({
				content,
				parentId,
				metadata: {
					pageTitle: pdfName ?? "",
					sectionHeaders: sectionHeaders.join(", "),
					topCategory: "",
					subCategory: "",
					pageCategory: "",
					fullPath: "",
					sourceUrl: source_url,
					fileType: "pdf" as const,
				},
			})),
		);
	}

	return { parentChunks, childChunks };
}

export async function generatePdfChildEmbeddings(
	pages: string[],
	pdfName: string,
	pdfCreation: string,
	headings: string[],
	source_url: string,
) {
	const { parentChunks, childChunks } = await generatePdfParentChildChunks(
		pages,
		pdfName,
		pdfCreation,
		headings,
		source_url,
	);

	const { embeddings } = await embedMany({
		model: embeddingModel,
		values: childChunks.map((c) => c.content),
	});

	const childEmbeddings = childChunks.map((chunk, i) => ({
		content: chunk.content,
		parentId: chunk.parentId,
		embeddings: embeddings[i],
		metadata: chunk.metadata,
	}));

	return { parentChunks, childEmbeddings };
}

export async function generateEmbedding(value: string): Promise<number[]> {
	const input = normalizeText(value.replaceAll("\n", " "));
	const { embedding } = await embed({
		model: embeddingModel,
		value: input,
	});
	return embedding;
}

async function findRelevantContentBase(params: {
	userQuery: string;
	domain?: string;
	domains?: string[];
	threshold?: number;
	limit?: number;
}) {
	const threshold = params.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
	const limit = params.limit ?? DEFAULT_LIMIT;

	const userQueryEmbedded = await generateEmbedding(params.userQuery);

	const similarity = sql<number>`1 - (${cosineDistance(embeddings.embedding, userQueryEmbedded)})`;

	const domainFilter = params.domains?.length
		? inArray(embeddings.domain, params.domains)
		: params.domain
			? eq(embeddings.domain, params.domain)
			: undefined;

	const whereClause = domainFilter
		? and(domainFilter, gt(similarity, threshold))
		: gt(similarity, threshold);

	const candidates = await db
		.select({
			id: embeddings.id,
			name: parentChunks.content,
			similarity,
			sourceUrl: parentChunks.source_url,
			resourceId: parentChunks.resourceId,
			parentId: parentChunks.id,
			metadata: embeddings.metadata,
		})
		.from(embeddings)
		.innerJoin(parentChunks, eq(embeddings.parentId, parentChunks.id))
		.where(whereClause)
		.orderBy((t) => desc(t.similarity))
		.limit(limit);

	const index = buildMiniSearchIndex(candidates);
	const bm25Scores = bm25Search(index, params.userQuery);

	const secondCandidates = candidates
		.map((row) => {
			const bm25Score = bm25Scores.get(row.id) ?? 0;
			const finalScore = VECTOR_WEIGHT * row.similarity + BM25_WEIGHT * bm25Score;
			return { ...row, score: finalScore };
		})
		.sort((a, b) => b.score - a.score);

	const finalCandidates = rankByKeyword(secondCandidates, {
		query: params.userQuery,
		getFields: (row) => [
			row.metadata?.pageTitle,
			row.metadata?.sectionHeaders,
			row.metadata?.topCategory,
			row.metadata?.subCategory,
			row.metadata?.pageCategory,
		],
		tieBreaker: (a, b) => b.score - a.score,
	});

	return finalCandidates.slice(0, TOP_K);
}

export async function findRelevantContent(userQuery: string) {
	return findRelevantContentBase({ userQuery });
}

export async function findRelevantContentForDomain(domain: string, userQuery: string) {
	return findRelevantContentBase({ domain, userQuery });
}

// Multi-domain variant used by the embeddable widget, which can aggregate
// content across several domains configured for one widget.
export async function findRelevantContentForDomains(domains: string[], userQuery: string) {
	return findRelevantContentBase({ domains, userQuery });
}
