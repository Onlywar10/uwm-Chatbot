import "server-only";

import { CRAWLER_USER_AGENT } from "../crawlDefaults";
import { assertUrlAllowed, SsrfError } from "@/lib/net/ssrf";

// A crawl talks to arbitrary, often flaky, third-party web servers. A bare
// fetch() has no timeout (it can hang until the QStash 120s wall) and no retry
// (a single transient 5xx / 429 / network blip permanently drops that page until
// the next scheduled crawl, which can be two weeks away). This wrapper adds a
// per-attempt timeout and bounded exponential backoff so transient failures
// recover within the same job.

export type FetchRetryOptions = {
	/** Abort a single attempt after this many ms. */
	timeoutMs?: number;
	/** Extra attempts after the first (so retries:2 = up to 3 requests). */
	retries?: number;
	/** Base for exponential backoff between attempts. */
	baseDelayMs?: number;
};

// Retry only on transient conditions; 4xx (other than 408/425/429) are the
// server telling us the request itself is wrong, so retrying is pointless.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffMs(base: number, attempt: number, res?: Response): number {
	// Honor Retry-After (seconds) when the server provides it (common on 429/503).
	const retryAfter = res?.headers.get("retry-after");
	if (retryAfter) {
		const secs = Number(retryAfter);
		if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 30_000);
	}
	const exp = base * 2 ** attempt;
	return Math.min(exp + Math.random() * base, 30_000); // full jitter, capped
}

export async function fetchWithRetry(
	url: string,
	init: RequestInit = {},
	opts: FetchRetryOptions = {},
): Promise<Response> {
	const { timeoutMs = 25_000, retries = 2, baseDelayMs = 500 } = opts;
	let lastError: unknown;

	// SSRF guard: reject the target before connecting (private/loopback/metadata
	// addresses, non-http(s) schemes). Redirects are auto-followed by fetch, so the
	// final URL is re-checked after each response below.
	await assertUrlAllowed(url);

	// Self-identify to the target server. Merge so a caller-supplied User-Agent
	// (or any other header) still wins.
	const headers = new Headers(init.headers);
	if (!headers.has("user-agent")) headers.set("user-agent", CRAWLER_USER_AGENT);

	for (let attempt = 0; attempt <= retries; attempt++) {
		// Per-attempt timeout, combined with any caller-supplied signal.
		const timeoutSignal = AbortSignal.timeout(timeoutMs);
		const signal = init.signal
			? AbortSignal.any([init.signal, timeoutSignal])
			: timeoutSignal;

		try {
			const res = await fetch(url, { ...init, headers, signal });
			if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
				await sleep(backoffMs(baseDelayMs, attempt, res));
				continue;
			}
			// A redirect chain could land on an internal host; re-check the final URL.
			if (res.redirected) await assertUrlAllowed(res.url);
			return res;
		} catch (err) {
			// A blocked address is a hard failure, not a transient one — don't retry it.
			if (err instanceof SsrfError) throw err;
			// Network error or per-attempt timeout (AbortError): retry while we can.
			lastError = err;
			if (attempt < retries) {
				await sleep(backoffMs(baseDelayMs, attempt));
			}
		}
	}

	throw lastError instanceof Error ? lastError : new Error(`fetch failed: ${url}`);
}
