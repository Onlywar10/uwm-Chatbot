/**
 * ⚠️ APPROVAL REQUIRED — domain definitions, not architecture.
 *
 * Raw categorical values were reworded/split across the Oct-2025 questionnaire
 * migration (and contain a typo). This maps each raw value to a canonical one
 * so cross-migration questions ("African American callers across all time")
 * count correctly. The importer stores BOTH the raw and the canonical value.
 *
 * Canonical vocabularies were aligned to the reporting categories the user
 * specified on 2026-07-14:
 *   - Ethnicity: the 8 federal reporting categories + "Other" (responses that
 *     fit no category: Other/Portuguese/Middle Eastern/Assyrian).
 *   - Language: English, Vietnamese, Spanish, Mandarin, Other, Unknown.
 *     Vietnamese/Mandarin have no rows yet — kept as valid (empty) buckets.
 *   - "Unknown" means the caller explicitly DECLINED. Blank/not-recorded stays
 *     NULL and is surfaced via denominators + coverage notes, never as a value.
 *
 * Lookup is case-insensitive and trimmed (see lib/import/canonicalize.ts).
 * A raw value absent from a map passes through unchanged and is reported as
 * "unmapped" at import time — so nothing is ever silently dropped.
 */

export type CanonicalMap = Record<string, string>;

export const ethnicityMap: CanonicalMap = {
	"Hispanic / Latin@": "Hispanic/Latino",
	"Hispanic/Latino": "Hispanic/Latino",
	"Mexican/Mexican-American/Chicano": "Hispanic/Latino",
	"Central American": "Hispanic/Latino",
	"African American/Black": "Black African American",
	"Black or African American": "Black African American",
	African: "Black African American",
	Caucasian: "White",
	White: "White",
	"White/Caucasian": "White",
	European: "White",
	"Eastern European": "White",
	Asian: "Asian",
	Filipino: "Asian",
	Korean: "Asian",
	"Native American": "Alaska Native/American Indian",
	"Native Amercian": "Alaska Native/American Indian",
	"Native American/Alaskan Native": "Alaska Native/American Indian",
	"Pacific Islander / Native Hawaiian": "Native Hawaiian",
	"Pacific Islander": "Native Hawaiian",
	"Native Hawaiian/Pacific Islander": "Native Hawaiian",
	"Multi-ethnic": "Two or More Races",
	"More than one ethnicity": "Two or More Races",
	Multiracial: "Two or More Races",
	"Declined to answer": "Unknown",
	"Decline to Answer": "Unknown",
	"Caller Declined": "Unknown",
	Other: "Other",
	Portuguese: "Other",
	"Middle Eastern": "Other",
	Assyrian: "Other",
};

export const genderMap: CanonicalMap = {
	Female: "Female",
	Male: "Male",
	Transgender: "Transgender",
	Nonbinary: "Other",
	Other: "Other",
	"Caller Declined": "Declined",
	"Declined to answer": "Declined",
};

export const languageMap: CanonicalMap = {
	English: "English",
	Spanish: "Spanish",
	Vietnamese: "Vietnamese",
	Mandarin: "Mandarin",
	Punjabi: "Other",
	Arabic: "Other",
	Indonesian: "Other",
	Unknown: "Unknown",
	"Caller Declined": "Unknown",
	"Declined to answer": "Unknown",
	// a new language in a future export passes through raw and is reported
	// unmapped — add it here (usually → "Other") when it appears
};

/** Curated canonical value sets — the closed vocabularies the tools expose as enums. */
export const ETHNICITY_CANONICAL_VALUES = [
	"Hispanic/Latino",
	"White",
	"Black African American",
	"Asian",
	"Alaska Native/American Indian",
	"Native Hawaiian",
	"Two or More Races",
	"Other",
	"Unknown",
] as const;

export const GENDER_CANONICAL_VALUES = [
	"Female",
	"Male",
	"Transgender",
	"Other",
	"Declined",
] as const;

export const LANGUAGE_CANONICAL_VALUES = [
	"English",
	"Vietnamese",
	"Spanish",
	"Mandarin",
	"Other",
	"Unknown",
] as const;

/** Fields that get canonicalized, mapped to their lookup table. */
export const CANONICAL_MAPS = {
	ethnicity: ethnicityMap,
	gender: genderMap,
	language: languageMap,
} as const;

export type CanonicalField = keyof typeof CANONICAL_MAPS;
