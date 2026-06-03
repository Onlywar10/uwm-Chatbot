import { sql } from "drizzle-orm";
import { integer, pgTable, timestamp, unique, varchar } from "drizzle-orm/pg-core";

import { nanoid } from "@/lib/utils";

/**
 * Per-field data-availability windows, recomputed on every import. Lets the
 * analytics tools warn honestly when a query's date range falls outside the
 * window a question was actually collected in (e.g. Language only exists from
 * Oct-2025; Health Insurance was retired then). "Active vs retired" is derived
 * at read time by comparing `maxDate` to the global latest date.
 */
export const fieldCoverage = pgTable(
	"field_coverage",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),

		tableName: varchar("table_name", { length: 64 }).notNull(),
		field: varchar("field", { length: 128 }).notNull(),

		minDate: timestamp("min_date"),
		maxDate: timestamp("max_date"),
		nonNullCount: integer("non_null_count").notNull(),
		totalCount: integer("total_count").notNull(),

		computedAt: timestamp("computed_at").notNull().default(sql`now()`),
	},
	(t) => [unique("field_coverage_table_field_unique").on(t.tableName, t.field)],
);

export type FieldCoverage = typeof fieldCoverage.$inferSelect;
export type NewFieldCoverage = typeof fieldCoverage.$inferInsert;
