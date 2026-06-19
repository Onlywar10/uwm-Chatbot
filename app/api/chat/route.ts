import { findRelevantContentForDomain, findRelevantContentForDomains } from "@/lib/ai/embedding";
import { getWidget } from "@/lib/actions/widgetConfigs";
import { countTokens, calculateCost } from "@/lib/ai/tokens";
import { addTurn } from "@/lib/actions/dev";
import type { DevTurn } from "@/lib/types/dev";
import { nanoid } from "@/lib/utils";
import { convertToModelMessages, generateText, Output, streamText, type UIMessage } from "ai";
import { z } from "zod";
import type { ChatSource } from "@/lib/types/chat";

// gpt-5 streams the final answer slower than 4o-mini, so allow more room.
export const maxDuration = 60;

// Cheap model for internal retrieval-query generation.
const queryModel = "openai/gpt-4o-mini";
// Stronger model that composes the user-facing answer.
const composerModel = "openai/gpt-5";
// Max retrieved chunks surfaced to the model after cross-query dedup.
const TOP_K = 8;

const ALLOWED_ORIGINS = new Set(["https://www.unitedwaymerced.org", "https://www.211merced.org"]);

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

type RetrievalHit = {
	name: string;
	similarity: number;
	sourceUrl?: string;
	metadata?: { pageTitle?: string };
};

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
		model: queryModel,
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
							`[#${i + 1} score=${hit.similarity.toFixed(3)}]\n` +
							`${hit.sourceUrl ? `[Source: ${hit.sourceUrl}]\n` : ""}${hit.name}`,
					)
					.join("\n\n---\n\n");

	// Dedup the retrieved pages by URL into a sources list for the UI (skip the
	// synthetic school-directory resource, which isn't a real page).
	const sources: ChatSource[] = Array.from(
		new Map(
			unique
				.filter((hit) => hit.sourceUrl && !hit.sourceUrl.endsWith("/__directory"))
				.map((hit) => [
					hit.sourceUrl as string,
					{
						url: hit.sourceUrl as string,
						title: hit.metadata?.pageTitle || (hit.sourceUrl as string),
					},
				]),
		).values(),
	);

	const systemPrompt = `You are a helpful assistant answering questions about topics relating to United Way of Merced and the 211 Merced community resource directory.

Rules:
- Answer the user's question using ONLY the Context below. Do not use outside knowledge and do not guess.
- Be a direct Q&A assistant, not an intake interview. Just answer the question from the Context. Do NOT ask the user to share their situation, eligibility, health plan, location, or other personal details as a prerequisite, and do not end replies offering to help "if you tell me more." If the Context covers several cases, briefly give the answer for each rather than asking which one applies.
- Only ask a clarifying question when the question is genuinely ambiguous AND you cannot give a useful answer from the Context for any reasonable reading of it. Default to answering.
- If the Context does not answer the question, START your reply with "Sorry," and briefly say what you could not find. Reserve a leading "Sorry," only for these no-answer cases, never as polite filler.
- When the user is looking for a page or resource (e.g. "where do I donate?", "the application form"), point them to it with a link. Only use links that appear in the Context (the page's own URL or links within it — internal pages or external resources); prefer the most specific one and do not invent URLs.

Formatting (your reply is rendered as markdown):
- Default to brief, natural prose in short paragraphs. This is a small chat window — keep it concise.
- Use a bullet list ("- ") ONLY when presenting 3 or more distinct items, resources, or steps. Never put normal explanatory sentences or a single item in a list.
- Use **bold** sparingly for a key name, phone number, or label. Use headings ("### ") only for a long, multi-section answer.
- When you reference a page, link to it ONCE as a clean descriptive markdown link, e.g. [Over the Edge details](https://example.org/overtheedge). Never paste raw URLs, and never include the literal "[Source: …]" labels from the Context in your reply — those are internal.

Context:
${context || "(empty)"}
`;

	const turnId = nanoid();
	const startLlm = performance.now();

	const result = streamText({
		model: composerModel,
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
				status: text.trimStart().startsWith("Sorry,") ? "no-answer" : "answered",
				latency: {
					total: Math.round(endTotal - startTotal),
					queryGen: Math.round(endQueryGen - startQueryGen),
					retrieval: Math.round(endRetrieval - startRetrieval),
					llm: Math.round(endTotal - startLlm),
				},
				model: composerModel,
				tokens: {
					input: inputTokens,
					output: outputTokens,
				},
				estimatedCost: calculateCost(composerModel, inputTokens, outputTokens),
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
			if (part.type === "start") return { turnId, sources };
		},
	});
}
