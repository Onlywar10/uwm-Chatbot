import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

import { analyticsModel } from "@/lib/analytics/model";
import { buildSystemPrompt } from "@/lib/analytics/prompt";
import { logAnalyticsTurn } from "@/lib/analytics/telemetry";
import { createAnalyticsTools, type ToolLog } from "@/lib/analytics/tools";
import { requireRole } from "@/lib/auth/guards";
import { env } from "@/lib/env.mjs";

export const maxDuration = 60;

const MAX_MESSAGES = 20;

function getLastUserText(messages: UIMessage[]): string {
	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	if (!lastUser) return "";
	return lastUser.parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join(" ")
		.trim();
}

export async function POST(req: Request) {
	try {
		await requireRole("admin");
	} catch {
		return new Response("Unauthorized", { status: 401 });
	}

	const { messages }: { messages: UIMessage[] } = await req.json();
	if (!Array.isArray(messages) || messages.length === 0) {
		return new Response("Invalid messages", { status: 400 });
	}

	const trimmed = messages.slice(-MAX_MESSAGES);
	const question = getLastUserText(trimmed);
	const toolLog: ToolLog[] = [];
	const start = performance.now();
	const modelMessages = await convertToModelMessages(trimmed);

	const result = streamText({
		model: analyticsModel(),
		system: buildSystemPrompt(),
		messages: modelMessages,
		tools: createAnalyticsTools(toolLog),
		stopWhen: stepCountIs(5),
		onFinish: async ({ text, usage }) => {
			await logAnalyticsTurn({
				question,
				response: text,
				toolLog,
				model: env.ANALYTICS_MODEL,
				latencyMs: Math.round(performance.now() - start),
				usage: { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens },
			});
		},
	});

	return result.toUIMessageStreamResponse();
}
