import { nanoid } from "@/lib/utils";
import {
	pgTable,
	text,
	varchar,
	boolean,
	integer,
	timestamp,
	unique,
	pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const entityTypeEnum = pgEnum("entity_type", ["district", "school"]);

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
		renderJavascript: boolean("render_javascript").notNull().default(false),
		// When true, ignore maxCrawlDepth/maxCrawlPages and crawl the whole domain
		// until the link frontier is exhausted (URL dedup guarantees termination).
		crawlAllPages: boolean("crawl_all_pages").notNull().default(false),
		maxCrawlDepth: integer("max_crawl_depth").notNull(),
		maxCrawlPages: integer("max_crawl_pages").notNull(),
		maxCharsPerPage: integer("max_chars_per_page").notNull(),
		urlsToIgnore: text("urls_to_ignore").array().default(sql`'{}'::text[]`).notNull(),
		entityType: entityTypeEnum("entity_type").notNull(),
		entityId: varchar("entity_id", { length: 191 }).notNull(),

		createdAt: timestamp("created_at").notNull().default(sql`now()`),

		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`now()`)
			.$onUpdateFn(() => new Date()),
	},
	(t) => [unique("crawl_settings_domain_unique").on(t.domain)],
);
