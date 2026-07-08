import { db } from "@/lib/db";
import { directoryPrograms } from "@/lib/db/schema/directoryPrograms";
import { directoryTaxonomy } from "@/lib/db/schema/directoryTaxonomy";
import { embedMany } from "ai";
import { embeddingModel } from "./embedding";
import { fetchDetails, fetchTaxonomyTerms, sweepResources, type ICarolResource } from "./icarol";
import { loadDirectory } from "./load";
import {
	programToRows,
	splitTaxonomyCodes,
	type DirectoryRowDraft,
	type TaxonomyInfo,
} from "./transform";

const EMBED_BATCH = 200;

export type SyncStats = {
	programsSwept: number;
	programsImported: number;
	rows: number;
	rowsWithAddress: number;
	taxonomyFetched: number;
	embeddingsComputed: number;
	embeddingsReused: number;
	durationMs: number;
};

/**
 * Resolve taxonomy codes to names/synonyms, hitting the API only for codes not
 * already cached in directory_taxonomy (the cache is append-only).
 */
async function resolveTaxonomy(
	codes: string[],
): Promise<{ map: Map<string, TaxonomyInfo>; fetched: number }> {
	const map = new Map<string, TaxonomyInfo>();
	const cached = await db.select().from(directoryTaxonomy);
	for (const term of cached) {
		map.set(term.code, { name: term.name, synonyms: term.synonyms });
	}

	const missing = codes.filter((c) => !map.has(c));
	if (missing.length === 0) return { map, fetched: 0 };

	const terms = await fetchTaxonomyTerms(missing);
	if (terms.length > 0) {
		await db
			.insert(directoryTaxonomy)
			.values(
				terms.map((t) => ({
					code: t.code,
					name: t.name,
					path: t.path ?? null,
					definition: t.definition ?? null,
					synonyms: t.synonyms ?? [],
				})),
			)
			.onConflictDoNothing();
	}
	for (const t of terms) {
		map.set(t.code, { name: t.name, synonyms: t.synonyms ?? [] });
	}
	return { map, fetched: terms.length };
}

/**
 * Embed row drafts, reusing yesterday's vectors for rows whose embedding text
 * is unchanged (matched by content hash) so a routine nightly sync costs only
 * the handful of records that actually changed.
 */
async function embedRows(drafts: DirectoryRowDraft[]) {
	const existing = await db
		.select({ contentHash: directoryPrograms.contentHash, embedding: directoryPrograms.embedding })
		.from(directoryPrograms);
	const byHash = new Map(existing.map((e) => [e.contentHash, e.embedding]));

	const toEmbed = [
		...new Map(
			drafts.filter((d) => !byHash.has(d.contentHash)).map((d) => [d.contentHash, d]),
		).values(),
	];

	for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
		const batch = toEmbed.slice(i, i + EMBED_BATCH);
		const { embeddings } = await embedMany({
			model: embeddingModel(),
			values: batch.map((d) => d.embeddingText),
		});
		batch.forEach((d, j) => {
			byHash.set(d.contentHash, embeddings[j]);
		});
	}

	return {
		rows: drafts.map((d) => ({ ...d, embedding: byHash.get(d.contentHash) as number[] })),
		computed: toEmbed.length,
		reused: drafts.length - toEmbed.length,
	};
}

export async function syncDirectory(log: (msg: string) => void = () => {}): Promise<SyncStats> {
	const start = Date.now();

	log("Sweeping Active programs...");
	const programHits = await sweepResources("Program");
	log(`Fetching ${programHits.length} program details...`);
	const programs = await fetchDetails(programHits.map((p) => p.id));

	const usable = programs.filter(
		(p) => !p.excludeFromDirectory && !p.isConfidential && (!p.status || p.status === "Active"),
	);

	// Details for every referenced site, and for agencies of site-less programs
	// (their public address stands in for a missing site's).
	const siteIds = new Set<number>();
	const fallbackAgencyIds = new Set<number>();
	for (const p of usable) {
		const rels = (p.related ?? []).filter((r) => r?.type === "Site");
		for (const r of rels) siteIds.add(r.id);
		if (rels.length === 0) {
			const agency = (p.related ?? []).find((r) => r?.type === "Agency");
			if (agency) fallbackAgencyIds.add(agency.id);
		}
	}
	log(`Fetching ${siteIds.size} sites and ${fallbackAgencyIds.size} fallback agencies...`);
	const [sites, agencies] = await Promise.all([
		fetchDetails([...siteIds]),
		fetchDetails([...fallbackAgencyIds]),
	]);
	const siteById = new Map<number, ICarolResource>(sites.map((s) => [s.id, s]));
	const agencyById = new Map<number, ICarolResource>(agencies.map((a) => [a.id, a]));

	const allCodes = [...new Set(usable.flatMap((p) => splitTaxonomyCodes(p.taxonomy)))];
	log(`Resolving ${allCodes.length} taxonomy codes...`);
	const { map: taxonomyByCode, fetched: taxonomyFetched } = await resolveTaxonomy(allCodes);

	const drafts = usable.flatMap((p) => programToRows(p, siteById, agencyById, taxonomyByCode));
	log(`Embedding ${drafts.length} rows...`);
	const { rows, computed, reused } = await embedRows(drafts);

	log("Loading (transactional truncate + reload)...");
	await loadDirectory(rows);

	return {
		programsSwept: programHits.length,
		programsImported: usable.length,
		rows: rows.length,
		rowsWithAddress: rows.filter((r) => r.address !== null).length,
		taxonomyFetched,
		embeddingsComputed: computed,
		embeddingsReused: reused,
		durationMs: Date.now() - start,
	};
}
