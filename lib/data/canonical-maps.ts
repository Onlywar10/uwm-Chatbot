/**
 * ⚠️ APPROVAL REQUIRED — domain definitions, not architecture.
 *
 * Raw categorical values were reworded/split across the Oct-2025 questionnaire
 * migration (and contain a typo). This maps each raw value to a canonical one
 * so cross-migration questions ("African American callers across all time")
 * count correctly. The importer stores BOTH the raw and the canonical value.
 *
 * Lookup is case-insensitive and trimmed (see lib/import/canonicalize.ts).
 * A raw value absent from a map passes through unchanged and is reported as
 * "unmapped" at import time — so nothing is ever silently dropped.
 *
 * Lines marked ⚠️ are judgment calls — confirm or change them:
 *   - whether the post-2025 granular Hispanic buckets collapse to one
 *   - whether "African" (immigrant) merges with "African American"
 *   - whether European / Portuguese / Filipino / Korean / Assyrian roll up
 */

export type CanonicalMap = Record<string, string>;

export const ethnicityMap: CanonicalMap = {
	"Hispanic / Latin@": "Hispanic/Latino",
	"Mexican/Mexican-American/Chicano": "Hispanic/Latino", 
	"Central American": "Hispanic/Latino", 
	"African American/Black": "Black/African American",
	"Black or African American": "Black/African American",
	African: "Black/African American",
	Caucasian: "White",
	White: "White",
	European: "White",
	Asian: "Asian",
	Filipino: "Asian",
	Korean: "Asian", 
	"Native American": "Native American",
	"Native Amercian": "Native American", 
	"Pacific Islander / Native Hawaiian": "Pacific Islander/Native Hawaiian",
	"Pacific Islander": "Pacific Islander/Native Hawaiian",
	"Middle Eastern": "Middle Eastern",
	Assyrian: "Middle Eastern",
	Portuguese: "Portuguese",
	"Multi-ethnic": "Multiple ethnicities",
	"More than one ethnicity": "Multiple ethnicities",
	"Declined to answer": "Declined",
	"Caller Declined": "Declined",
	Other: "Other",
};

export const genderMap: CanonicalMap = {
	Female: "Female",
	Male: "Male",
	Transgender: "Transgender",
	Other: "Other",
	"Caller Declined": "Declined",
	"Declined to answer": "Declined",
};

export const languageMap: CanonicalMap = {
	English: "English",
	Spanish: "Spanish",
	Punjabi: "Punjabi",
	Arabic: "Arabic",
	// rare languages pass through unchanged
};

/** Curated canonical value sets — the closed vocabularies the tools expose as enums. */
export const ETHNICITY_CANONICAL_VALUES = [
	"Hispanic/Latino",
	"Black/African American",
	"White",
	"Asian",
	"Native American",
	"Pacific Islander/Native Hawaiian",
	"Middle Eastern",
	"Portuguese",
	"Multiple ethnicities",
	"Other",
	"Declined",
] as const;

export const GENDER_CANONICAL_VALUES = [
	"Female",
	"Male",
	"Transgender",
	"Other",
	"Declined",
] as const;

export const LANGUAGE_CANONICAL_VALUES = ["English", "Spanish", "Punjabi", "Arabic"] as const;

/** Fields that get canonicalized, mapped to their lookup table. */
export const CANONICAL_MAPS = {
	ethnicity: ethnicityMap,
	gender: genderMap,
	language: languageMap,
} as const;

export type CanonicalField = keyof typeof CANONICAL_MAPS;
