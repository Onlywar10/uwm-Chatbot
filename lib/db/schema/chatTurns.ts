import { sql } from "drizzle-orm";
import { index, jsonb, numeric, pgEnum, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { nanoid } from "@/lib/utils";

export const turnStatusEnum = pgEnum("turn_status", ["answered", "no-answer", "error"]);

export type LatencyJson = {
	total: number;
	queryGen: number;
	retrieval: number;
	llm: number;
};

export type TokensJson = {
	input: number;
	output: number;
};

export type RetrievalJson = {
	topK: number;
	chunksReturned: number;
	generatedQueries: string[];
	chunks: { content: string; similarity: number }[];
};

export type PromptJson = {
	system: string;
	userMessage: string;
};

export type TranslationJson = {
	detectedLang: string;
	wasTranslated: boolean;
};

export const chatTurns = pgTable(
	"chat_turns",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),

		timestamp: timestamp("timestamp").notNull().default(sql`now()`),

		domain: varchar("domain", { length: 255 }).notNull(),

		status: turnStatusEnum("status").notNull(),

		latency: jsonb("latency").$type<LatencyJson>().notNull(),

		model: varchar("model", { length: 100 }).notNull(),

		tokens: jsonb("tokens").$type<TokensJson>().notNull(),

		estimatedCost: numeric("estimated_cost", { precision: 10, scale: 6 }).notNull(),

		retrieval: jsonb("retrieval").$type<RetrievalJson>().notNull(),

		prompt: jsonb("prompt").$type<PromptJson>().notNull(),

		response: text("response").notNull(),

		translation: jsonb("translation").$type<TranslationJson>(),
	},
	(t) => [
		index("chat_turns_domain_idx").on(t.domain),
		index("chat_turns_timestamp_idx").on(t.timestamp),
	],
);
