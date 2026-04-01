import { nanoid } from "@/lib/utils";
import { pgTable, text, varchar, integer, timestamp, unique, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./schools";

export const crawlSettings = pgTable(
	"crawl_settings",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),

		domain: varchar("domain", { length: 255 }).notNull(),
		useSitemaps: boolean("use_sitemaps").notNull(),
		ignoreRobots: boolean("ignore_robots").notNull(),
		dropAllQuery: boolean("drop_all_query").notNull(),
		maxCrawlDepth: integer("max_crawl_depth").notNull(),
		maxCrawlPages: integer("max_crawl_pages").notNull(),
		maxCharsPerPage: integer("max_chars_per_page").notNull(),
		urlsToIgnore: text("urls_to_ignore").array().default(sql`'{}'::text[]`).notNull(),
		pagesProcessed: integer("pages_processed").notNull().default(0),

		createdAt: timestamp("created_at").notNull().default(sql`now()`),

		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`now()`)
			.$onUpdateFn(() => new Date()),

		schoolId: varchar("school_id", { length: 191 })
			.notNull()
			.references(() => schools.id, { onDelete: "cascade" }),
	},
	(t) => [unique("crawl_settings_domain_unique").on(t.domain)],
);
