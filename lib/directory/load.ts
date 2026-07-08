import { db } from "@/lib/db";
import { directoryPrograms, type NewDirectoryProgram } from "@/lib/db/schema/directoryPrograms";
import { sql } from "drizzle-orm";

// Rows carry a 1536-dim vector each, so batches stay small.
const CHUNK = 100;

/**
 * Transactional truncate-and-reload, mirroring lib/import/load.ts: each sync
 * is a full mirror of the source, so wipe-and-reinsert inside one transaction
 * is idempotent and can never leave a half-empty directory — a failed sync
 * rolls back to yesterday's data.
 */
export async function loadDirectory(rows: NewDirectoryProgram[]): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.execute(sql`TRUNCATE TABLE ${directoryPrograms}`);
		for (let i = 0; i < rows.length; i += CHUNK) {
			await tx.insert(directoryPrograms).values(rows.slice(i, i + CHUNK));
		}
	});
}
