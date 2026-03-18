import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

import { nanoid } from "@/lib/utils";
import { chatTurns } from "./chatTurns";

export const feedbackSentimentEnum = pgEnum("feedback_sentiment", ["positive", "negative"]);

export const feedbackReasonEnum = pgEnum("feedback_reason", [
	"incorrect-information",
	"not-relevant",
	"too-vague",
	"missing-information",
	"other",
]);

export const chatFeedback = pgTable(
	"chat_feedback",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),

		chatTurnId: varchar("chat_turn_id", { length: 191 })
			.notNull()
			.references(() => chatTurns.id, { onDelete: "cascade" }),

		sentiment: feedbackSentimentEnum("sentiment").notNull(),

		reason: feedbackReasonEnum("reason"),

		createdAt: timestamp("created_at").notNull().default(sql`now()`),
	},
	(t) => [
		index("chat_feedback_turn_idx").on(t.chatTurnId),
		index("chat_feedback_sentiment_idx").on(t.sentiment),
		index("chat_feedback_created_idx").on(t.createdAt),
	],
);
