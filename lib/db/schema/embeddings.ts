import { nanoid } from "@/lib/utils";
import { index, pgTable, text, varchar, vector } from "drizzle-orm/pg-core";
import { resources } from "./resources";

export const embeddings = pgTable(
	"embeddings",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),

		resourceId: varchar("resource_id", { length: 191 })
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),

		domain: varchar("domain", { length: 255 }).notNull(),
		content: text("content").notNull(),

		embedding: vector("embedding", { dimensions: 1536 }).notNull(),
	},
	(t) => [
		index("embeddingIndex").using("hnsw", t.embedding.op("vector_cosine_ops")),
		index("embeddings_domain_idx").on(t.domain),
	],
);
