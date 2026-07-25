/**
 * Drop non-phone values from directory_programs.phones.
 *
 * iCarol PhoneNumber contacts are free text, and authors put URLs and email
 * addresses in them — 74 of 2,078 entries in the live directory. Those rendered as
 * "Call https://www.facebook.com/…" with a tel: href built from digits scraped out
 * of the URL. lib/directory/transform.ts now filters at sync time; this cleans rows
 * already loaded, so it runs without the iCarol API key.
 *
 * Short codes are preserved on purpose: 9-1-1, 7-1-1, 2-1-1 and 898211 (text 211)
 * are legitimately dialable, so a length-based rule would have deleted real data.
 * See lib/directory/phone.ts.
 *
 *   pnpm exec tsx scripts/backfill-clean-phones.ts           # preview
 *   pnpm exec tsx scripts/backfill-clean-phones.ts --apply
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DirectoryPhone } from "@/lib/db/schema/directoryPrograms";
import { isDialable } from "@/lib/directory/phone";

type Row = { id: string; program_name: string; phones: DirectoryPhone[] | null };

async function main() {
	const apply = process.argv.includes("--apply");

	const res = await db.execute(
		sql`select id, program_name, phones from directory_programs order by program_name`,
	);
	const rows = res.rows as Row[];

	let changed = 0;
	let removed = 0;
	let emptied = 0;
	const samples: string[] = [];

	for (const row of rows) {
		const phones = row.phones ?? [];
		if (phones.length === 0) continue;

		const kept = phones.filter((p) => isDialable(p.number));
		if (kept.length === phones.length) continue;

		const dropped = phones.filter((p) => !isDialable(p.number));
		changed += 1;
		removed += dropped.length;
		if (kept.length === 0) emptied += 1;

		if (samples.length < 8) {
			samples.push(
				`   ${row.program_name}\n     dropped: ${dropped.map((d) => `[${d.label}] ${d.number.slice(0, 70)}`).join("; ")}\n     kept:    ${kept.length ? kept.map((k) => k.number).join(", ") : "(none — card will fall back to its website button)"}`,
			);
		}

		if (apply) {
			await db.execute(
				sql`update directory_programs set phones = ${JSON.stringify(kept)}::jsonb where id = ${row.id}`,
			);
		}
	}

	console.log(samples.join("\n\n"));
	console.log(
		`\n${apply ? "Applied" : "Dry run"}: ${removed} bad entr${removed === 1 ? "y" : "ies"} across ${changed} row(s); ${emptied} row(s) left with no phone.`,
	);
	if (!apply) console.log("Re-run with --apply to write.");
	process.exit(0);
}

main().catch((err) => {
	console.error("❌ failed:", err?.cause?.message ?? err?.message ?? err);
	process.exit(1);
});
