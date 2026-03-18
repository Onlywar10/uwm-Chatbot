"use server";

import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatFeedback } from "@/lib/db/schema/chatFeedback";
import { chatTurns } from "@/lib/db/schema/chatTurns";
import { requireRole } from "@/lib/auth/guards";
import type {
	FeedbackSentiment,
	FeedbackReason,
	FeedbackFilters,
	FeedbackWithTurn,
	FeedbackStats,
} from "@/lib/types/feedback";

export async function submitFeedback(input: {
	chatTurnId: string;
	sentiment: FeedbackSentiment;
	reason?: FeedbackReason | null;
}): Promise<{ success: boolean }> {
	const [turn] = await db
		.select({ id: chatTurns.id })
		.from(chatTurns)
		.where(eq(chatTurns.id, input.chatTurnId))
		.limit(1);

	if (!turn) return { success: false };

	const [existing] = await db
		.select({ id: chatFeedback.id })
		.from(chatFeedback)
		.where(eq(chatFeedback.chatTurnId, input.chatTurnId))
		.limit(1);

	if (existing) {
		await db
			.update(chatFeedback)
			.set({
				sentiment: input.sentiment,
				reason: input.sentiment === "negative" ? (input.reason ?? null) : null,
			})
			.where(eq(chatFeedback.id, existing.id));
	} else {
		await db.insert(chatFeedback).values({
			chatTurnId: input.chatTurnId,
			sentiment: input.sentiment,
			reason: input.sentiment === "negative" ? (input.reason ?? null) : null,
		});
	}

	return { success: true };
}

function buildFilterConditions(filters?: FeedbackFilters): SQL | undefined {
	const conditions: SQL[] = [];
	if (filters?.domain) conditions.push(eq(chatTurns.domain, filters.domain));
	if (filters?.from) conditions.push(gte(chatFeedback.createdAt, new Date(filters.from)));
	if (filters?.to) conditions.push(lte(chatFeedback.createdAt, new Date(filters.to + "T23:59:59.999Z")));
	return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listFeedback(filters?: FeedbackFilters, limit = 50): Promise<FeedbackWithTurn[]> {
	await requireRole("admin");

	const where = buildFilterConditions(filters);

	const rows = await db
		.select({
			id: chatFeedback.id,
			chatTurnId: chatFeedback.chatTurnId,
			sentiment: chatFeedback.sentiment,
			reason: chatFeedback.reason,
			createdAt: chatFeedback.createdAt,
			domain: chatTurns.domain,
			userMessage: sql<string>`${chatTurns.prompt}->>'userMessage'`,
			response: chatTurns.response,
		})
		.from(chatFeedback)
		.innerJoin(chatTurns, eq(chatFeedback.chatTurnId, chatTurns.id))
		.where(where)
		.orderBy(desc(chatFeedback.createdAt))
		.limit(limit);

	return rows;
}

export async function getFeedbackStats(filters?: FeedbackFilters): Promise<FeedbackStats> {
	await requireRole("admin");

	const where = buildFilterConditions(filters);

	const totalsQuery = db
		.select({
			total: sql<number>`count(*)::int`,
			positive: sql<number>`count(*) filter (where ${chatFeedback.sentiment} = 'positive')::int`,
			negative: sql<number>`count(*) filter (where ${chatFeedback.sentiment} = 'negative')::int`,
		})
		.from(chatFeedback);

	if (where) {
		totalsQuery.innerJoin(chatTurns, eq(chatFeedback.chatTurnId, chatTurns.id)).where(where);
	}

	const [totals] = await totalsQuery;

	const reasonQuery = db
		.select({
			reason: chatFeedback.reason,
			count: sql<number>`count(*)::int`,
		})
		.from(chatFeedback);

	if (where) {
		reasonQuery
			.innerJoin(chatTurns, eq(chatFeedback.chatTurnId, chatTurns.id))
			.where(and(eq(chatFeedback.sentiment, "negative"), where));
	} else {
		reasonQuery.where(eq(chatFeedback.sentiment, "negative"));
	}

	const reasonRows = await reasonQuery.groupBy(chatFeedback.reason);

	return {
		total: totals?.total ?? 0,
		positive: totals?.positive ?? 0,
		negative: totals?.negative ?? 0,
		reasonBreakdown: reasonRows
			.filter((r) => r.reason !== null)
			.map((r) => ({ reason: r.reason!, count: r.count })),
	};
}

export async function getDistinctFeedbackDomains(): Promise<string[]> {
	await requireRole("admin");

	const rows = await db
		.selectDistinct({ domain: chatTurns.domain })
		.from(chatFeedback)
		.innerJoin(chatTurns, eq(chatFeedback.chatTurnId, chatTurns.id))
		.orderBy(chatTurns.domain);

	return rows.map((r) => r.domain);
}
