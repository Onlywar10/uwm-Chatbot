import { nanoid } from "@/lib/utils";
import { pgTable, text, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { crawlSettings } from "./crawlSettings";
import { crawlJobStatusEnum } from "./crawlJobs";

export const crawlSchedule = pgTable("crawl_schedule", {
	id: varchar("id", { length: 191 })
		.primaryKey()
		.$defaultFn(() => nanoid()),
	url: varchar("url", { length: 1024 }).notNull(),
	interval: integer("interval").notNull(),
	nextCrawlAt: timestamp("next_crawl_at").notNull(),
	lastCrawlAt: timestamp("last_crawl_at").notNull().default(sql`now()`),
	lastCrawlMethod: text("last_crawl_method", { enum: ["automatic", "manual"] }).notNull(),
	status: crawlJobStatusEnum("status").notNull().default("success"),
	errorMessage: text("error_message"),
	entityId: varchar("entity_id", { length: 191 }).notNull(),

	createdAt: timestamp("created_at").notNull().default(sql`now()`),

	updatedAt: timestamp("updated_at")
		.notNull()
		.default(sql`now()`)
		.$onUpdateFn(() => new Date()),

	crawlSettingId: varchar("crawl_setting_id", { length: 191 })
		.notNull()
		.references(() => crawlSettings.id, { onDelete: "cascade" }),
});
