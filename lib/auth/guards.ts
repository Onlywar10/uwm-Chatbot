import { auth } from "@clerk/nextjs/server";

// Identity is owned by Clerk. There is a single access level: any signed-in
// user may access every protected route. The middleware (proxy.ts) already
// enforces this at the edge; these guards are the server-side backstop for
// server actions and route handlers.

export async function requireAuth() {
	const { userId } = await auth();

	if (!userId) {
		throw new Error("Unauthorized");
	}

	return { userId };
}

// Role-agnostic: kept for call-site compatibility. The `role` argument is
// intentionally ignored — there are no role tiers in this version.
export async function requireRole(_role: "admin" | "crawler") {
	return requireAuth();
}
