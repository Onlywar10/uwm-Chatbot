import { db } from "@/lib/db";
import { analyticsTurns } from "@/lib/db/schema/analyticsTurns";
import type { ToolLog } from "./tools";

export type TurnUsage = { inputTokens?: number; outputTokens?: number };

export type TurnRecord = {
	question: string;
	response: string;
	toolLog: ToolLog[];
	model: string;
	latencyMs: number;
	usage?: TurnUsage;
};

/**
 * Records one analytics turn. Status is inferred: a turn that called no tools
 * is treated as a clarifying/declined turn. Best-effort — logging failures must
 * not break the user's response.
 */
export async function logAnalyticsTurn(record: TurnRecord): Promise<void> {
	try {
		const hadError = record.toolLog.some((t) => t.error);
		const status = hadError ? "error" : record.toolLog.length > 0 ? "answered" : "clarify";
		await db.insert(analyticsTurns).values({
			status,
			question: record.question,
			response: record.response,
			toolCalls: record.toolLog,
			model: record.model,
			latencyMs: record.latencyMs,
			tokens: {
				input: record.usage?.inputTokens ?? 0,
				output: record.usage?.outputTokens ?? 0,
			},
			estimatedCost: "0",
		});
	} catch (err) {
		console.error("Failed to log analytics turn:", err);
	}
}
