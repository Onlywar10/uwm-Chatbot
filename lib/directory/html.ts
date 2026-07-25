import TurndownService from "turndown";

/**
 * iCarol free-text fields contain author-entered HTML — measured across the live
 * directory: 232 <a> links, 51 <li>, 51 <br>, 27 <b>, 12 <ul>, plus the odd <mark>.
 * Rendering those raw leaks markup into the cards ("<ul> <li>Proof of address</li>").
 *
 * Stripping to plain text would be lossy in a way that matters: most of those tags
 * are LINKS to application forms and agency pages, which is exactly what someone
 * needs next. So convert to Markdown at sync time and render it, rather than
 * discarding structure or trusting raw HTML in the browser.
 *
 * Conversion happens server-side only (sync + backfill); the widget renders the
 * resulting Markdown, so no untrusted HTML ever reaches the DOM.
 */

const td = new TurndownService({
	headingStyle: "atx",
	bulletListMarker: "-",
	codeBlockStyle: "fenced",
});

// <mark> carries emphasis in iCarol entries (usually an important caveat like
// "documents drop-off only"). Keep the text, drop the tag — bold would overstate it
// in a small card.
td.addRule("unwrapInlineHighlight", {
	filter: ["mark", "span"],
	replacement: (content) => content,
});

// Anchors with no usable target are noise as links; keep just their text.
td.addRule("unwrapEmptyLinks", {
	filter: (node) => {
		if (node.nodeName !== "A") return false;
		const href = node.getAttribute("href") ?? "";
		return href === "" || href.startsWith("#") || href.startsWith("javascript:");
	},
	replacement: (content) => content,
});

const looksLikeHtml = (s: string) => /<[a-zA-Z/][^>]*>/.test(s) || /&[a-z]+;/i.test(s);

/**
 * HTML -> Markdown for a directory free-text field. Returns null for empty input,
 * and passes plain text through untouched so non-HTML fields are unaffected.
 */
export function htmlToMarkdown(raw: string | null | undefined): string | null {
	const input = raw?.trim();
	if (!input) return null;
	if (!looksLikeHtml(input)) return input;

	let md: string;
	try {
		md = td.turndown(input);
	} catch {
		// Never let a malformed fragment break a sync — fall back to tag-stripping.
		md = input.replace(/<[^>]+>/g, " ");
	}

	return (
		md
			// Turndown escapes characters that are markdown-significant; in short
			// prose fields that mostly produces noise like "9\-5" or "\$25".
			.replace(/\\([-_*[\]()#+.!$])/g, "$1")
			// Turndown pads list markers to a fixed width ("-   item"); collapse to a
			// single space, preserving indentation so nested lists still nest.
			.replace(/^(\s*)-[ \t]+/gm, "$1- ")
			.replace(/\n{3,}/g, "\n\n")
			.replace(/[ \t]+$/gm, "")
			.trim() || null
	);
}

/**
 * Markdown -> plain text, for the strings that feed embeddings. Link syntax and
 * bullet markers are noise in a vector, and a URL in the topic text actively hurts
 * discrimination.
 */
export function markdownToPlain(raw: string | null | undefined): string | null {
	const input = raw?.trim();
	if (!input) return null;
	return (
		input
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images -> alt
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> label
			.replace(/^\s{0,3}[-*+]\s+/gm, "") // bullets
			.replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
			.replace(/\*\*|__|[*_`]/g, "") // emphasis
			.replace(/\s+/g, " ")
			.trim() || null
	);
}
