import { findRelevantContentForDomain, findRelevantContentForDomains } from "@/lib/ai/embedding";
import { getWidget } from "@/lib/actions/widgetConfigs";
import { countTokens, calculateCost } from "@/lib/ai/tokens";
import { addTurn } from "@/lib/actions/dev";
import type { DevTurn } from "@/lib/types/dev";
import { nanoid } from "@/lib/utils";
import { convertToModelMessages, generateText, Output, streamText, type UIMessage } from "ai";
import { z } from "zod";

export const maxDuration = 30;

const chatModel = "openai/gpt-4o-mini";
const TOP_K = 4;

const ALLOWED_ORIGINS = new Set([
	"https://www.unitedwaymerced.org",
	"https://www.211merced.org",
]);

function getCorsHeaders(req: Request): Record<string, string> {
	const origin = req.headers.get("origin") ?? "";
	// Allow same-origin (widget iframe) and known external origins
	if (ALLOWED_ORIGINS.has(origin)) {
		return {
			"Access-Control-Allow-Origin": origin,
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		};
	}
	return {};
}

export async function OPTIONS(req: Request) {
	return new Response(null, { status: 204, headers: getCorsHeaders(req) });
}

type RetrievalHit = { name: string; similarity: number };

function getDomainFromRequest(req: Request): string | null {
	let devOverride = "";
	if (process.env.NODE_ENV !== "production") {
		const cookieHeader = req.headers.get("cookie") || "";
		const match = cookieHeader.match(/(?:^|;\s*)dev_referer=([^;]+)/);
		if (match) devOverride = decodeURIComponent(match[1]);
		if (!devOverride) devOverride = req.headers.get("x-dev-referer") ?? "";
	}

	const referer = devOverride || req.headers.get("referer") || "";
	if (!referer) return null;

	try {
		const url = new URL(referer);
		const segments = url.pathname.split("/").filter(Boolean);
		const prefix = segments.length > 0 ? `/${segments[0]}` : "";
		const host = url.hostname.toLowerCase();
		return prefix ? `${host}${prefix}` : host;
	} catch {
		return null;
	}
}

function getLastUserText(messages: UIMessage[]): string {
	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	if (!lastUser) return "";
	return lastUser.parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join(" ")
		.trim();
}

const retrievalQueriesSchema = z.object({
	queries: z
		.array(z.string())
		.min(1)
		.max(3)
		.describe("Up to 3 short search-style retrieval queries."),
});

const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2000;

export async function POST(req: Request) {
	const startTotal = performance.now();
	const { messages, widgetId }: { messages: UIMessage[]; widgetId?: string } = await req.json();

	if (!Array.isArray(messages) || messages.length === 0) {
		return new Response("Invalid messages", { status: 400 });
	}

	const trimmedMessages = messages.slice(-MAX_MESSAGES);

	const lastUserText = getLastUserText(trimmedMessages);
	if (lastUserText.length > MAX_MESSAGE_LENGTH) {
		return new Response("Message too long", { status: 400 });
	}

	let domain: string;
	let widgetDomains: string[] | null = null;

	if (widgetId) {
		const widget = await getWidget(widgetId);
		if (!widget || !widget.enabled) {
			return new Response("Widget not found or disabled", { status: 404 });
		}
		widgetDomains = widget.domains;
		domain = `widget:${widgetId}`;
	} else {
		domain = getDomainFromRequest(req) ?? "unknown";
	}

	const userText = lastUserText;

	const modelMessages = await convertToModelMessages(trimmedMessages);

	const startQueryGen = performance.now();
	const queryGen = await generateText({
		model: chatModel,
		system:
			"You generate retrieval queries for a website knowledge base. " + "Return ONLY valid JSON.",
		prompt:
			`User question:\n${userText}\n\n` +
			`Return a JSON object with this shape:\n` +
			`{"queries":["..."]}\n` +
			`Rules: 1 to 3 short search-style queries.`,
		output: Output.json(retrievalQueriesSchema),
	});
	const endQueryGen = performance.now();

	const parsed = retrievalQueriesSchema.safeParse(queryGen.output);
	const queries: string[] = parsed.success
		? parsed.data.queries
		: [userText].filter(Boolean).slice(0, 1);

	const startRetrieval = performance.now();
	const results: RetrievalHit[][] = await Promise.all(
		queries.map((query: string) =>
			widgetDomains
				? findRelevantContentForDomains(widgetDomains, query)
				: findRelevantContentForDomain(domain, query),
		),
	);
	const endRetrieval = performance.now();

	const flat: RetrievalHit[] = results
		.flat()
		.filter((hit: RetrievalHit) => typeof hit?.name === "string" && hit.name.length > 0);

	const unique: RetrievalHit[] = Array.from(
		new Map<string, RetrievalHit>(flat.map((hit: RetrievalHit) => [hit.name, hit])).values(),
	)
		.sort((a: RetrievalHit, b: RetrievalHit) => b.similarity - a.similarity)
		.slice(0, 8);

	const context =
		unique.length === 0
			? ""
			: unique
					.map(
						(hit: RetrievalHit, i: number) =>
							`[#${i + 1} score=${hit.similarity.toFixed(3)}]\n${hit.name}`,
					)
					.join("\n\n---\n\n");

	const systemPrompt = `You are a helpful assistant answering questions about topics relating to United Way of Merced.

    Rules:
    - Use the Context below to anwser a user's question to the best of your ability.
	- If all Context is irrevelvent to the user's question respond with Sorry I dont Know
    Context:
    ${context || "(empty)"}
    `;

	const turnId = nanoid();
	const startLlm = performance.now();

	const result = streamText({
		model: chatModel,
		messages: modelMessages,
		system: systemPrompt,
		onFinish: async ({ text }) => {
			const endTotal = performance.now();

			const inputTokens = countTokens(systemPrompt + userText);
			const outputTokens = countTokens(text);

			const turn: DevTurn = {
				id: turnId,
				timestamp: new Date(),
				domain,
				status: text.includes("Sorry, I don't know") ? "no-answer" : "answered",
				latency: {
					total: Math.round(endTotal - startTotal),
					queryGen: Math.round(endQueryGen - startQueryGen),
					retrieval: Math.round(endRetrieval - startRetrieval),
					llm: Math.round(endTotal - startLlm),
				},
				model: chatModel,
				tokens: {
					input: inputTokens,
					output: outputTokens,
				},
				estimatedCost: calculateCost(chatModel, inputTokens, outputTokens),
				retrieval: {
					topK: TOP_K,
					chunksReturned: unique.length,
					generatedQueries: queries,
					chunks: unique.map((hit) => ({
						content: hit.name,
						similarity: hit.similarity,
					})),
				},
				prompt: {
					system: systemPrompt,
					userMessage: userText,
				},
				response: text,
			};

			await addTurn(turn);
		},
	});

	return result.toUIMessageStreamResponse({
		messageMetadata: ({ part }) => {
			if (part.type === "start") return { turnId };
		},
	});
}
