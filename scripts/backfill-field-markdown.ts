/**
 * Convert author-entered HTML in directory free-text fields to Markdown.
 *
 * iCarol stores raw HTML in eligibility / fees / applicationProcess /
 * requiredDocumentation, which leaked into the cards as literal markup
 * ("<ul> <li>Proof of address</li>"). lib/directory/transform.ts now converts at
 * sync time; this applies the same conversion to rows already loaded, so it runs
 * without the iCarol API key.
 *
 * Idempotent: htmlToMarkdown passes non-HTML through unchanged, so re-running is a
 * no-op. Dry-run by default.
 *
 *   pnpm exec tsx scripts/backfill-field-markdown.ts           # preview
 *   pnpm exec tsx scripts/backfill-field-markdown.ts --apply
 *
 * NOTE: description feeds the topic embedding, so re-run
 * `pnpm exec tsx scripts/backfill-topic-embeddings.ts` afterwards if any
 * description rows change (it detects the change itself and re-embeds only those).
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { htmlToMarkdown } from "@/lib/directory/html";

const FIELDS = [
	"eligibility",
	"fees",
	"application_process",
	"required_documentation",
	"languages",
	"description",
] as const;

type Row = Record<string, string | null> & { id: string; program_name: string };

async function main() {
	const apply = process.argv.includes("--apply");

	const res = await db.execute(
		sql`select id, program_name, eligibility, fees, application_process,
		           required_documentation, languages, description
		    from directory_programs order by program_name`,
	);
	const rows = res.rows as Row[];

	let changedRows = 0;
	let changedFields = 0;
	const samples: string[] = [];

	for (const row of rows) {
		const updates: { field: string; value: string | null }[] = [];
		for (const field of FIELDS) {
			const before = row[field];
			if (!before) continue;
			const after = htmlToMarkdown(before);
			if (after !== before) updates.push({ field, value: after });
		}
		if (updates.length === 0) continue;

		changedRows += 1;
		changedFields += updates.length;
		if (samples.length < 5) {
			const u = updates[0];
			samples.push(
				`   ${row.program_name} [${u.field}]\n     before: ${String(row[u.field]).slice(0, 110)}\n     after:  ${String(u.value).slice(0, 110)}`,
			);
		}

		if (apply) {
			for (const u of updates) {
				await db.execute(
					sql`update directory_programs set ${sql.identifier(u.field)} = ${u.value} where id = ${row.id}`,
				);
			}
		}
	}

	console.log(samples.join("\n\n"));
	console.log(
		`\n${apply ? "Applied" : "Dry run"}: ${changedFields} field(s) across ${changedRows} row(s) of ${rows.length}.`,
	);
	if (!apply) console.log("Re-run with --apply to write.");
	process.exit(0);
}

main().catch((err) => {
	console.error("❌ failed:", err?.cause?.message ?? err?.message ?? err);
	process.exit(1);
});
