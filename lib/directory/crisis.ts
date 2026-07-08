/**
 * Deterministic crisis keyword screen, run BEFORE the model on resource-enabled
 * widgets. A hit instantly renders the static crisis card client-side (via the
 * `crisis` message metadata flag) while the model still answers with crisis
 * context injected — so a false positive ("volunteering at a suicide hotline")
 * still gets its real answer, just with the card above it. Paraphrases the
 * keywords miss are covered by the prompt-level backstop in prompt.ts.
 *
 * Keep patterns high-precision: matching too eagerly makes the card noise.
 */
const CRISIS_PATTERNS: RegExp[] = [
	// Suicide / self-harm
	/\bsuicid/i,
	/\bkill(?:ing)?\s+myself\b/i,
	/\bend(?:ing)?\s+my\s+(?:own\s+)?life\b/i,
	/\b(?:want|going|ready)\s+to\s+die\b/i,
	/\bdon'?t\s+want\s+to\s+(?:live|be\s+alive)\b/i,
	/\bhurt(?:ing)?\s+myself\b/i,
	/\bself[-\s]?harm/i,
	// Violence / abuse happening to the person
	/\bdomestic\s+violence\b/i,
	/\b(?:being|getting)\s+abused\b/i,
	/\babusing\s+me\b/i,
	/\b(?:hits?|beats?|hitting|beating)\s+me\b/i,
	/\bafraid\s+for\s+my\s+(?:life|safety)\b/i,
	/\b(?:raped?|sexual(?:ly)?\s+assault)/i,
	/\bhuman\s+trafficking\b/i,
	// Acute danger
	/\boverdos/i,
	/\bunsafe\s+at\s+home\b/i,
];

export function detectCrisis(text: string): boolean {
	if (!text) return false;
	return CRISIS_PATTERNS.some((p) => p.test(text));
}

/**
 * Injected into the system prompt for the turn when the keyword screen fired.
 * The card (with 988 / 911 / the local numbers) is already on screen — the
 * model's job is warmth plus still answering whatever else was asked.
 */
export const CRISIS_TURN_CONTEXT = `CRISIS NOTE FOR THIS TURN: The user's message triggered the crisis screen, and a card with crisis numbers (911, 988 Suicide & Crisis Lifeline, 2-1-1) is ALREADY displayed above your reply. Do not repeat those numbers. Respond with warmth first — acknowledge what they shared and gently encourage using those lines for immediate help. If the message was actually about something routine (e.g. volunteering, research, a friend's past experience), briefly answer it normally after a caring first sentence.`;
