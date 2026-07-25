import { renderPage } from "@/lib/actions/crawl/renderPage";
import { assertUrlAllowed, SsrfError } from "@/lib/net/ssrf";
import { env } from "@/lib/env.mjs";

// Headless-Chromium renderer. The crawler (lib/actions/crawl/render.ts) calls
// this when a crawl setting has "Render JavaScript" enabled, so JS-injected
// content and links are captured. Browser launch/reuse lives in renderPage.
//
// Deploy note: set this function to the "Performance" size (4GB / 2 vCPU) in the
// Vercel dashboard (Settings -> Functions); Chromium needs the headroom.

export const maxDuration = 120;

export async function POST(request: Request) {
	// Fail closed: this endpoint renders arbitrary URLs via headless Chromium, so
	// it is a Server-Side Request Forgery vector if left open. Reject unless the
	// caller presents the shared renderer token (RENDERER_AUTH_TOKEN is required in
	// lib/env.mjs, so an unset token can never silently disable this check).
	const provided = request.headers.get("x-renderer-token");
	if (provided !== env.RENDERER_AUTH_TOKEN) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
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

		// Reject private/loopback/metadata targets up front with a clear 400 (renderPage
		// also guards, but this keeps an SSRF attempt from looking like a render failure).
		try {
			await assertUrlAllowed(url);
		} catch (err) {
			if (err instanceof SsrfError) {
				return Response.json({ error: "Blocked URL" }, { status: 400 });
			}
			throw err;
		}

		const html = await renderPage(url, { waitUntil, timeoutMs });
		return Response.json({ html }, { headers: { "x-render-outcome": "rendered" } });
	} catch (error) {
		// A render failure (Chromium timeout/crash/navigation error) is an expected,
		// recoverable outcome: the caller (renderHtml) falls back to the static fetch,
		// so the overall crawl transaction still succeeds. Returning 5xx here made a
		// crawl of un-renderable pages look like a server outage and tripped Vercel's
		// anomaly detector ("/api/render 502 errors"). Signal the failure with a 200 +
		// a custom header instead; renderHtml keys off `x-render-outcome`. A genuine
		// platform failure (function OOM / maxDuration) still surfaces as a real 5xx.
		return Response.json(
			{ html: null, error: error instanceof Error ? error.message : String(error) },
			{ status: 200, headers: { "x-render-outcome": "failed" } },
		);
	}
}
