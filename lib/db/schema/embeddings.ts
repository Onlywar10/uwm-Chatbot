import { nanoid } from "@/lib/utils";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, varchar, vector } from "drizzle-orm/pg-core";
import { resources } from "./resources";
import { parentChunks } from "./parentChunks";
import type { Metadata } from "@/lib/types/crawl";

export const embeddings = pgTable(
	"embeddings",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),
		domain: varchar("domain", { length: 255 }).notNull(),
		content: text("content").notNull(),
		metadata: jsonb("metadata").$type<Metadata>().notNull(),
		embedding: vector("embedding", { dimensions: 1536 }).notNull(),

		parentId: varchar("parent_id", { length: 191 })
			.notNull()
			.references(() => parentChunks.id, { onDelete: "cascade" }),

		resourceId: varchar("resource_id", { length: 191 })
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),

		createdAt: timestamp("created_at").notNull().default(sql`now()`),
	},
	(t) => [
		index("embeddingIndex").using("hnsw", t.embedding.op("vector_cosine_ops")),
		index("embeddings_domain_idx").on(t.domain),
		index("parent_chunk_id").on(t.parentId),
	],
);
