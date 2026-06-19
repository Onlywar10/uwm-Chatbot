import MiniSearch from "minisearch";
import type { Metadata } from "@/lib/types/crawl";

type Candidate = {
	id: string;
	name: string;
	similarity: number;
	sourceUrl: string;
	metadata: Metadata;
};

export function buildMiniSearchIndex(db: Candidate[]): MiniSearch {
	const miniSearch = new MiniSearch({
		idField: "id",
		fields: ["name", "pageTitle", "sectionHeaders", "topCategory", "subCategory", "pageCategory"],
		storeFields: ["id"],
		extractField: (doc: Candidate, fieldName: string) => {
			if (fieldName in doc.metadata) {
				return doc.metadata[fieldName as keyof typeof doc.metadata];
			}
			return (doc as any)[fieldName];
		},
	});

	const unique = Array.from(new Map(db.map((doc) => [doc.id, doc])).values());

	miniSearch.addAll(unique);
	return miniSearch;
}

// BM25 search returning a score map
export function bm25Search(miniSearch: MiniSearch, query: string): Map<string, number> {
	const results = miniSearch.search(query, {
		boost: {
			name: 3,
			sectionHeaders: 2.5,
			pageTitle: 2,
			subCategory: 0.5,
			topCategory: 0.5,
		},
		fuzzy: 0.2,
		prefix: true,
	});

	const maxScore = results[0]?.score ?? 1;
	return new Map(results.map((r) => [r.id, r.score / maxScore]));
}
