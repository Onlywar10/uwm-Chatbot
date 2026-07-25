/**
 * Shape of a rejected input. Upstream carries a richer version alongside its
 * SafePrompt/OpenAI moderation module; we only run the structural checks below,
 * so the type is defined locally and stays dependency-free.
 */
export type BlockedResult = {
	allowed: false;
	reason: "content";
	threats: string[];
	categories: string[];
};

// Cheap, no-network structural guards on the raw input. These don't judge *meaning* —
// they only reject malformed or abusive input *shapes* before we spend a turn on them:
// empty, absurdly long, link-spam, or repetitive junk. Thresholds are conservative
// module constants, easy to tune. Kept free of env/network imports so it stays
// trivially unit-testable.
const MAX_INPUT_CHARS = 2000;
const MAX_URLS = 5;
const SPAM_MIN_LENGTH = 40;
const SPAM_MAX_UNIQUE_CHARS = 4;
const SPAM_MAX_CHAR_DOMINANCE = 0.6;
const SPAM_MIN_TOKENS = 8;
const SPAM_TOKEN_DOMINANCE = 0.5;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;

function inputBlock(category: string): BlockedResult {
	return { allowed: false, reason: "content", threats: [], categories: [category] };
}

// Conservative repetition/spam heuristic: extreme character monotony ("aaaa…",
// "abababab…") or a single token repeated until it dominates the message ("buy buy buy…").
// Every test is length-robust (tiny-alphabet absolute or fraction-of-total), so ordinary
// long prose — which always has a bounded alphabet and recurring stopwords — is NOT
// mistaken for spam.
function isRepetitiveSpam(text: string): boolean {
	if (text.length < SPAM_MIN_LENGTH) return false;

	const condensed = text.replace(/\s+/g, "");
	if (condensed.length >= SPAM_MIN_LENGTH) {
		const charFreq = new Map<string, number>();
		let maxCharFreq = 0;
		for (const ch of condensed) {
			const next = (charFreq.get(ch) ?? 0) + 1;
			charFreq.set(ch, next);
			if (next > maxCharFreq) maxCharFreq = next;
		}
		if (charFreq.size <= SPAM_MAX_UNIQUE_CHARS) return true;
		if (maxCharFreq / condensed.length >= SPAM_MAX_CHAR_DOMINANCE) return true;
	}

	const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length >= SPAM_MIN_TOKENS) {
		const tokenFreq = new Map<string, number>();
		let maxTokenFreq = 0;
		for (const token of tokens) {
			const next = (tokenFreq.get(token) ?? 0) + 1;
			tokenFreq.set(token, next);
			if (next > maxTokenFreq) maxTokenFreq = next;
		}
		if (maxTokenFreq / tokens.length >= SPAM_TOKEN_DOMINANCE) return true;
	}
	return false;
}

/**
 * Synchronous, no-network structural prefilter. Rejects input by *shape* — empty,
 * over-length, link-spam, or repetitive — returning a ready-to-use BlockedResult (so
 * callers reuse refusalMessage / the blocked-turn path) tagged with an input_* category,
 * or null to fall through to the async endpoint screening. Content judgement (hate,
 * self-harm, etc.) is left to the moderation endpoints.
 */
export function checkInputShape(text: string): BlockedResult | null {
	const trimmed = text.trim();
	if (!trimmed) return inputBlock("input_empty");
	if (trimmed.length > MAX_INPUT_CHARS) return inputBlock("input_too_long");
	const urls = trimmed.match(URL_PATTERN);
	if (urls && urls.length > MAX_URLS) return inputBlock("input_too_many_urls");
	if (isRepetitiveSpam(trimmed)) return inputBlock("input_spam");
	return null;
}
