import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public surface that must work WITHOUT a Clerk session: the sign-in page, the
// embedded chat widget + its API, and the QStash crawl webhook.
const isPublicRoute = createRouteMatcher([
	"/sign-in(.*)",
	"/api/chat(.*)",
	"/api/crawl(.*)",
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
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		// Always run for API routes.
		"/(api|trpc)(.*)",
	],
};
