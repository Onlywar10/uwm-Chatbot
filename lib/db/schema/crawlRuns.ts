import { nanoid } from "@/lib/utils";
import {
	pgTable,
	text,
	varchar,
	integer,
	timestamp,
	jsonb,
	pgEnum,
	boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { crawlSettings, entityTypeEnum } from "./crawlSettings";
import type { CrawlSettingsSnapshot } from "@/lib/types/crawl";

export const crawlRunStatusEnum = pgEnum("crawl_run_status", ["running", "completed", "failure"]);

export const crawlRunType = pgEnum("crawl_run_type", ["crawl", "recrawl"]);

type RobotsRules = { allow: string[]; disallow: string[]; crawlDelay: number };

export const crawlRuns = pgTable("crawl_runs", {
	id: varchar("id", { length: 191 })
		.primaryKey()
		.$defaultFn(() => nanoid()),
	domain: varchar("domain", { length: 255 }).notNull(),
	startUrl: varchar("start_url", { length: 1024 }).notNull(),
	entityType: entityTypeEnum("entity_type").notNull(),
	entityId: varchar("entity_id", { length: 191 }).notNull(),
	status: crawlRunStatusEnum("status").default("running").notNull(),
	errorMessage: text("error_message"),
	pagesCrawled: integer("pages_crawled").default(0).notNull(),
	maxPages: integer("max_pages").notNull(),
	robots: jsonb("robots").$type<RobotsRules>().notNull(),
	crawlDelay: integer("crawl_delay").notNull(),
	crawlRunType: crawlRunType("crawl_run_type").notNull(),

	// Whether this run was seeded from a sitemap; when true we skip following
	// __catapult_pages global-link aliases (the sitemap already covers the site).
	usedSitemap: boolean("used_sitemap").notNull().default(false),

	settingsSnapshot: jsonb("settings_snapshot").$type<CrawlSettingsSnapshot>().notNull(),

	startedAt: timestamp("created_at").notNull().default(sql`now()`),

	completedAt: timestamp("updated_at")
		.notNull()
		.default(sql`now()`)
		.$onUpdateFn(() => new Date()),

	crawlSettingId: varchar("crawl_setting_id", { length: 191 })
		.notNull()
		.references(() => crawlSettings.id, { onDelete: "cascade" }),
});
