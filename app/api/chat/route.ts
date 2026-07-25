import { findRelevantContentForDomain, findRelevantContentForDomains } from "@/lib/ai/embedding";
import { getWidget } from "@/lib/actions/widgetConfigs";
import { countTokens, calculateCost } from "@/lib/ai/tokens";
import { addTurn } from "@/lib/actions/dev";
import { checkInputShape } from "@/lib/ai/inputShape";
import { env } from "@/lib/env.mjs";
import { checkBotId } from "botid/server";
import { CRISIS_TURN_CONTEXT, detectCrisis } from "@/lib/directory/crisis";
import { REFERRAL_PROMPT_SECTION } from "@/lib/directory/prompt";
import {
	createDirectoryTools,
	type DirectoryToolLog,
	type UserLocation,
} from "@/lib/directory/tools";
import { isValidCoords } from "@/lib/directory/geo";
import type { DevTurn } from "@/lib/types/dev";
import { nanoid } from "@/lib/utils";
import {
	convertToModelMessages,
	generateText,
	Output,
	stepCountIs,
	streamText,
	type UIMessage,
} from "ai";
import { z } from "zod";
import type { ChatSource } from "@/lib/types/chat";

// gpt-5 streams the final answer slower than 4o-mini, and resource-enabled
// widgets may take several tool steps before composing.
export const maxDuration = 120;

// Cheap model for internal retrieval-query generation.
const queryModel = "openai/gpt-4o-mini";
// Stronger model that composes the user-facing answer.
const composerModel = "openai/gpt-5";
// Max retrieved chunks surfaced to the model after cross-query dedup.
const TOP_K = 8;

const ALLOWED_ORIGINS = new Set(["https://www.unitedwaymerced.org", "https://www.211merced.org"]);

// Small JSON error helper for the early abuse-protection returns below.
function jsonError(status: number, message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { "content-type": "application/json" },
	});
}

// The widget runs in an iframe served by THIS app (public/widget.js points the
// iframe at `${origin}/widget/<id>`), so a legitimate chat POST always carries this
// app's own Origin — or one of the embedding sites in ALLOWED_ORIGINS, which are
// also permitted to call the endpoint cross-origin via CORS. A present but foreign
// Origin is a cross-site caller and is rejected. Absent Origins (non-browser
// callers) are left to the rate limit and per-widget token.
function originAllowed(req: Request): boolean {
	const origin = req.headers.get("origin");
	if (!origin) return true;
	if (ALLOWED_ORIGINS.has(origin)) return true;
	const allowed = new Set<string>();
	try {
		allowed.add(new URL(req.url).origin);
	} catch {}
	try {
		allowed.add(new URL(env.APP_URL).origin);
	} catch {}
	return allowed.has(origin);
}

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

	// NOTE: per-IP rate limiting for this endpoint lives in the Vercel WAF
	// ("Chat API Rate Limiting": path = /api/chat, 30 requests / 60s per IP -> 429),
	// not in this file. That rule blocks at the edge, so an abusive client never
	// reaches this function and costs no compute or model spend — strictly better
	// than checking here, where the function has already started.
	//
	// An earlier version called checkRateLimit() from @vercel/firewall. That SDK
	// exists for rate limits that need application context (upstream uses it to
	// exempt authenticated internal traffic). Every turn here is public and
	// anonymous, so there is no condition to express and the call was a redundant
	// network round-trip on every request.
	if (!originAllowed(req)) {
		return jsonError(403, "Forbidden");
	}

	const {
		messages,
		widgetId,
		widgetToken,
		userLocation: rawUserLocation,
	}: {
		messages: UIMessage[];
		widgetId?: string;
		widgetToken?: string;
		// Sent only after the visitor grants the browser permission prompt.
		userLocation?: { latitude?: number; longitude?: number };
	} = await req.json();

	if (!Array.isArray(messages) || messages.length === 0) {
		return new Response("Invalid messages", { status: 400 });
	}

	// Bot protection for the public widget: reject automated/scripted clients before any
	// work. The widget carries the BotID proof (from initBotId in instrumentation-client).
	// Fail open on any BotID error so an outage can't take down chat; local dev bypasses
	// to HUMAN.
	const isBot = await checkBotId()
		.then((v) => v.isBot)
		.catch(() => false);
	if (isBot) return jsonError(403, "Forbidden");

	const trimmedMessages = messages.slice(-MAX_MESSAGES);

	const lastUserText = getLastUserText(trimmedMessages);
	if (lastUserText.length > MAX_MESSAGE_LENGTH) {
		return new Response("Message too long", { status: 400 });
	}

	// Structural prefilter: empty, over-length, link-spam, or repetitive junk is
	// rejected with no network call at all, so a garbage turn spends nothing.
	const inputIssue = checkInputShape(lastUserText);
	if (inputIssue) {
		return jsonError(400, "Sorry, I can't process that message. Please rephrase your question.");
	}

	let domain: string;
	let widgetDomains: string[] | null = null;
	let resourceSearchEnabled = false;

	if (widgetId) {
		const widget = await getWidget(widgetId);
		if (!widget || !widget.enabled) {
			return new Response("Widget not found or disabled", { status: 404 });
		}
		// Per-widget token rendered by the widget page and echoed back here, so a
		// leaked or guessed widget id alone can't drive the bot. Not a secret (it
		// ships to the browser) — it's a revocable handle: rotate the row to cut off
		// an abused embed instead of taking the endpoint down.
		if (widgetToken !== widget.widgetToken) {
			return jsonError(403, "Forbidden");
		}
		widgetDomains = widget.domains;
		domain = `widget:${widgetId}`;
		resourceSearchEnabled = widget.enableResourceSearch;
	} else {
		domain = getDomainFromRequest(req) ?? "unknown";
	}

	const userText = lastUserText;

	// Deterministic crisis screen (resource-enabled widgets only): a hit tells
	// the client to render the static crisis card immediately, and the model
	// gets crisis context injected — it still answers (see lib/directory/crisis).
	const crisisDetected = resourceSearchEnabled && detectCrisis(userText);

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
${resourceSearchEnabled ? REFERRAL_PROMPT_SECTION : ""}${crisisDetected ? `\n${CRISIS_TURN_CONTEXT}\n` : ""}
Context:
${context || "(empty)"}
`;

	const turnId = nanoid();
	const startLlm = performance.now();
	const toolLog: DirectoryToolLog[] = [];

	// Validated here rather than trusted: a malformed or out-of-range pair is simply
	// ignored, and search falls back to whatever city the conversation established.
	const userLocation: UserLocation = isValidCoords(
		rawUserLocation?.latitude,
		rawUserLocation?.longitude,
	)
		? {
				latitude: rawUserLocation?.latitude as number,
				longitude: rawUserLocation?.longitude as number,
			}
		: null;

	const result = streamText({
		model: composerModel,
		messages: modelMessages,
		system: systemPrompt,
		...(resourceSearchEnabled
			? { tools: createDirectoryTools(toolLog, userLocation), stopWhen: stepCountIs(5) }
			: {}),
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
				// PRIVACY: record only THAT a location was shared, never the coordinates.
				// chat_turns is retained indefinitely and this widget serves people in
				// crisis — including domestic-violence callers, for whom a stored
				// precise location is a safety risk, not just a privacy one.
				referral: resourceSearchEnabled
					? { crisisDetected, toolCalls: toolLog, usedSharedLocation: userLocation !== null }
					: null,
			};

			await addTurn(turn);
		},
	});

	return result.toUIMessageStreamResponse({
		messageMetadata: ({ part }) => {
			if (part.type === "start") return { turnId, sources, crisis: crisisDetected || undefined };
		},
	});
}
