import MiniSearch from "minisearch";
import { rankByKeyword } from "@/lib/ai/keywordRanking";
import { db } from "@/lib/db";
import {
	type DirectoryAddress,
	type DirectoryHours,
	type DirectoryPhone,
	directoryPrograms,
} from "@/lib/db/schema/directoryPrograms";
import { and, arrayOverlaps, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { embedNeed } from "./embedding";
import { resolveUserLocation } from "./region";

// Retrieval tuning. Same hybrid shape as site RAG (lib/ai/embedding.ts):
// vector-first candidate pool, BM25 blend, keyword pass on top.
const CANDIDATE_LIMIT = 40;
const SIMILARITY_FLOOR = 0.22;
const VECTOR_WEIGHT = 0.7;
// BM25 rewards exact vocabulary ("CalFresh", "food pantry") but gets noisy on
// long conversational phrases, where fuzzy term hits can leapfrog the vector
// ranking — so its weight drops for multi-word needs.
const BM25_WEIGHT_SHORT = 0.3;
const BM25_WEIGHT_LONG = 0.12;
// Below this top vector similarity the results are noise — say so instead.
// Thin-but-real verticals (rent help) sit around 0.35; gibberish dies at the
// similarity floor before ever reaching this gate.
const MIN_TOP_SIMILARITY = 0.32;
// A card = one shown match; capped in the tool, not the prompt, so display
// stays deterministic (locked design decision).
const PAGE_SIZE = 3;
// The site being IN the user's city beats merely covering it, which beats
// county-wide coverage. Sized to break ties, not to override relevance.
const BOOST_SITE_IN_CITY = 0.1;
const BOOST_COVERS_CITY = 0.05;
const BOOST_COVERS_COUNTY = 0.015;

export type DirectorySearchParams = {
	need: string;
	city?: string;
	zip?: string;
	county?: string;
	/** Optional exact-vocabulary nudge, matched against AIRS taxonomy names. */
	taxonomyContains?: string;
	/** Paging for "show more" — 0-based row offset into the ranked list. */
	offset?: number;
};

export type DirectoryMatch = {
	id: string;
	programName: string;
	agencyName: string | null;
	siteName: string | null;
	description: string | null;
	coverageDisplay: string | null;
	eligibility: string | null;
	languages: string | null;
	fees: string | null;
	applicationProcess: string | null;
	requiredDocumentation: string | null;
	hours: DirectoryHours | null;
	phones: DirectoryPhone[];
	website: string | null;
	address: DirectoryAddress | null;
	addressIsPrivate: boolean;
	lastVerifiedOn: string | null;
	/** Other locations of the same program that also matched the search. */
	otherLocations: number;
};

export type DirectorySearchResult = {
	matches: DirectoryMatch[];
	totalMatches: number;
	moreCount: number;
	offset: number;
	/**
	 * When no city/zip was given and matches span several cities, the model can
	 * use this to ask a targeted location question instead of a scripted one.
	 */
	citiesRepresented: string[];
	noGoodMatch: boolean;
	locationNote: string | null;
};

type Candidate = {
	id: string;
	programId: number;
	similarity: number;
	score: number;
	row: typeof directoryPrograms.$inferSelect;
};

function locationBoost(
	row: typeof directoryPrograms.$inferSelect,
	city: string | null,
	county: string | null,
): number {
	if (city && row.city === city) return BOOST_SITE_IN_CITY;
	if (city && row.serviceAreas.includes(`city:${city}`)) return BOOST_COVERS_CITY;
	if (county && row.serviceAreas.includes(`county:${county}`)) return BOOST_COVERS_COUNTY;
	return 0;
}

function bm25Scores(candidates: Candidate[], query: string): Map<string, number> {
	const mini = new MiniSearch({
		idField: "id",
		fields: ["programName", "taxonomyNames", "agencyName", "description"],
		storeFields: ["id"],
		extractField: (doc: Candidate, field: string) => {
			if (field === "id") return doc.id;
			if (field === "taxonomyNames") return doc.row.taxonomyNames.join(", ");
			return (doc.row as Record<string, unknown>)[field] as string;
		},
	});
	mini.addAll(candidates);
	const results = mini.search(query, {
		boost: { programName: 3, taxonomyNames: 2.5, agencyName: 1.5, description: 1 },
		fuzzy: 0.1,
		prefix: true,
	});
	const max = results[0]?.score ?? 1;
	return new Map(results.map((r) => [r.id as string, r.score / max]));
}

function toMatch(candidate: Candidate, otherLocations: number): DirectoryMatch {
	const r = candidate.row;
	return {
		id: r.id,
		programName: r.programName,
		agencyName: r.agencyName,
		siteName: r.siteName,
		description: r.description ? r.description.slice(0, 400) : null,
		coverageDisplay: r.coverageDisplay,
		eligibility: r.eligibility ? r.eligibility.slice(0, 300) : null,
		languages: r.languages,
		fees: r.fees ? r.fees.slice(0, 200) : null,
		applicationProcess: r.applicationProcess ? r.applicationProcess.slice(0, 300) : null,
		requiredDocumentation: r.requiredDocumentation ? r.requiredDocumentation.slice(0, 300) : null,
		hours: r.hours ?? null,
		phones: r.phones,
		website: r.website,
		address: r.address ?? null,
		addressIsPrivate: r.addressIsPrivate,
		lastVerifiedOn: r.lastVerifiedOn ? r.lastVerifiedOn.toISOString().slice(0, 10) : null,
		otherLocations,
	};
}

/**
 * Hybrid search over the mirrored 211 directory.
 *
 * One SQL query combines the service-area prefilter with pgvector cosine
 * similarity; the candidate pool is then rescored with BM25, keyword-ranked
 * (exact program-name/taxonomy hits float), tier-boosted by coverage
 * closeness, and deduped to one row per program (best row wins, siblings
 * counted in otherLocations).
 */
export async function searchDirectory(
	params: DirectorySearchParams,
): Promise<DirectorySearchResult> {
	const location = resolveUserLocation(params);
	const offset = Math.max(0, params.offset ?? 0);

	const needVector = await embedNeed(params.need);
	const similarity = sql<number>`1 - (${cosineDistance(directoryPrograms.embedding, needVector)})`;

	const filters = [
		arrayOverlaps(directoryPrograms.serviceAreas, location.tokens),
		gt(similarity, SIMILARITY_FLOOR),
	];
	if (params.taxonomyContains) {
		filters.push(
			sql`EXISTS (SELECT 1 FROM unnest(${directoryPrograms.taxonomyNames}) AS t(name) WHERE t.name ILIKE ${`%${params.taxonomyContains}%`})`,
		);
	}

	const rows = await db
		.select({ row: directoryPrograms, similarity })
		.from(directoryPrograms)
		.where(and(...filters))
		.orderBy(desc(similarity))
		.limit(CANDIDATE_LIMIT);

	let candidates: Candidate[] = rows.map(({ row, similarity: sim }) => ({
		id: row.id,
		programId: row.programId,
		similarity: sim,
		score: sim,
		row,
	}));

	const noGoodMatch = candidates.length === 0 || candidates[0].similarity < MIN_TOP_SIMILARITY;
	if (noGoodMatch) {
		return {
			matches: [],
			totalMatches: 0,
			moreCount: 0,
			offset,
			citiesRepresented: [],
			noGoodMatch: true,
			locationNote: location.note,
		};
	}

	const bm25 = bm25Scores(candidates, params.need);
	const bm25Weight =
		params.need.trim().split(/\s+/).length <= 4 ? BM25_WEIGHT_SHORT : BM25_WEIGHT_LONG;
	for (const c of candidates) {
		c.score =
			VECTOR_WEIGHT * c.similarity +
			bm25Weight * (bm25.get(c.id) ?? 0) +
			locationBoost(c.row, location.city, location.county);
	}
	candidates.sort((a, b) => b.score - a.score);
	candidates = rankByKeyword(candidates, {
		query: params.need,
		getFields: (c) => [c.row.programName, c.row.agencyName, ...c.row.taxonomyNames],
		tieBreaker: (a, b) => b.score - a.score,
	});

	// One result per program: the best-ranked row represents it, siblings only
	// bump its otherLocations count.
	const byProgram = new Map<number, { best: Candidate; others: number }>();
	for (const c of candidates) {
		const entry = byProgram.get(c.programId);
		if (entry) entry.others += 1;
		else byProgram.set(c.programId, { best: c, others: 0 });
	}
	const deduped = [...byProgram.values()];

	const page = deduped.slice(offset, offset + PAGE_SIZE);
	const citiesRepresented =
		location.city === null
			? [
					...new Set(
						deduped
							.map(({ best }) => best.row.address?.city)
							.filter((c): c is string => Boolean(c)),
					),
				].slice(0, 8)
			: [];

	return {
		matches: page.map(({ best, others }) => toMatch(best, others)),
		totalMatches: deduped.length,
		moreCount: Math.max(0, deduped.length - offset - PAGE_SIZE),
		offset,
		citiesRepresented,
		noGoodMatch: false,
		locationNote: location.note,
	};
}

/** Full detail for one directory row, for follow-up questions by id. */
export async function getDirectoryProgram(id: string) {
	const [row] = await db
		.select()
		.from(directoryPrograms)
		.where(eq(directoryPrograms.id, id))
		.limit(1);
	if (!row) return null;
	const { embedding, embeddingText, contentHash, ...rest } = row;
	return rest;
}
