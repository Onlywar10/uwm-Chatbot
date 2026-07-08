import { openai } from "@ai-sdk/openai";
import { env } from "@/lib/env.mjs";
import { embed, type EmbeddingModel } from "ai";

/**
 * Same gateway-vs-direct resolution as lib/analytics/model.ts: with
 * OPENAI_API_KEY set (local dev) talk to OpenAI directly, else use the bare
 * gateway string like the rest of the app. Must match the model used at sync
 * time — query and row vectors live in the same space.
 */
export function embeddingModel(): EmbeddingModel {
	if (env.OPENAI_API_KEY) return openai.textEmbeddingModel("text-embedding-3-small");
	return "text-embedding-3-small";
}

/** Embed a user's need description for similarity search against directory rows. */
export async function embedNeed(need: string): Promise<number[]> {
	const { embedding } = await embed({
		model: embeddingModel(),
		value: need.trim().replace(/\s+/g, " "),
	});
	return embedding;
}
