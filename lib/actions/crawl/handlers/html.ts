import parse from "node-html-parser";
import td from "../turndown";

// Elements removed before extracting page content. Grouped for maintainability.
const STRIP_SELECTORS = [
	// scripts / styling / non-rendered
	"script",
	"style",
	"noscript",
	"link",
	"template",
	// site chrome (kept out of per-page content; links are still used for crawl discovery)
	"nav",
	"header",
	"footer",
	// media — we don't embed images/media
	"iframe",
	"svg",
	"img",
	"picture",
	"source",
	"video",
	"audio",
	"canvas",
	"object",
	"embed",
	"track",
	"map",
	// form controls
	"input",
	"button",
	"select",
	"option",
	"textarea",
	"label",
	"form",
	"fieldset",
	// hidden / screen-reader-only (often duplicates visible text)
	"[hidden]",
	'[aria-hidden="true"]',
	".sr-only",
	".visually-hidden",
	// ARIA landmark chrome rendered as divs
	'[role="navigation"]',
	'[role="banner"]',
	'[role="contentinfo"]',
	'[role="search"]',
	'[role="dialog"]',
	'[role="menu"]',
	'[role="complementary"]',
	'[role="alert"]',
	"dialog",
	// Catapult dynamic widgets covered by live tools (announcements / calendar / staff directory)
	".ccms-contentelement-Announcement",
	".ccms-contentelement-GoogleCalendar",
	".ccms-contentelement-StaffDirectory",
	// Catapult layout noise
	".breadcrumbs-super",
	".ccms-spacer",
	".ccms-contentelement-Spacer",
	".title-link",
].join(", ");

function extractCategories(url: string, pageTitle?: string) {
	const segments = new URL(url).pathname
		.split("/")
		.filter(Boolean)
		.map((s) =>
			s
				.replace(/-/g, " ")
				.replace(/index\.html$/, "")
				.trim(),
		)
		.filter((s) => s.length > 0);

	return {
		topCategory: segments[0] ?? pageTitle ?? "",
		subCategory: segments[1] ?? "",
		pageCategory: segments[segments.length - 1] ?? pageTitle ?? "",
		fullPath: segments.length > 0 ? segments.join(" > ") : (pageTitle ?? ""),
	};
}

function cleanMarkdown(md: string) {
	return md
		.replace(/\r\n/g, "\n")
		.replace(/^(#{1,6})\s*\n+\s*(.+)$/gm, "$1 $2")
		.replace(/^(#{1,6})\s*\*\*(.*?)\*\*\s*$/gm, "$1 $2")
		.replace(/\n(#{1,6}\s)/g, "\n\n$1")
		.replace(/^\*\*([^*\n]+)\*\*$/gm, "## $1");
}

/**
 * Extracts the main content of an HTML page as cleaned Markdown — the exact text
 * that gets chunked and embedded. Shared by the crawler (processHtml) and the
 * /dev Renderer "Cleaned" view.
 */
export function cleanHtmlToMarkdown(html: string, url: string, maxCharsPerPage: number) {
	const root = parse(html);

	const title = root.querySelector("title")?.textContent.trim();
	const categories = extractCategories(url, title);

	for (const el of root.querySelectorAll(STRIP_SELECTORS) ?? []) {
		el.remove();
	}

	const container =
		root.querySelector(".content-area-main-column") ?? root.querySelector("main") ?? root;

	const md = td.turndown(container.innerHTML);
	const cleanedMd = cleanMarkdown(md).slice(0, maxCharsPerPage);

	return { content: cleanedMd, pageTitle: title, categories };
}

/**
 * Pulls the district's school directory (names + URLs) from the Catapult schools
 * dropdown in the site chrome. Returns Markdown, or null when the page has no
 * schools dropdown. Run against the raw HTML before stripping removes the chrome.
 */
export function extractSchoolDirectory(html: string): string | null {
	const root = parse(html);
	const dropdown = root.querySelector(".schools-dropdown");
	if (!dropdown) return null;

	const sections: string[] = [];
	const seen = new Set<string>();

	for (const titleEl of dropdown.querySelectorAll(".school-dropdown-title")) {
		const groupTitle = titleEl.textContent.trim();
		const group = titleEl.parentNode;
		if (!group) continue;

		const items: string[] = [];
		for (const anchor of group.querySelectorAll("a.dropdown-item")) {
			const name = anchor.textContent.trim().replace(/\s+/g, " ");
			const href = anchor.getAttribute("href");
			if (!name || !href || seen.has(href)) continue;
			seen.add(href);
			items.push(`- [${name}](${href})`);
		}

		if (items.length > 0) {
			sections.push(`## ${groupTitle}\n${items.join("\n")}`);
		}
	}

	if (sections.length > 0) return `# Schools\n\n${sections.join("\n\n")}`;

	// Fallback when the grouped titles aren't present (e.g. non-rendered HTML):
	// emit a flat list of the dropdown's links so the directory is still captured.
	const flat: string[] = [];
	for (const anchor of dropdown.querySelectorAll("a.dropdown-item")) {
		const name = anchor.textContent.trim().replace(/\s+/g, " ");
		const href = anchor.getAttribute("href");
		if (!name || !href || seen.has(href)) continue;
		seen.add(href);
		flat.push(`- [${name}](${href})`);
	}

	if (flat.length === 0) return null;
	return `# Schools\n\n${flat.join("\n")}`;
}

export const processHtml = async (url: string, response: Response, maxCharsPerPage: number) => {
	try {
		const html = await response.text();
		const { content, pageTitle, categories } = cleanHtmlToMarkdown(html, url, maxCharsPerPage);

		return {
			ok: true as const,
			content,
			pageTitle,
			url,
			categories,
		};
	} catch {
		return {
			ok: false as const,
			error: `Error parsing HTML page: ${url}`,
		};
	}
};
