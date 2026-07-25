import MiniSearch from "minisearch";
import { db } from "@/lib/db";
import {
	type DirectoryAddress,
	type DirectoryHours,
	type DirectoryPhone,
	directoryPrograms,
} from "@/lib/db/schema/directoryPrograms";
import { and, arrayOverlaps, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { embedNeed } from "./embedding";
import { isRegionalCity, resolveUserLocation } from "./region";

/*
 * Retrieval tuning.
 *
 * The scoring here works on NORMALIZED similarity, not raw cosine. Raw cosine
 * between a short conversational need and a ~700-char program blob sits in a narrow
 * band (empirically ~0.25-0.52, often only 0.04 apart across the top ten). The
 * previous version blended raw cosine with absolute BM25 and location constants,
 * which made the tie-breakers 3-5x larger than the signal they were breaking ties
 * on: "Game Night for Kids" outranked "Clothing Closet" for "free clothes for my
 * kids" purely on the token "kids" plus a same-city bonus. Normalizing the pool to
 * 0..1 first puts relevance and the bonuses on comparable scales.
 */

// Candidate PROGRAMS (not rows) pulled for rescoring. Dedup happens in SQL, so a
// program with 17 sites no longer eats 17 slots — the old row-level cap of 40 was
// discarding 200+ eligible programs on common queries before ranking ever ran.
const CANDIDATE_PROGRAMS = 150;
// Raw-cosine cutoff for entering the pool at all. Deliberately permissive; ranking,
// not this floor, decides what surfaces.
const SIMILARITY_FLOOR = 0.2;
// Below this top similarity there is nothing worth showing — say so instead of
// filling cards with noise. Calibrated against measured distributions: real needs
// top out at 0.26+ on the topic embedding, off-topic junk ("wedding photographer",
// "install windows 11") peaks at 0.249.
const MIN_TOP_SIMILARITY = 0.26;

/*
 * Precision gate.
 *
 * Product rule: a 2-1-1 handoff beats a bad suggestion. Previously only the TOP
 * result was gated, so ranks 2 and 3 were padded in regardless of quality — which
 * is how "Game Night for Kids" appeared for someone asking about clothing. A card
 * now has to earn its slot on its own, both absolutely and relative to the best
 * match, so a query with one good answer shows ONE card instead of one good card
 * and two lookalikes.
 */
const MIN_CARD_SIMILARITY = 0.24;
const MIN_CARD_RATIO_OF_TOP = 0.8;

// BM25 rewards exact vocabulary ("CalFresh", "food pantry"), which matters when the
// user types a short domain term. On long conversational needs it latches onto
// incidental words ("kids", "help", "my"), so its weight drops sharply and fuzzy
// matching is disabled.
const SHORT_QUERY_WORDS = 4;
const BM25_WEIGHT_SHORT = 0.25;
const BM25_WEIGHT_LONG = 0.06;

// Locality tiers, on the same 0..1 scale as normalized similarity. Sized to order
// comparable matches, not to override a clearly better one — relevance still spans
// the full 0..1, so no single tier can rescue a genuinely poor match.
const BOOST_SITE_IN_CITY = 0.15;
const BOOST_COVERS_CITY = 0.1;
const BOOST_COVERS_COUNTY = 0.06;
// A CA-wide program with no local presence (PG&E discount programs, statewide
// hotlines) is a genuine fallback, but should sit below local options.
const PENALTY_STATEWIDE = -0.15;
// Physically outside the two counties while claiming coverage here. The iCarol
// database is shared statewide, so this is common and actively misleading — it is
// what let a Los Angeles program take the top card for "diapers for a newborn".
const PENALTY_REMOTE = -0.35;

// Cards shown per page. Capped in the tool rather than the prompt so display stays
// deterministic (locked design decision).
const PAGE_SIZE = 3;

export type DirectorySearchParams = {
	need: string;
	city?: string;
	zip?: string;
	county?: string;
	/** Optional exact-vocabulary nudge, matched against AIRS taxonomy names. */
	taxonomyContains?: string;
	/** Paging for "show more" — 0-based offset into the ranked program list. */
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
	/** How this match relates to the user's location — drives card labelling. */
	locality: "in_city" | "covers_city" | "in_county" | "statewide" | "remote" | "unknown";
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
	/**
	 * Positive signal that location is already known, so the model never re-asks.
	 * Null only when the user genuinely gave no usable location.
	 */
	resolvedLocation: { city: string | null; county: string | null } | null;
	noGoodMatch: boolean;
	locationNote: string | null;
};

/** Columns needed for ranking and display. Excludes the 1536-dim embedding. */
const candidateColumns = {
	id: directoryPrograms.id,
	programId: directoryPrograms.programId,
	programName: directoryPrograms.programName,
	agencyName: directoryPrograms.agencyName,
	siteName: directoryPrograms.siteName,
	description: directoryPrograms.description,
	coverageDisplay: directoryPrograms.coverageDisplay,
	eligibility: directoryPrograms.eligibility,
	languages: directoryPrograms.languages,
	fees: directoryPrograms.fees,
	applicationProcess: directoryPrograms.applicationProcess,
	requiredDocumentation: directoryPrograms.requiredDocumentation,
	hours: directoryPrograms.hours,
	phones: directoryPrograms.phones,
	website: directoryPrograms.website,
	address: directoryPrograms.address,
	addressIsPrivate: directoryPrograms.addressIsPrivate,
	lastVerifiedOn: directoryPrograms.lastVerifiedOn,
	city: directoryPrograms.city,
	serviceAreas: directoryPrograms.serviceAreas,
	taxonomyNames: directoryPrograms.taxonomyNames,
};

type Candidate = {
	row: {
		[K in keyof typeof candidateColumns]: (typeof directoryPrograms.$inferSelect)[K];
	};
	similarity: number;
	siblings: number;
	score: number;
	locality: DirectoryMatch["locality"];
};

function localityOf(
	row: Candidate["row"],
	city: string | null,
	county: string | null,
): DirectoryMatch["locality"] {
	// A site physically outside the region is remote no matter what coverage it
	// claims — checked first, so a statewide agency in Los Angeles can't collect a
	// county-coverage bonus for a need in Merced.
	if (row.city && !isRegionalCity(row.city)) return "remote";
	if (city && row.city === city) return "in_city";
	if (city && row.serviceAreas.includes(`city:${city}`)) return "covers_city";
	if (county && row.serviceAreas.includes(`county:${county}`)) return "in_county";
	// No address and no local tie — it matched on statewide coverage alone.
	if (row.serviceAreas.some((t) => t.startsWith("state:"))) return "statewide";
	return "unknown";
}

function localityAdjustment(locality: DirectoryMatch["locality"]): number {
	switch (locality) {
		case "in_city":
			return BOOST_SITE_IN_CITY;
		case "covers_city":
			return BOOST_COVERS_CITY;
		case "in_county":
			return BOOST_COVERS_COUNTY;
		case "statewide":
			return PENALTY_STATEWIDE;
		case "remote":
			return PENALTY_REMOTE;
		default:
			return 0;
	}
}

function bm25Scores(candidates: Candidate[], query: string, isShort: boolean): Map<string, number> {
	const mini = new MiniSearch({
		idField: "id",
		fields: ["programName", "taxonomyNames", "agencyName", "description"],
		storeFields: ["id"],
		extractField: (doc: Candidate, field: string) => {
			if (field === "id") return doc.row.id;
			if (field === "taxonomyNames") return doc.row.taxonomyNames.join(", ");
			return (doc.row as Record<string, unknown>)[field] as string;
		},
	});
	mini.addAll(candidates);
	const results = mini.search(query, {
		boost: { programName: 3, taxonomyNames: 2.5, agencyName: 1.5, description: 1 },
		// Fuzzy + prefix help a short, possibly-misspelled domain term. On a long
		// conversational sentence they mostly manufacture spurious matches.
		fuzzy: isShort ? 0.1 : false,
		prefix: isShort,
	});
	const max = results[0]?.score ?? 1;
	return new Map(results.map((r) => [r.id as string, r.score / max]));
}

function toMatch(candidate: Candidate): DirectoryMatch {
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
		otherLocations: Math.max(0, candidate.siblings - 1),
		locality: candidate.locality,
	};
}

/**
 * Hybrid search over the mirrored 211 directory.
 *
 * Recall: one SQL query combines the service-area prefilter with pgvector cosine
 * similarity and deduplicates to the best row per program (DISTINCT ON), so the
 * candidate budget holds distinct programs rather than repeated sites of one.
 *
 * Ranking: similarity is normalized across the candidate pool, then blended with a
 * BM25 pass over name/taxonomy/agency/description and a locality adjustment.
 */
export async function searchDirectory(
	params: DirectorySearchParams,
): Promise<DirectorySearchResult> {
	const location = resolveUserLocation(params);
	const offset = Math.max(0, params.offset ?? 0);

	const needVector = await embedNeed(params.need);
	// Rank on the narrow topic embedding (name + services + one sentence). Against the
	// full ~700-char blob a perfect three-word match scored no better than an unrelated
	// program for the same population, which made relevance ungateable. Falls back to
	// the blob vector for any row not yet backfilled.
	const similarity = sql<number>`1 - (${cosineDistance(
		sql`coalesce(${directoryPrograms.topicEmbedding}, ${directoryPrograms.embedding})`,
		needVector,
	)})`;

	const filters = [
		arrayOverlaps(directoryPrograms.serviceAreas, location.tokens),
		gt(similarity, SIMILARITY_FLOOR),
	];
	if (params.taxonomyContains) {
		filters.push(
			sql`EXISTS (SELECT 1 FROM unnest(${directoryPrograms.taxonomyNames}) AS t(name) WHERE t.name ILIKE ${`%${params.taxonomyContains}%`})`,
		);
	}

	// Best row per program, plus how many of that program's rows matched (so the card
	// can say "also at 3 other locations"). The window count is evaluated before
	// DISTINCT ON collapses the group.
	const best = db
		.selectDistinctOn([directoryPrograms.programId], {
			...candidateColumns,
			similarity: sql<number>`${similarity}`.as("similarity"),
			siblings: sql<number>`count(*) over (partition by ${directoryPrograms.programId})`.as(
				"siblings",
			),
		})
		.from(directoryPrograms)
		.where(and(...filters))
		.orderBy(directoryPrograms.programId, desc(similarity))
		.as("best");

	const rows = await db
		.select()
		.from(best)
		.orderBy(desc(best.similarity))
		.limit(CANDIDATE_PROGRAMS);

	if (rows.length === 0 || Number(rows[0].similarity) < MIN_TOP_SIMILARITY) {
		return {
			matches: [],
			totalMatches: 0,
			moreCount: 0,
			offset,
			citiesRepresented: [],
			resolvedLocation: location.city || location.county ? { city: location.city, county: location.county } : null,
			noGoodMatch: true,
			locationNote: location.note,
		};
	}

	const candidates: Candidate[] = rows.map((r) => {
		const { similarity: sim, siblings, ...row } = r;
		return {
			row: row as Candidate["row"],
			similarity: Number(sim),
			siblings: Number(siblings),
			score: 0,
			locality: localityOf(row as Candidate["row"], location.city, location.county),
		};
	});

	// Normalize similarity across the pool so relevance spans 0..1 and the bonuses
	// below are proportionate rather than dominant.
	const sims = candidates.map((c) => c.similarity);
	const simMin = Math.min(...sims);
	const simMax = Math.max(...sims);
	const span = simMax - simMin;
	const normalize = (s: number) => (span > 1e-6 ? (s - simMin) / span : 1);

	const words = params.need.trim().split(/\s+/).length;
	const isShort = words <= SHORT_QUERY_WORDS;
	const bm25 = bm25Scores(candidates, params.need, isShort);
	const bm25Weight = isShort ? BM25_WEIGHT_SHORT : BM25_WEIGHT_LONG;

	for (const c of candidates) {
		c.score =
			normalize(c.similarity) +
			bm25Weight * (bm25.get(c.row.id) ?? 0) +
			localityAdjustment(c.locality);
	}
	candidates.sort((a, b) => b.score - a.score);

	// Precision gate: every surviving card must be relevant on its own merits, not
	// merely the third-best thing available. Applied on raw topic similarity rather
	// than the blended score so a location bonus can never carry an off-topic
	// program into a card slot.
	const bestSimilarity = Math.max(...candidates.map((c) => c.similarity));
	const cardFloor = Math.max(MIN_CARD_SIMILARITY, bestSimilarity * MIN_CARD_RATIO_OF_TOP);
	const relevant = candidates.filter((c) => c.similarity >= cardFloor);

	const page = relevant.slice(offset, offset + PAGE_SIZE);
	const citiesRepresented =
		location.city === null
			? [
					...new Set(
						relevant
							.slice(0, 30)
							.map((c) => c.row.address?.city)
							.filter((c): c is string => Boolean(c)),
					),
				].slice(0, 8)
			: [];

	return {
		matches: page.map(toMatch),
		// Counts describe what actually passed the precision gate, so "more options"
		// never promises results we would refuse to show.
		totalMatches: relevant.length,
		moreCount: Math.max(0, relevant.length - offset - PAGE_SIZE),
		offset,
		citiesRepresented,
		resolvedLocation:
			location.city || location.county ? { city: location.city, county: location.county } : null,
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
