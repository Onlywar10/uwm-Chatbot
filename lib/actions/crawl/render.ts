import { env } from "@/lib/env.mjs";

// Renders via the internal /api/render function by default; RENDERER_URL can
// point elsewhere (e.g. an external renderer) without touching crawl code.
const RENDERER_URL = env.RENDERER_URL || `${env.APP_URL}/api/render`;

/**
 * Fetches fully-rendered HTML for a URL by delegating to the headless-Chromium
 * renderer (see `app/api/render/route.ts`).
 *
 * The only contract is `POST { url } -> { html }`, so the renderer host can
 * change without touching crawl code. Throws on any failure so callers can fall
 * back to the static fetch.
 */
export async function renderHtml(url: string): Promise<string> {
	const response = await fetch(RENDERER_URL, {
		method: "POST",
		cache: "no-store",
		headers: {
			"content-type": "application/json",
			...(env.RENDERER_AUTH_TOKEN ? { "x-renderer-token": env.RENDERER_AUTH_TOKEN } : {}),
			// Bypass Vercel Deployment Protection on preview deployments, the same
			// way publishCrawlJob reaches /api/crawl. Without this the crawler's
			// internal call to /api/render is rejected with 401 before it runs.
			...(env.VERCEL_AUTOMATION_BYPASS_SECRET
				? { "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET }
				: {}),
		},
		body: JSON.stringify({ url }),
	});

	if (!response.ok) {
		throw new Error(`Renderer returned HTTP ${response.status} for ${url}`);
	}

	const data = (await response.json()) as { html?: string };
	if (!data.html) {
		throw new Error(`Renderer returned no html for ${url}`);
	}

	return data.html;
}
