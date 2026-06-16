import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

const encoder = new Tiktoken(o200k_base);

export function countTokens(text: string): number {
	return encoder.encode(text).length;
}

const PRICING: Record<string, { input: number; output: number }> = {
	"gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
	"gpt-4o": { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
	"gpt-5": { input: 1.25 / 1_000_000, output: 10 / 1_000_000 },
};

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
	// Model ids may carry a gateway provider prefix (e.g. "openai/gpt-5"); the
	// pricing table is keyed by the bare model name.
	const key = model.replace(/^[^/]+\//, "");
	const pricing = PRICING[key] ?? PRICING["gpt-4o-mini"];
	return inputTokens * pricing.input + outputTokens * pricing.output;
}
