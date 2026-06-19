import { renderPage } from "@/lib/actions/crawl/renderPage";
import { env } from "@/lib/env.mjs";

// Headless-Chromium renderer. The crawler (lib/actions/crawl/render.ts) calls
// this when a crawl setting has "Render JavaScript" enabled, so JS-injected
// content and links are captured. Browser launch/reuse lives in renderPage.
//
// Deploy note: set this function to the "Performance" size (4GB / 2 vCPU) in the
// Vercel dashboard (Settings -> Functions); Chromium needs the headroom.

export const maxDuration = 120;

export async function POST(request: Request) {
	if (env.RENDERER_AUTH_TOKEN) {
		const provided = request.headers.get("x-renderer-token");
		if (provided !== env.RENDERER_AUTH_TOKEN) {
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		}
	}

	try {
		const { url, waitUntil, timeoutMs } = (await request.json().catch(() => ({}))) as {
			url?: string;
			waitUntil?: "networkidle2";
			timeoutMs?: number;
		};

		if (!url || typeof url !== "string") {
			return Response.json({ error: "Missing 'url'" }, { status: 400 });
		}

		const html = await renderPage(url, { waitUntil, timeoutMs });
		return Response.json({ html });
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : String(error) },
			{ status: 502 },
		);
	}
}
