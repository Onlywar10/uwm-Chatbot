import { nanoid } from "@/lib/utils";
import { pgTable, text, varchar, integer, numeric, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { crawlSettings } from "./crawlSettings";
import { resources } from "./resources";

export const crawlJobs = pgTable(
	"crawl_jobs",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),
		url: varchar("url", { length: 255 }).notNull(),
		depth: integer("depth").notNull(),
		status: text("status", { enum: ["pending", "success", "failure"] })
			.notNull()
			.default("pending"),
		errorMessage: text("error_message"),
		fileType: text("file_type", { enum: ["html", "pdf", "doc", "api"] }),
		time: numeric("time"),

		createdAt: timestamp("created_at").notNull().default(sql`now()`),

		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`now()`)
			.$onUpdateFn(() => new Date()),

		crawlSettingId: varchar("crawl_setting_id", { length: 191 })
			.notNull()
			.references(() => crawlSettings.id, { onDelete: "cascade" }),

		resourceId: varchar("resource_id", { length: 191 }).references(() => resources.id, {
			onDelete: "cascade",
		}),
	},
	(t) => [unique("crawl_jobs_url_crawl_setting_id_unique").on(t.url, t.crawlSettingId)],
);
