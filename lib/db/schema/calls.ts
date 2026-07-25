import { boolean, index, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * One row per 211 call (source: master_file CSV, natural key CallReportNum).
 * Demographics live here only and are reached by join from needs/referrals.
 *
 * Categorical fields that were reworded across the Oct-2025 questionnaire
 * migration are stored twice: the original value (`*_raw`) and a canonicalized
 * value (`*_canonical`) produced on import. Filters/group-bys use canonical.
 *
 * The "is the person pregnant" question is intentionally omitted: it is empty
 * across the entire dataset.
 */
export const calls = pgTable(
	"calls",
	{
		callReportNum: varchar("call_report_num", { length: 32 }).primaryKey(),

		reportVersion: varchar("report_version", { length: 128 }),
		callLength: integer("call_length"),
		enteredOn: timestamp("entered_on").notNull(),

		// Geography (caller location)
		city: varchar("city", { length: 128 }),
		county: varchar("county", { length: 128 }),
		postalCode: varchar("postal_code", { length: 16 }),

		// Call information (introduced Oct-2025)
		languageRaw: varchar("language_raw", { length: 64 }),
		languageCanonical: varchar("language_canonical", { length: 64 }),
		teleInterpretationUsed: boolean("tele_interpretation_used"),

		// Demographics
		ethnicityRaw: varchar("ethnicity_raw", { length: 64 }),
		ethnicityCanonical: varchar("ethnicity_canonical", { length: 64 }),
		genderRaw: varchar("gender_raw", { length: 32 }),
		genderCanonical: varchar("gender_canonical", { length: 32 }),
		ageRaw: varchar("age_raw", { length: 32 }),
		ageNumeric: integer("age_numeric"),
		healthInsurance: varchar("health_insurance", { length: 64 }),

		// Person-in-need household issues (introduced Oct-2025)
		hasChildren0to5: boolean("has_children_0_5"),
		childrenUnder5Count: integer("children_under_5_count"),
		seniors60PlusCount: integer("seniors_60_plus_count"),

		// Pseudonymous repeat-caller key: salted hash of the caller's normalized
		// phone number, enriched from the RAW iCarol CallReports export (the
		// curated CSVs are de-identified). Never store the raw number. NULL when
		// the call had no usable phone or predates the raw export's window.
		callerKey: varchar("caller_key", { length: 32 }),
	},
	(t) => [
		index("calls_entered_on_idx").on(t.enteredOn),
		index("calls_caller_key_idx").on(t.callerKey),
		index("calls_county_idx").on(t.county),
		index("calls_ethnicity_canonical_idx").on(t.ethnicityCanonical),
		index("calls_gender_canonical_idx").on(t.genderCanonical),
		index("calls_language_canonical_idx").on(t.languageCanonical),
	],
);

export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
