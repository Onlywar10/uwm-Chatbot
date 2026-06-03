import { index, pgTable, varchar } from "drizzle-orm/pg-core";

import { nanoid } from "@/lib/utils";
import { needs } from "./needs";

/**
 * One row per agency a need was referred to (source: unmet & met CSV).
 * A single need can produce many referral rows (one per agency). The source
 * row has no stable key, so we mint a synthetic id; counting referral rows is
 * `count_referrals`, counting distinct needs is `count_needs`.
 */
export const referrals = pgTable(
	"referrals",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),

		reportNeedNum: varchar("report_need_num", { length: 32 })
			.notNull()
			.references(() => needs.reportNeedNum, { onDelete: "cascade" }),

		resourceAgencyNum: varchar("resource_agency_num", { length: 32 }),
		agencyNamePublic: varchar("agency_name_public", { length: 512 }),
		parentResourceNum: varchar("parent_resource_num", { length: 32 }),
		parentAgencyName: varchar("parent_agency_name", { length: 512 }),
	},
	(t) => [
		index("referrals_report_need_num_idx").on(t.reportNeedNum),
		index("referrals_agency_name_idx").on(t.agencyNamePublic),
	],
);

export type Referral = typeof referrals.$inferSelect;
export type NewReferral = typeof referrals.$inferInsert;
