import { nanoid } from "@/lib/utils";
import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { resources } from "./resources";
import { sql } from "drizzle-orm";

export const parentChunks = pgTable("parent_chunks", {
	id: varchar("id", { length: 191 })
		.primaryKey()
		.$defaultFn(() => nanoid()),
	source_url: varchar("source_url", { length: 1024 }).notNull(),
	content: text("content").notNull(),
	createdAt: timestamp("created_at").notNull().default(sql`now()`),

	resourceId: varchar("resource_id", { length: 191 })
		.notNull()
		.references(() => resources.id, { onDelete: "cascade" }),
});
