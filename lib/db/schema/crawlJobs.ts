import { nanoid } from "@/lib/utils";
import {
	pgTable,
	text,
	varchar,
	integer,
	numeric,
	timestamp,
	unique,
	pgEnum,
	jsonb,
	index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { crawlSettings } from "./crawlSettings";
import { resources } from "./resources";
import { crawlRuns } from "./crawlRuns";
import type { Metadata } from "@/lib/types/crawl";

export const crawlJobStatusEnum = pgEnum("crawl_job_status", ["pending", "success", "failure"]);

export const fileTypeEnum = pgEnum("file_type", ["html", "pdf", "doc", "api"]);

export const crawlJobTypeEnum = pgEnum("crawl_job_type", ["crawl", "recrawl"]);

type CrawlSettings = {
	maxDepth: number;
	maxPages: number;
	maxCharsPerPage: number;
	includeSitemapSeeds: boolean;
	ignoreRobots: boolean;
	dropAllQuery: boolean;
	renderJavascript: boolean;
	urlsToIgnore: string[];
};

export const crawlJobs = pgTable(
	"crawl_jobs",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),
		url: varchar("url", { length: 1024 }).notNull(),
		jobType: crawlJobTypeEnum("job_type").default("crawl").notNull(),
		depth: integer("depth").notNull(),
		status: crawlJobStatusEnum("status").default("pending").notNull(),
		errorMessage: text("error_message"),
		fileType: fileTypeEnum("file_type"),
		time: numeric("time"),

		settingsSnapshot: jsonb("settings_snapshot").$type<CrawlSettings>(),
		contentSnapshot: text("content_snapshot"),
		metadataSnapshot: jsonb("metadata_snapshot").$type<Metadata>(),

		createdAt: timestamp("created_at").notNull().default(sql`now()`),

		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`now()`)
			.$onUpdateFn(() => new Date()),

		crawlSettingId: varchar("crawl_setting_id", { length: 191 })
			.notNull()
			.references(() => crawlSettings.id, { onDelete: "cascade" }),

		crawlRunId: varchar("crawl_run_id", { length: 191 })
			.notNull()
			.references(() => crawlRuns.id, {
				onDelete: "cascade",
			}),

		resourceId: varchar("resource_id", { length: 191 }).references(() => resources.id, {
			onDelete: "cascade",
		}),
	},
	(t) => [
		unique("crawl_jobs_url_crawl_setting_id_run_unique").on(t.url, t.crawlSettingId, t.crawlRunId),
		index("crawl_run_status_idx").on(t.crawlRunId, t.status),
	],
);
