import { eq, and, gt } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";

import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema/sessions";
import { users } from "@/lib/db/schema/users";

export const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;
const SESSION_DURATION_MS = SESSION_DURATION_SECONDS * 1000;

export const SESSION_COOKIE_NAME = "session_token";

export function generateSessionToken(): string {
	return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
	const token = generateSessionToken();
	const tokenHash = hashToken(token);
	const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

	await db.insert(sessions).values({
		tokenHash,
		userId,
		expiresAt,
	});

	return token;
}

export async function validateSession(token: string) {
	const tokenHash = hashToken(token);

	const result = await db
		.select({
			sessionId: sessions.id,
			userId: users.id,
			email: users.email,
			role: users.role,
			isActive: users.isActive,
			expiresAt: sessions.expiresAt,
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(
			and(
				eq(sessions.tokenHash, tokenHash),
				gt(sessions.expiresAt, new Date()),
			),
		)
		.limit(1);

	const row = result[0];
	if (!row) return null;
	if (!row.isActive) return null;

	return {
		sessionId: row.sessionId,
		userId: row.userId,
		email: row.email,
		role: row.role,
	};
}

export async function deleteSession(token: string): Promise<void> {
	const tokenHash = hashToken(token);
	await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}
