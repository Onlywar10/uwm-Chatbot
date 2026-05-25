import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { env } from "@/lib/env.mjs";

/**
 * Resolves the analytics chat model.
 *
 * - With `OPENAI_API_KEY` set: talk to OpenAI directly via the provider,
 *   bypassing the AI Gateway. Useful for local dev when gateway credits are
 *   restricted. The "openai/" prefix is stripped for the provider.
 * - Otherwise: use the bare gateway string (production / Vercel OIDC), matching
 *   how the rest of the app calls models.
 *
 * Either way the calling code (streamText, tools, etc.) is unchanged — only the
 * model value differs.
 */
export function analyticsModel(): LanguageModel {
	if (env.OPENAI_API_KEY) {
		return openai(env.ANALYTICS_MODEL.replace(/^openai\//, ""));
	}
	return env.ANALYTICS_MODEL;
}
