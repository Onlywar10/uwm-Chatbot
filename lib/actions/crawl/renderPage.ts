import type { Browser } from "puppeteer-core";
import { env } from "@/lib/env.mjs";

// Headless-Chromium render core, shared by the /api/render route (called by the
// crawler) and the /dev Renderer tester (called in-process).
//
// Dual path:
//   - On Vercel: @sparticuz/chromium-min + a remote Chromium tar (the full
//     binary exceeds the 250MB function bundle limit). The binary is Linux-only.
//   - Locally (incl. Windows): the full `puppeteer` devDependency with its own
//     cross-platform bundled Chrome, so `next dev` works off-Linux.
// Selection is by process.env.VERCEL.

// Default to the Sparticuz release CDN for the installed chromium-min version
// (149.0.0). Assets are architecture-specific; Vercel functions are x64. Override
// with CHROMIUM_PACK_URL to self-host (e.g. Vercel Blob).
const DEFAULT_CHROMIUM_PACK_URL =
	"https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

const DEFAULT_WAIT_UNTIL = "networkidle2" as const;
const DEFAULT_TIMEOUT_MS = 45_000;
const VIEWPORT = { width: 1280, height: 800 };
const BLOCKED_RESOURCES = new Set(["image", "media", "font"]);

// Reuse the browser across warm invocations to avoid relaunching per request.
let browserPromise: Promise<Browser> | null = null;

async function launchBrowser(): Promise<Browser> {
	if (process.env.VERCEL) {
		const chromium = (await import("@sparticuz/chromium-min")).default;
		const puppeteer = (await import("puppeteer-core")).default;
		return puppeteer.launch({
			args: chromium.args,
			defaultViewport: VIEWPORT,
			executablePath: await chromium.executablePath(
				env.CHROMIUM_PACK_URL || DEFAULT_CHROMIUM_PACK_URL,
			),
			headless: true,
		});
	}

	// Local dev: full puppeteer with its bundled Chrome (cross-platform).
	const puppeteer = (await import("puppeteer")).default;
	const browser = await puppeteer.launch({ headless: true, defaultViewport: VIEWPORT });
	return browser as unknown as Browser;
}

async function getBrowser(): Promise<Browser> {
	if (browserPromise) {
		const existing = await browserPromise;
		if (existing.connected) return existing;
		browserPromise = null;
	}
	browserPromise = launchBrowser();
	return browserPromise;
}

/**
 * Renders `url` in headless Chromium and returns the fully-rendered HTML.
 * Throws on navigation/launch failure.
 */
export async function renderPage(
	url: string,
	opts?: { waitUntil?: typeof DEFAULT_WAIT_UNTIL; timeoutMs?: number },
): Promise<string> {
	const browser = await getBrowser();
	const page = await browser.newPage();

	try {
		// Skip assets we never extract text from — a big render-time win.
		await page.setRequestInterception(true);
		page.on("request", (req) => {
			if (BLOCKED_RESOURCES.has(req.resourceType())) req.abort();
			else req.continue();
		});

		await page.goto(url, {
			waitUntil: opts?.waitUntil ?? DEFAULT_WAIT_UNTIL,
			timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		});
		return await page.content();
	} finally {
		await page.close().catch(() => {});
	}
}
