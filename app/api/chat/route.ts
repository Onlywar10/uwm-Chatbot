import { findRelevantContentForDomain } from "@/lib/ai/embedding";
import { countTokens, calculateCost } from "@/lib/ai/tokens";
import { addTurn } from "@/lib/actions/dev";
import type { DevTurn } from "@/lib/types/dev";
import { nanoid } from "@/lib/utils";
import {
	convertToModelMessages,
	generateText,
	Output,
	streamText,
	type UIMessage,
} from "ai";
import { z } from "zod";

export const maxDuration = 30;

const chatModel = "gpt-4o-mini";
const TOP_K = 4;

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

export async function POST(req: Request) {
	const startTotal = performance.now();
	const { messages }: { messages: UIMessage[] } = await req.json();

	const domain = getDomainFromRequest(req) ?? "unknown";
	const userText = getLastUserText(messages);

	const modelMessages = await convertToModelMessages(messages);

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
		queries.map((query: string) => findRelevantContentForDomain(domain, query)),
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

	const systemPrompt = `You are a helpful assistant answering questions about the website content.

    Rules:
    - Use ONLY the Context below.
    - If the Context does not contain the answer, respond exactly: "Sorry, I don't know."
    - Do not guess. Do not use outside knowledge.

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
