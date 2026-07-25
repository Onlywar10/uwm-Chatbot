import { createHash } from "node:crypto";
import type {
	DirectoryAddress,
	DirectoryHours,
	DirectoryPhone,
	NewDirectoryProgram,
} from "@/lib/db/schema/directoryPrograms";
import type { ICarolContactDetail, ICarolCoverageEntry, ICarolResource } from "./icarol";

/** A directory row minus the embedding, which is computed in a later step. */
export type DirectoryRowDraft = Omit<NewDirectoryProgram, "embedding">;

export type TaxonomyInfo = { name: string; synonyms: string[] };

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>?/gm, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function splitTaxonomyCodes(raw: ICarolResource["taxonomy"]): string[] {
	const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
	const codes = list.flatMap((entry) =>
		String(entry)
			.split("*")
			.map((s) => s.trim())
			.filter(Boolean),
	);
	return [...new Set(codes)];
}

/**
 * Normalize iCarol's structured coverage[] into GIN-matchable tokens.
 * An entry names the narrowest area it covers: city if present, else county,
 * else the whole state. Query-side matching ORs the user's own city/county/
 * state tokens against these.
 */
export function serviceAreaTokens(coverage: ICarolCoverageEntry[] | undefined): string[] {
	const tokens = new Set<string>();
	for (const entry of coverage ?? []) {
		const city = entry.city?.trim().toLowerCase();
		const county = entry.county?.trim().toLowerCase();
		const zip = entry.zipPostalCode?.trim();
		const state = entry.stateProvince?.trim().toLowerCase();
		if (city) tokens.add(`city:${city}`);
		else if (county) tokens.add(`county:${county}`);
		else if (state) tokens.add(`state:${state}`);
		if (zip) tokens.add(`zip:${zip}`);
	}
	return [...tokens];
}

/**
 * Coverage tokens for a row whose program has NO structured coverage[] in iCarol.
 *
 * Search prefilters with `arrayOverlaps(service_areas, ...)`, and an empty array
 * overlaps nothing — so a row with no tokens is unreachable by every query, forever.
 * That silently hid 8% of the directory, including every cooling center in both
 * counties and The Trevor Project.
 *
 * A program with a physical address in a town almost certainly serves that town, so
 * fall back to the row's own location. This is deliberately narrower than a coverage
 * claim: we assert the city and its county, not a region.
 */
export function fallbackAreaTokens(
	address: { city?: string; county?: string } | null | undefined,
): string[] {
	const tokens = new Set<string>();
	const city = address?.city?.trim().toLowerCase();
	const county = address?.county?.trim().toLowerCase();
	if (city) tokens.add(`city:${city}`);
	if (county) tokens.add(`county:${county}`);
	return [...tokens];
}

/** Human-readable coverage summary for cards, e.g. "Serves Merced County". */
export function coverageDisplay(coverage: ICarolCoverageEntry[] | undefined): string | null {
	const entries = coverage ?? [];
	if (entries.length === 0) return null;

	const counties = new Set<string>();
	const cities = new Set<string>();
	let statewide: string | null = null;
	for (const entry of entries) {
		if (entry.city?.trim()) cities.add(entry.city.trim());
		else if (entry.county?.trim()) counties.add(`${entry.county.trim()} County`);
		else if (entry.stateProvince?.trim()) statewide = entry.stateProvince.trim();
	}

	const parts = [...counties, ...cities];
	if (parts.length === 0) {
		return statewide ? `Serves all of ${statewide === "CA" ? "California" : statewide}` : null;
	}
	const shown = parts.slice(0, 4);
	const more = parts.length - shown.length;
	return `Serves ${shown.join(", ")}${more > 0 ? ` + ${more} more` : ""}`;
}

function normalizePhoneLabel(raw?: string): string {
	const s = (raw || "").trim();
	if (!s) return "Phone";
	const t = s.toLowerCase();
	if (t.includes("toll")) return "Toll Free";
	if (t.includes("hot")) return "Hotline";
	if (t.includes("out") && t.includes("area")) return "Out of Area Line";
	if (t.includes("after") && t.includes("hour")) return "After Hours Line";
	if (t.includes("main") || t.includes("business")) return "Business Line";
	if (t === "fax") return "Fax";
	if (t === "tty") return "TTY";
	if (/^phone\d$/.test(t)) return "Phone";
	return s.replace(/[-_]/g, " ").replace(/\s+/g, " ");
}

/** Public (non-confidential) phone numbers, deduped, fax/TTY excluded. */
export function extractPublicPhones(
	contactDetails: ICarolContactDetail[] | undefined,
): DirectoryPhone[] {
	const out: DirectoryPhone[] = [];
	const seen = new Set<string>();
	for (const cd of contactDetails ?? []) {
		if (!cd || cd.isConfidential) continue;
		const c = cd.contact;
		if (c?.type !== "PhoneNumber") continue;
		const number = (c.number || "").trim();
		if (!number) continue;
		const label = normalizePhoneLabel(c.label || c.purpose);
		if (label === "Fax" || label === "TTY") continue;
		const key = number.replace(/\D/g, "");
		if (seen.has(key)) continue;
		seen.add(key);
		const description = c.description?.trim() || undefined;
		out.push({ label, number, description });
	}
	return out;
}

export function extractWebsite(contactDetails: ICarolContactDetail[] | undefined): string | null {
	for (const cd of contactDetails ?? []) {
		if (!cd || cd.isConfidential) continue;
		const c = cd.contact;
		if ((c?.type || "").toLowerCase() !== "website") continue;
		const raw = (c?.url || "").trim();
		if (!raw) continue;
		return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
	}
	return null;
}

export type ExtractedAddress = {
	address: DirectoryAddress;
	latitude: number | null;
	longitude: number | null;
};

/** First public address, preferring PhysicalLocation over PostalAddress. */
export function extractPublicAddress(
	contactDetails: ICarolContactDetail[] | undefined,
): ExtractedAddress | null {
	const candidates = (contactDetails ?? []).filter(
		(cd) =>
			cd &&
			!cd.isConfidential &&
			(cd.contact?.type === "PhysicalLocation" || cd.contact?.type === "PostalAddress"),
	);
	candidates.sort(
		(a, b) =>
			(a.contact?.type === "PhysicalLocation" ? 0 : 1) -
			(b.contact?.type === "PhysicalLocation" ? 0 : 1),
	);
	const c = candidates[0]?.contact;
	if (!c) return null;
	return {
		address: {
			line1: c.line1?.trim() || undefined,
			line2: c.line2?.trim() || undefined,
			city: c.city?.trim() || undefined,
			county: c.county?.trim() || undefined,
			stateProvince: c.stateProvince?.trim() || undefined,
			zipPostalCode: c.zipPostalCode?.trim() || undefined,
		},
		latitude: typeof c.latitude === "number" ? c.latitude : null,
		longitude: typeof c.longitude === "number" ? c.longitude : null,
	};
}

function toHours(resource: ICarolResource | undefined): DirectoryHours | null {
	const hours = resource?.hours;
	const days = (hours?.days ?? [])
		.filter((d) => d?.dayOfWeek && (d.opens || d.closes))
		.map((d) => ({
			dayOfWeek: d.dayOfWeek as string,
			opens: d.opens || undefined,
			closes: d.closes || undefined,
		}));
	const note = hours?.note?.trim() || undefined;
	if (days.length === 0 && !note) return null;
	return { note, days };
}

function primaryName(resource: ICarolResource | undefined): string | null {
	const names = resource?.names ?? [];
	const primary = names.find((n) => n?.purpose === "Primary") ?? names[0];
	return primary?.value?.trim() || null;
}

function parseVerifiedOn(raw: string | undefined): Date | null {
	if (!raw) return null;
	const d = new Date(raw);
	return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Narrow "what this program is" text for the topic embedding.
 *
 * Deliberately excludes eligibility, hours, coverage, address and the long tail of
 * the description. Those make the full embeddingText good for recall on unusual
 * phrasings but terrible for discrimination: against ~700 chars, a perfect
 * three-word topical match scores about the same as an unrelated program serving
 * the same population. Keeping this to name + services + one sentence is what lets
 * "winter coats" separate from "wedding photographer".
 */
export function buildTopicText(params: {
	programName: string;
	taxonomy: string[];
	description: string | null;
}): string {
	const firstSentences = params.description
		? params.description.replace(/\s+/g, " ").trim().slice(0, 220)
		: null;
	return [
		params.programName,
		params.taxonomy.length ? params.taxonomy.join(", ") : null,
		firstSentences,
	]
		.filter(Boolean)
		.join(" | ");
}

function buildEmbeddingText(params: {
	programName: string;
	agencyName: string | null;
	siteName: string | null;
	taxonomy: string[];
	description: string | null;
	eligibility: string | null;
	searchHints: string | null;
	coverage: string | null;
	city: string | null;
}): string {
	const clip = (s: string | null, max: number) => (s ? s.slice(0, max) : null);
	return [
		params.programName,
		params.agencyName,
		params.siteName,
		params.taxonomy.length ? `Services: ${params.taxonomy.join("; ")}` : null,
		clip(params.description, 1500),
		params.eligibility ? `Eligibility: ${clip(params.eligibility, 500)}` : null,
		params.searchHints ? `Also known as: ${clip(params.searchHints, 300)}` : null,
		params.coverage,
		params.city,
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * Flatten one program detail into Program × Site row drafts.
 *
 * - Sites come from related[]; missing/inactive site details are skipped.
 * - A program with no usable site gets one row, borrowing the agency's public
 *   address when available (program-level address fill is ~0% in this DB).
 * - Site hours/phones override or extend the program's when present.
 */
export function programToRows(
	program: ICarolResource,
	siteById: Map<number, ICarolResource>,
	agencyById: Map<number, ICarolResource>,
	taxonomyByCode: Map<string, TaxonomyInfo>,
): DirectoryRowDraft[] {
	if (program.excludeFromDirectory || program.isConfidential) return [];
	if (program.status && program.status !== "Active") return [];

	const programName = primaryName(program);
	if (!programName) return [];

	const related = program.related ?? [];
	const agencyRel = related.find((r) => r?.type === "Agency");
	const agency = agencyRel ? agencyById.get(agencyRel.id) : undefined;
	const agencyName = agencyRel?.name?.trim() || primaryName(agency);

	const taxonomyCodes = splitTaxonomyCodes(program.taxonomy);
	const taxonomyNames = [
		...new Set(
			taxonomyCodes.flatMap((code) => {
				const info = taxonomyByCode.get(code);
				return info ? [info.name, ...info.synonyms] : [];
			}),
		),
	];

	const description =
		program.descriptionText?.trim() ||
		(program.description ? stripHtml(program.description) : null);
	const searchHints =
		program.searchHintsCombined?.trim() ||
		(program.searchHints?.length ? program.searchHints.join(", ") : null);
	const coverage = coverageDisplay(program.coverage);
	const areas = serviceAreaTokens(program.coverage);
	const programPhones = extractPublicPhones(program.contactDetails);
	const programHours = toHours(program);

	const base = {
		programId: program.id,
		agencyId: agencyRel?.id ?? null,
		programName,
		agencyName: agencyName ?? null,
		description: description || null,
		taxonomyCodes,
		taxonomyNames,
		serviceAreas: areas,
		coverageDisplay: coverage,
		eligibility: program.eligibility?.trim() || null,
		languages: program.languagesOffered?.trim() || null,
		fees: program.fees?.trim() || null,
		applicationProcess: program.applicationProcess?.trim() || null,
		requiredDocumentation: program.requiredDocumentation?.trim() || null,
		website: extractWebsite(program.contactDetails),
		lastVerifiedOn: parseVerifiedOn(program.lastVerifiedOn),
	};

	const makeRow = (
		site: ICarolResource | null,
		located: ExtractedAddress | null,
		addressIsPrivate: boolean,
	): DirectoryRowDraft => {
		const siteName = site ? primaryName(site) : null;
		const sitePhones = site ? extractPublicPhones(site.contactDetails) : [];
		const phones = [...programPhones];
		for (const p of sitePhones) {
			if (!phones.some((q) => q.number.replace(/\D/g, "") === p.number.replace(/\D/g, ""))) {
				phones.push(p);
			}
		}
		const embeddingText = buildEmbeddingText({
			programName,
			agencyName: base.agencyName,
			siteName,
			taxonomy: taxonomyNames,
			description: base.description,
			eligibility: base.eligibility,
			searchHints,
			coverage,
			city: located?.address.city ?? null,
		});
		return {
			...base,
			// iCarol left coverage[] empty for this program — derive reach from where
			// the row actually is, or it can never be returned by any search.
			serviceAreas: base.serviceAreas.length
				? base.serviceAreas
				: fallbackAreaTokens(located?.address),
			siteId: site?.id ?? null,
			siteName,
			hours: toHours(site ?? undefined) ?? programHours,
			phones,
			address: located?.address ?? null,
			city: located?.address.city?.toLowerCase() ?? null,
			county: located?.address.county?.toLowerCase() ?? null,
			latitude: located?.latitude ?? null,
			longitude: located?.longitude ?? null,
			addressIsPrivate,
			embeddingText,
			contentHash: createHash("sha256").update(embeddingText).digest("hex"),
		};
	};

	const siteRels = related.filter((r) => r?.type === "Site");
	const rows: DirectoryRowDraft[] = [];
	for (const rel of siteRels) {
		const site = siteById.get(rel.id);
		if (!site || site.isConfidential || (site.status && site.status !== "Active")) continue;
		const located = extractPublicAddress(site.contactDetails);
		const hasAnyAddress = (site.contactDetails ?? []).some(
			(cd) => cd?.contact?.type === "PhysicalLocation" || cd?.contact?.type === "PostalAddress",
		);
		rows.push(makeRow(site, located, hasAnyAddress && !located));
	}

	if (rows.length === 0) {
		const agencyLocated = agency ? extractPublicAddress(agency.contactDetails) : null;
		const agencyHasAnyAddress = (agency?.contactDetails ?? []).some(
			(cd) => cd?.contact?.type === "PhysicalLocation" || cd?.contact?.type === "PostalAddress",
		);
		rows.push(makeRow(null, agencyLocated, agencyHasAnyAddress && !agencyLocated));
	}
	return rows;
}
