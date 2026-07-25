/**
 * Compute the focused topic embedding for every directory row.
 *
 * See lib/db/schema/directoryPrograms.ts for why a second, narrower embedding
 * exists. This backfills it from columns already in the database, so it does not
 * need the iCarol API. Safe to re-run: rows whose topic_text is unchanged keep
 * their existing vector and cost nothing.
 *
 *   pnpm exec tsx scripts/backfill-topic-embeddings.ts
 */
import { embedMany } from "ai";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { embeddingModel } from "@/lib/directory/embedding";
import { buildTopicText } from "@/lib/directory/transform";

const BATCH = 200;

type Row = {
	id: string;
	program_name: string;
	taxonomy_names: string[] | null;
	description: string | null;
	topic_text: string | null;
};

async function main() {
	// Columns are added by hand because this repo's migrations folder is stale and a
	// full drizzle push would try to reconcile unrelated drift. Both are idempotent.
	await db.execute(sql`alter table directory_programs add column if not exists topic_text text`);
	await db.execute(
		sql`alter table directory_programs add column if not exists topic_embedding vector(1536)`,
	);

	const res = await db.execute(
		sql`select id, program_name, taxonomy_names, description, topic_text
		    from directory_programs order by id`,
	);
	const rows = res.rows as Row[];

	const pending: { id: string; text: string }[] = [];
	for (const r of rows) {
		const text = buildTopicText({
			programName: r.program_name,
			taxonomy: r.taxonomy_names ?? [],
			description: r.description,
		});
		if (text !== r.topic_text) pending.push({ id: r.id, text });
	}

	console.log(`${rows.length} rows, ${pending.length} need embedding.`);
	if (pending.length === 0) {
		console.log("✅ nothing to do.");
		process.exit(0);
	}

	let done = 0;
	for (let i = 0; i < pending.length; i += BATCH) {
		const batch = pending.slice(i, i + BATCH);
		const { embeddings } = await embedMany({
			model: embeddingModel(),
			values: batch.map((b) => b.text),
		});
		for (let j = 0; j < batch.length; j++) {
			const vec = `[${embeddings[j].join(",")}]`;
			await db.execute(
				sql`update directory_programs
				    set topic_text = ${batch[j].text}, topic_embedding = ${vec}::vector
				    where id = ${batch[j].id}`,
			);
		}
		done += batch.length;
		console.log(`   embedded ${done}/${pending.length}`);
	}

	const check = await db.execute(
		sql`select count(*) filter (where topic_embedding is null)::int missing,
		    count(*)::int total from directory_programs`,
	);
	console.log(`✅ done. ${JSON.stringify(check.rows[0])}`);
	process.exit(0);
}

main().catch((err) => {
	console.error("❌ failed:", err?.cause?.message ?? err?.message ?? err);
	process.exit(1);
});
