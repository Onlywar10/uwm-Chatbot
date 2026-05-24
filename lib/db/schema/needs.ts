import { boolean, index, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

import { calls } from "./calls";

/**
 * One row per expressed need (source: unmet & met CSV, natural key
 * ReportNeedNum). A need belongs to one call and may fan out to multiple
 * agency referrals.
 *
 * Need type (taxonomy / AIRS category) and whether it was met are properties
 * of the need, not the individual referral — verified constant across all
 * multi-agency needs in the source data. `dateOfCall` is denormalized here
 * (equals the parent call's date) so the common "needs in a time window"
 * filter avoids a join.
 */
export const needs = pgTable(
	"needs",
	{
		reportNeedNum: varchar("report_need_num", { length: 32 }).primaryKey(),

		callReportNum: varchar("call_report_num", { length: 32 })
			.notNull()
			.references(() => calls.callReportNum, { onDelete: "cascade" }),

		dateOfCall: timestamp("date_of_call").notNull(),

		// Specific taxonomy leaf
		taxonomyCode: varchar("taxonomy_code", { length: 32 }),
		taxonomyName: varchar("taxonomy_name", { length: 256 }),

		// AIRS taxonomy hierarchy
		level1Name: varchar("level1_name", { length: 128 }),
		level2Code: varchar("level2_code", { length: 32 }),
		level2Name: varchar("level2_name", { length: 256 }),
		level3Code: varchar("level3_code", { length: 32 }),
		level3Name: varchar("level3_name", { length: 256 }),
		level4Code: varchar("level4_code", { length: 32 }),
		level4Name: varchar("level4_name", { length: 256 }),
		level5Code: varchar("level5_code", { length: 32 }),
		level5Name: varchar("level5_name", { length: 256 }),

		airsNeedCategory: varchar("airs_need_category", { length: 128 }),

		needWasUnmet: boolean("need_was_unmet").notNull(),
		reasonIfUnmet: varchar("reason_if_unmet", { length: 128 }),
	},
	(t) => [
		index("needs_call_report_num_idx").on(t.callReportNum),
		index("needs_date_of_call_idx").on(t.dateOfCall),
		index("needs_airs_category_idx").on(t.airsNeedCategory),
		index("needs_unmet_idx").on(t.needWasUnmet),
		index("needs_taxonomy_name_idx").on(t.taxonomyName),
	],
);

export type Need = typeof needs.$inferSelect;
export type NewNeed = typeof needs.$inferInsert;
