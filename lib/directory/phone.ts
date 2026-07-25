/**
 * Phone-number validation for directory contact details.
 *
 * iCarol's PhoneNumber contacts are free text, and authors put non-phone values in
 * them — measured across the live directory, 74 of 2,078 entries are URLs or email
 * addresses (a Facebook page, a BenefitsCal link, an intake email). Rendering those
 * produced a "Call https://www.facebook.com/..." button whose tel: href dialled the
 * digits scraped out of the URL.
 *
 * The obvious guard — require 10 digits — would be wrong here. The directory
 * legitimately carries short codes that people genuinely dial or text: 9-1-1, 7-1-1
 * (TTY relay), 2-1-1, and 898211 (text-to-211). Those must stay callable, so
 * validation keys off "does this contain anything that isn't a phone number"
 * rather than length alone.
 */

// "ext 5001", "x5001", "ext. 5001", "#5001" — trailing extension, not part of the
// dialable number.
const EXTENSION = /[\s,;]*(?:ext(?:ension)?\.?|x|#)[\s.:]*(\d+)\s*$/i;
const URL_OR_EMAIL = /(https?:\/\/|www\.|\S+@\S+\.)/i;

export type SplitPhone = { base: string; extension: string | null };

/** Separates a trailing extension from the dialable part. */
export function splitExtension(raw: string): SplitPhone {
	const trimmed = raw.trim();
	const m = trimmed.match(EXTENSION);
	if (!m) return { base: trimmed, extension: null };
	return { base: trimmed.slice(0, m.index).trim(), extension: m[1] };
}

/**
 * Is this something a person can actually dial?
 *
 * Rejects URLs, email addresses, and any residual letters (an author writing
 * "call the office" or pasting a link). Accepts 3-15 digits so emergency and
 * information short codes survive alongside full numbers.
 */
export function isDialable(raw: string | null | undefined): boolean {
	const value = raw?.trim();
	if (!value) return false;
	if (URL_OR_EMAIL.test(value)) return false;

	const { base } = splitExtension(value);
	if (!base) return false;
	// Anything alphabetic left in the dialable part means it is not a number.
	// (Vanity numbers like 1-800-FLOWERS are absent from this directory; if they
	// ever appear they would need translating, not passing through.)
	if (/[a-z]/i.test(base)) return false;

	const digits = base.replace(/\D/g, "");
	return digits.length >= 3 && digits.length <= 15;
}

/**
 * `tel:` href for a number, or null when it isn't dialable.
 *
 * The extension is deliberately excluded: stripping non-digits from
 * "209-385-3000 ext 5001" previously produced tel:20938530005001, which dials a
 * wrong number. Callers should display the extension as text instead.
 */
export function toTelHref(raw: string | null | undefined): string | null {
	if (!isDialable(raw)) return null;
	const { base } = splitExtension((raw as string).trim());
	const plus = base.trimStart().startsWith("+") ? "+" : "";
	return `tel:${plus}${base.replace(/\D/g, "")}`;
}
