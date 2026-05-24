import { sql } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";

import { nanoid } from "@/lib/utils";

export const analyticsTurnStatusEnum = pgEnum("analytics_turn_status", [
	"answered",
	"clarify",
	"no-data",
	"error",
]);

export type ToolCallLog = { tool: string; input: unknown; rowCount?: number };
export type TokensJson = { input: number; output: number };

/**
 * Telemetry for the internal analytics chat. The tool-call log is the most
 * valuable artifact: it records which tools the model chose and with what
 * params, which is how we debug wrong answers and decide when to extend the
 * glossary.
 */
export const analyticsTurns = pgTable(
	"analytics_turns",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),

		timestamp: timestamp("timestamp").notNull().default(sql`now()`),

		status: analyticsTurnStatusEnum("status").notNull(),

		question: text("question").notNull(),
		response: text("response").notNull(),

		toolCalls: jsonb("tool_calls").$type<ToolCallLog[]>().notNull(),
		coverageFlags: jsonb("coverage_flags").$type<string[]>(),

		model: varchar("model", { length: 100 }).notNull(),
		latencyMs: integer("latency_ms").notNull(),
		tokens: jsonb("tokens").$type<TokensJson>().notNull(),
		estimatedCost: numeric("estimated_cost", { precision: 10, scale: 6 }).notNull(),
	},
	(t) => [index("analytics_turns_timestamp_idx").on(t.timestamp)],
);

export type AnalyticsTurn = typeof analyticsTurns.$inferSelect;
export type NewAnalyticsTurn = typeof analyticsTurns.$inferInsert;
