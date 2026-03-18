"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { verifyPassword } from "@/lib/auth/password";
import { createSession, deleteSession, SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema/users";

const loginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});

export async function login(input: { email: string; password: string }) {
	const parsed = loginSchema.safeParse(input);
	if (!parsed.success) {
		return { error: "Invalid email or password" };
	}

	const { email, password } = parsed.data;

	const result = await db
		.select({
			id: users.id,
			passwordHash: users.passwordHash,
			isActive: users.isActive,
		})
		.from(users)
		.where(eq(users.email, email))
		.limit(1);

	const user = result[0];

	if (!user) {
		return { error: "Invalid email or password" };
	}

	if (!user.isActive) {
		return { error: "Account is deactivated" };
	}

	const valid = await verifyPassword(password, user.passwordHash);
	if (!valid) {
		return { error: "Invalid email or password" };
	}

	const token = await createSession(user.id);
	const cookieStore = await cookies();
	cookieStore.set(SESSION_COOKIE_NAME, token, {
		path: "/",
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		maxAge: SESSION_DURATION_SECONDS,
	});

	return { success: true };
}

export async function logout() {
	const cookieStore = await cookies();
	const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

	if (token) {
		await deleteSession(token);
	}

	cookieStore.delete(SESSION_COOKIE_NAME);
	redirect("/login");
}
