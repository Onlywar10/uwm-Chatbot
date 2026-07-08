import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Cache of AIRS taxonomy terms resolved via the iCarol Taxonomy endpoint.
 * Grows incrementally across directory syncs (never truncated) so already-seen
 * codes cost no API calls. name/synonyms/definition feed the program
 * embedding text; path powers display like "Food > Food Pantries".
 */
export const directoryTaxonomy = pgTable("directory_taxonomy", {
	code: varchar("code", { length: 32 }).primaryKey(),
	name: text("name").notNull(),
	path: text("path"),
	definition: text("definition"),
	synonyms: text("synonyms").array().default(sql`'{}'::text[]`).notNull(),
	fetchedAt: timestamp("fetched_at").notNull().default(sql`now()`),
});

export type DirectoryTaxonomyTerm = typeof directoryTaxonomy.$inferSelect;
export type NewDirectoryTaxonomyTerm = typeof directoryTaxonomy.$inferInsert;
