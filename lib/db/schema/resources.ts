import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";

import { nanoid } from "@/lib/utils";
import { crawlSettings } from "./crawlSettings";
import { schools } from "./schools";

export const resources = pgTable(
	"resources",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),

		domain: varchar("domain", { length: 255 }).notNull(),
		url: varchar("url", { length: 1024 }).notNull(),

		content: text("content").notNull(),

		contentHash: varchar("content_hash", { length: 64 }).notNull(),

		createdAt: timestamp("created_at").notNull().default(sql`now()`),

		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`now()`)
			.$onUpdateFn(() => new Date()),

		crawlSettingId: varchar("crawl_setting_id", { length: 191 })
			.notNull()
			.references(() => crawlSettings.id, { onDelete: "cascade" }),

		schoolId: varchar("school_id", { length: 191 })
			.notNull()
			.references(() => schools.id),
	},
	(t) => [
		unique("resources_domain_url_unique").on(t.domain, t.url),
		index("resources_domain_idx").on(t.domain),
	],
);

export const insertResourceSchema = createInsertSchema(resources).omit({
	id: true,
	createdAt: true,
	updatedAt: true,
});

export type NewResourceParams = z.infer<typeof insertResourceSchema>;
