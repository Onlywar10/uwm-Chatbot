import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public surface that must work WITHOUT a Clerk session: the sign-in page, the
// embedded chat widget + its API, the QStash crawl webhook, the headless-render
// endpoint (guarded by RENDERER_AUTH_TOKEN), and the hourly crawl cron (guarded
// by CRON_SECRET).
// NOTE: match ALL of /api/cron, not individual cron routes. Enumerating them meant a
// newly added cron (/api/cron/directory-sync) was silently intercepted by Clerk before
// its own CRON_SECRET check could run, so the Vercel cron never executed. Each cron
// route authenticates itself with a bearer token and fails closed when the secret is
// unset — that is the real guard; this entry only lets the request reach it.
const isPublicRoute = createRouteMatcher([
	"/sign-in(.*)",
	"/api/chat(.*)",
	"/api/crawl(.*)",
	"/api/render(.*)",
	"/api/cron(.*)",
	"/widget(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
	if (!isPublicRoute(req)) {
		// Send signed-out users to our in-app /sign-in page, never Clerk's
		// hosted Account Portal (which would ignore our redirect config).
		await auth.protect({
			unauthenticatedUrl: new URL("/sign-in", req.url).toString(),
		});
	}
});

export const config = {
	matcher: [
		// Skip Next.js internals and static files unless found in search params.
		// Also skip /widget entirely: it's the public, cross-site-embedded chat
		// iframe. clerkMiddleware() runs a dev-browser "handshake" 307 redirect on
		// every matched route (independent of route protection), which navigates
		// the iframe to clerk.accounts.dev — a different origin that can't be
		// framed and needs third-party cookies (blocked cross-site on iOS) — so
		// the embedded widget renders blank. Excluding it keeps Clerk off the
		// public surface entirely.
		"/((?!_next|widget|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		// Always run for API routes.
		"/(api|trpc)(.*)",
	],
};
