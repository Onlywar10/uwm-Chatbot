"use server";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatTurns } from "@/lib/db/schema/chatTurns";
import type { DevTurn } from "@/lib/types/dev";
import { requireRole } from "@/lib/auth/guards";

// Server actions for dev turn logging - can be called from client components

export async function addTurn(turn: DevTurn): Promise<void> {
	await db.insert(chatTurns).values({
		id: turn.id,
		timestamp: turn.timestamp,
		domain: turn.domain,
		status: turn.status,
		latency: turn.latency,
		model: turn.model,
		tokens: turn.tokens,
		estimatedCost: turn.estimatedCost.toString(),
		retrieval: turn.retrieval,
		prompt: turn.prompt,
		response: turn.response,
		translation: turn.translation,
	});
}

export async function listTurns(limit = 50): Promise<DevTurn[]> {
	await requireRole("admin");
	const rows = await db.select().from(chatTurns).orderBy(desc(chatTurns.timestamp)).limit(limit);

	return rows.map((row) => ({
		id: row.id,
		timestamp: row.timestamp,
		domain: row.domain,
		status: row.status,
		latency: row.latency,
		model: row.model,
		tokens: row.tokens,
		estimatedCost: Number.parseFloat(row.estimatedCost),
		retrieval: row.retrieval,
		prompt: row.prompt,
		response: row.response,
		translation: row.translation ?? undefined,
	}));
}

export async function getTurn(id: string): Promise<DevTurn | null> {
	await requireRole("admin");
	const rows = await db.select().from(chatTurns).where(eq(chatTurns.id, id)).limit(1);

	if (rows.length === 0) return null;

	const row = rows[0];
	return {
		id: row.id,
		timestamp: row.timestamp,
		domain: row.domain,
		status: row.status,
		latency: row.latency,
		model: row.model,
		tokens: row.tokens,
		estimatedCost: Number.parseFloat(row.estimatedCost),
		retrieval: row.retrieval,
		prompt: row.prompt,
		response: row.response,
		translation: row.translation ?? undefined,
	};
}

export async function clearTurns(): Promise<void> {
	await requireRole("admin");
	await db.delete(chatTurns);
}
