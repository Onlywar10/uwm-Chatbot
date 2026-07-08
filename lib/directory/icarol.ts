import { env } from "@/lib/env.mjs";

/**
 * Read-only iCarol Resource API client used by the directory sync.
 *
 * API behavior verified by probing (2026-07): Resource/Search honors only
 * `term`/`resourceType`/`status`/`take`/`skip` (taxonomy/geo/zip params are
 * silently ignored), so all filtering happens on our side after mirroring.
 * Detail GETs sometimes return an array for a single id.
 */

const BASE = "https://api.icarol.com/v1";
const TAKE = 100;
const MAX_PAGES = 100;
const DETAIL_BATCH = 10;
const DETAIL_CONCURRENCY = 6;
const RETRIES = 2;

export type ICarolResourceType = "Agency" | "Program" | "Site";

export type ICarolContactDetail = {
	contact?: {
		type?: string;
		purpose?: string;
		label?: string;
		number?: string;
		address?: string;
		url?: string;
		description?: string;
		line1?: string;
		line2?: string;
		city?: string;
		county?: string;
		stateProvince?: string;
		zipPostalCode?: string;
		latitude?: number;
		longitude?: number;
		precision?: string;
	};
	isConfidential?: boolean;
};

export type ICarolCoverageEntry = {
	purpose?: string;
	city?: string;
	county?: string;
	stateProvince?: string;
	zipPostalCode?: string;
	country?: string;
	type?: string;
};

export type ICarolResource = {
	id: number;
	type?: ICarolResourceType;
	status?: string;
	names?: { value?: string; purpose?: string }[];
	description?: string;
	descriptionText?: string;
	taxonomy?: string | string[];
	related?: { id: number; type?: string; name?: string; status?: string }[];
	contactDetails?: ICarolContactDetail[];
	coverage?: ICarolCoverageEntry[];
	eligibility?: string;
	languagesOffered?: string;
	fees?: string;
	applicationProcess?: string;
	requiredDocumentation?: string;
	hours?: { note?: string; days?: { dayOfWeek?: string; opens?: string; closes?: string }[] };
	searchHints?: string[];
	searchHintsCombined?: string;
	lastVerifiedOn?: string;
	isConfidential?: boolean;
	excludeFromDirectory?: boolean;
};

export type ICarolTaxonomyTerm = {
	code: string;
	name: string;
	path?: string;
	definition?: string;
	synonyms?: string[];
};

function apiKey(): string {
	if (!env.ICAROL_API_KEY) {
		throw new Error("ICAROL_API_KEY is not set — the directory sync requires it.");
	}
	return env.ICAROL_API_KEY;
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= RETRIES; attempt++) {
		try {
			const res = await fetch(url, init);
			// Retry server-side hiccups; 4xx are real errors worth surfacing.
			if (res.status >= 500) {
				lastError = new Error(`iCarol ${res.status} for ${url}`);
			} else {
				return res;
			}
		} catch (error) {
			lastError = error;
		}
		await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
	}
	throw lastError;
}

/**
 * Page through Resource/Search for one type. Returns lightweight search hits
 * (full detail requires fetchDetails) and cross-checks totalResultCount so a
 * silently truncated sweep fails loudly instead of shrinking the directory.
 */
export async function sweepResources(resourceType: ICarolResourceType): Promise<ICarolResource[]> {
	const all: ICarolResource[] = [];
	let expectedTotal: number | null = null;

	for (let page = 0; page < MAX_PAGES; page++) {
		const res = await fetchWithRetry(`${BASE}/Resource/Search`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey()}`,
				"Content-Type": "application/json",
				"Content-Language": "en-US",
			},
			body: JSON.stringify({
				database: [Number(env.ICAROL_DB_ID)],
				term: "*",
				namesOnly: false,
				resourceType,
				status: "Active",
				take: TAKE,
				skip: page * TAKE,
			}),
		});
		if (!res.ok) {
			throw new Error(`iCarol Resource/Search failed for ${resourceType}: HTTP ${res.status}`);
		}
		const data = (await res.json()) as {
			totalResultCount?: number;
			results?: { resource?: ICarolResource }[];
		};
		if (expectedTotal === null && typeof data.totalResultCount === "number") {
			expectedTotal = data.totalResultCount;
		}
		const results = Array.isArray(data.results) ? data.results : [];
		for (const item of results) {
			if (item?.resource?.id) all.push(item.resource);
		}
		if (results.length < TAKE) break;
	}

	if (expectedTotal !== null && all.length < expectedTotal) {
		throw new Error(
			`iCarol sweep for ${resourceType} returned ${all.length} of ${expectedTotal} — refusing to sync a partial directory.`,
		);
	}
	return all;
}

/** Fetch full detail records for a set of resource ids, batched + concurrent. */
export async function fetchDetails(ids: number[]): Promise<ICarolResource[]> {
	const batches: number[][] = [];
	for (let i = 0; i < ids.length; i += DETAIL_BATCH) {
		batches.push(ids.slice(i, i + DETAIL_BATCH));
	}

	const out: ICarolResource[] = [];
	for (let i = 0; i < batches.length; i += DETAIL_CONCURRENCY) {
		const slice = batches.slice(i, i + DETAIL_CONCURRENCY);
		const results = await Promise.all(
			slice.map(async (batch) => {
				const params = batch.map((id) => `id=${encodeURIComponent(String(id))}`).join("&");
				const res = await fetchWithRetry(`${BASE}/Resource/?${params}`, {
					headers: { Authorization: `Bearer ${apiKey()}`, "Accept-Language": "en-US" },
				});
				if (!res.ok) {
					throw new Error(`iCarol Resource detail fetch failed: HTTP ${res.status}`);
				}
				const arr = await res.json();
				return (Array.isArray(arr) ? arr : [arr]) as ICarolResource[];
			}),
		);
		for (const r of results) out.push(...r);
	}
	return out;
}

/** Resolve AIRS taxonomy codes to terms. Codes the API doesn't know are skipped. */
export async function fetchTaxonomyTerms(codes: string[]): Promise<ICarolTaxonomyTerm[]> {
	const out: ICarolTaxonomyTerm[] = [];
	for (let i = 0; i < codes.length; i += DETAIL_BATCH) {
		const batch = codes.slice(i, i + DETAIL_BATCH);
		const params = batch.map((c) => `id=${encodeURIComponent(c)}`).join("&");
		const res = await fetchWithRetry(
			`${BASE}/Resource/Taxonomy?${params}&db=${Number(env.ICAROL_DB_ID)}`,
			{ headers: { Authorization: `Bearer ${apiKey()}`, "Accept-Language": "en-US" } },
		);
		if (!res.ok) continue;
		const arr = (await res.json()) as ICarolTaxonomyTerm[];
		for (const term of arr || []) {
			if (term?.code && term?.name) out.push(term);
		}
	}
	return out;
}
