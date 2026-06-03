import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema/calls";
import { fieldCoverage, type NewFieldCoverage } from "@/lib/db/schema/fieldCoverage";
import { needs } from "@/lib/db/schema/needs";
import { referrals } from "@/lib/db/schema/referrals";
import type { ParsedData } from "./parse";

const CHUNK = 1000;

async function chunked<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>): Promise<void> {
	for (let i = 0; i < rows.length; i += CHUNK) {
		await insert(rows.slice(i, i + CHUNK));
	}
}

/**
 * Transactional truncate-and-reload. Each export is full history, so wiping and
 * reinserting in one transaction is idempotent by construction — no upsert or
 * drift handling. Insert order respects FKs: calls -> needs -> referrals.
 */
export async function load(data: ParsedData, coverage: NewFieldCoverage[]): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.execute(sql`TRUNCATE TABLE ${referrals}, ${needs}, ${calls}, ${fieldCoverage}`);
		await chunked(data.calls, (batch) => tx.insert(calls).values(batch));
		await chunked(data.needs, (batch) => tx.insert(needs).values(batch));
		await chunked(data.referrals, (batch) => tx.insert(referrals).values(batch));
		await chunked(coverage, (batch) => tx.insert(fieldCoverage).values(batch));
	});
}
