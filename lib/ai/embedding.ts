import { db } from "@/lib/db";
import { embeddings } from "@/lib/db/schema/embeddings";
import { embed, embedMany } from "ai";
import { and, cosineDistance, desc, eq, gt, inArray, sql } from "drizzle-orm";

const embeddingModel = "openai/text-embedding-3-small";

const DEFAULT_SIMILARITY_THRESHOLD = 0.3;
const DEFAULT_LIMIT = 4;

const MAX_CHARS_PER_CHUNK = 900;
const MIN_CHARS_PER_CHUNK = 40;
const CHUNK_OVERLAP_CHARS = 120;

function normalizeText(input: string) {
	return input.trim().replace(/\s+/g, " ");
}

function generateChunks(input: string): string[] {
	const cleaned = normalizeText(input);
	if (!cleaned) return [];

	const parts = cleaned.split(/(?<=[.!?])\s+/);

	const chunks: string[] = [];
	let currentChunk = "";

	const flushCurrentChunk = () => {
		const out = currentChunk.trim();
		currentChunk = "";
		if (out.length >= MIN_CHARS_PER_CHUNK) chunks.push(out);
	};

	for (const part of parts) {
		const next = currentChunk ? `${currentChunk} ${part}` : part;

		if (next.length > MAX_CHARS_PER_CHUNK) {
			if (currentChunk) flushCurrentChunk();

			if (part.length > MAX_CHARS_PER_CHUNK) {
				let start = 0;
				while (start < part.length) {
					const end = Math.min(start + MAX_CHARS_PER_CHUNK, part.length);
					const slice = part.slice(start, end).trim();
					if (slice.length >= MIN_CHARS_PER_CHUNK) chunks.push(slice);
					start = end - CHUNK_OVERLAP_CHARS;
					if (start < 0) start = 0;
				}
				currentChunk = "";
			} else {
				currentChunk = part;
			}
		} else {
			currentChunk = next;
		}
	}

	if (currentChunk) flushCurrentChunk();

	if (CHUNK_OVERLAP_CHARS > 0 && chunks.length > 1) {
		const overlapped: string[] = [];
		for (let i = 0; i < chunks.length; i++) {
			const current = chunks[i];
			if (i === 0) {
				overlapped.push(current);
				continue;
			}
			const prev = overlapped[overlapped.length - 1]!;
			const overlap = prev.slice(Math.max(0, prev.length - CHUNK_OVERLAP_CHARS));
			const merged = `${overlap} ${current}`.trim();
			overlapped.push(merged.length <= MAX_CHARS_PER_CHUNK ? merged : current);
		}
		return overlapped;
	}

	return chunks;
}

export type EmbeddedChunk = { embedding: number[]; content: string };

export async function generateEmbeddings(value: string): Promise<EmbeddedChunk[]> {
	const chunks = generateChunks(value);
	if (chunks.length === 0) return [];

	const { embeddings: vectors } = await embedMany({
		model: embeddingModel,
		values: chunks,
	});

	return vectors.map((e, i) => ({ content: chunks[i]!, embedding: e }));
}

export async function generateEmbeddingsForBlocks(blocks: string[]): Promise<EmbeddedChunk[]> {
	const cleaned = blocks.map(normalizeText).filter(Boolean);
	if (cleaned.length === 0) return [];

	const { embeddings: vectors } = await embedMany({
		model: embeddingModel,
		values: cleaned,
	});

	return vectors.map((e, i) => ({ content: cleaned[i]!, embedding: e }));
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

	let whereClause;
	if (params.domains && params.domains.length > 0) {
		whereClause = and(inArray(embeddings.domain, params.domains), gt(similarity, threshold));
	} else if (params.domain) {
		whereClause = and(eq(embeddings.domain, params.domain), gt(similarity, threshold));
	} else {
		whereClause = gt(similarity, threshold);
	}

	return db
		.select({ name: embeddings.content, similarity })
		.from(embeddings)
		.where(whereClause)
		.orderBy((t) => desc(t.similarity))
		.limit(limit);
}

export async function findRelevantContent(userQuery: string) {
	return findRelevantContentBase({ userQuery });
}

export async function findRelevantContentForDomain(domain: string, userQuery: string) {
	return findRelevantContentBase({ domain, userQuery });
}

export async function findRelevantContentForDomains(domains: string[], userQuery: string) {
	return findRelevantContentBase({ domains, userQuery });
}
