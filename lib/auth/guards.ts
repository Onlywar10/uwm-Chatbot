import { cookies } from "next/headers";

import { validateSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function requireAuth() {
	const cookieStore = await cookies();
	const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

	if (!token) {
		throw new Error("Unauthorized");
	}

	const user = await validateSession(token);
	if (!user) {
		cookieStore.delete(SESSION_COOKIE_NAME);
		throw new Error("Unauthorized");
	}

	return user;
}

export async function requireRole(role: "admin" | "crawler") {
	const user = await requireAuth();

	if (user.role !== role) {
		throw new Error("Forbidden");
	}

	return user;
}
