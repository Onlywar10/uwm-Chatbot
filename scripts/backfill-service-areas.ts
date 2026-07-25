/**
 * Backfill service_areas for directory rows that iCarol gave no coverage[] for.
 *
 * Search prefilters with `arrayOverlaps(service_areas, tokens)`, and an empty array
 * overlaps nothing — so these rows are unreachable by every query. That hid 8% of the
 * directory, including every cooling center in Merced and Mariposa counties.
 *
 * lib/directory/transform.ts now derives the same fallback at sync time
 * (fallbackAreaTokens), so this only needs running once against rows loaded before
 * that fix. Safe and idempotent: it only touches rows that still have no tokens, and
 * only ones with a usable address.
 *
 *   pnpm exec tsx scripts/backfill-service-areas.ts [--apply]
 *
 * Without --apply it reports what it would change and exits.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const CITY_TO_COUNTY: Record<string, string> = {
	atwater: "merced",
	ballico: "merced",
	cressey: "merced",
	delhi: "merced",
	"dos palos": "merced",
	"south dos palos": "merced",
	"el nido": "merced",
	gustine: "merced",
	"santa nella": "merced",
	hilmar: "merced",
	"le grand": "merced",
	livingston: "merced",
	"los banos": "merced",
	merced: "merced",
	planada: "merced",
	snelling: "merced",
	stevinson: "merced",
	winton: "merced",
	mariposa: "mariposa",
	"catheys valley": "mariposa",
	"cathey's valley": "mariposa",
	coulterville: "mariposa",
	"greeley hill": "mariposa",
	"el portal": "mariposa",
	"fish camp": "mariposa",
	hornitos: "mariposa",
	midpines: "mariposa",
	wawona: "mariposa",
	"yosemite national park": "mariposa",
};

type Row = { id: string; program_name: string; city: string | null; county: string | null };

async function main() {
	const apply = process.argv.includes("--apply");

	const res = await db.execute(
		sql`select id, program_name, city, county from directory_programs
		    where array_length(service_areas, 1) is null
		    order by program_name`,
	);
	const rows = res.rows as Row[];

	let updated = 0;
	let skipped = 0;
	for (const row of rows) {
		const city = row.city?.trim().toLowerCase() || null;
		// Prefer the row's own county; fall back to the city map for rows that have a
		// city but no county recorded.
		const county = row.county?.trim().toLowerCase() || (city ? CITY_TO_COUNTY[city] : null) || null;

		const tokens: string[] = [];
		if (city) tokens.push(`city:${city}`);
		if (county) tokens.push(`county:${county}`);

		if (tokens.length === 0) {
			skipped += 1;
			console.log(`   – skip (no address): ${row.program_name}`);
			continue;
		}

		if (apply) {
			// Build an explicit ARRAY[...] literal — a bare JS array binds as a record,
			// not text[], and Postgres rejects the assignment.
			const literal = sql.join(
				tokens.map((t) => sql`${t}`),
				sql`, `,
			);
			await db.execute(
				sql`update directory_programs set service_areas = ARRAY[${literal}]::text[] where id = ${row.id}`,
			);
		}
		updated += 1;
		console.log(`   ${apply ? "✓" : "would"} ${row.program_name} -> ${tokens.join(", ")}`);
	}

	console.log(
		`\n${apply ? "Applied" : "Dry run"}: ${updated} row(s) ${apply ? "updated" : "would be updated"}, ${skipped} skipped (no usable address).`,
	);
	if (!apply) console.log("Re-run with --apply to write.");
	process.exit(0);
}

main().catch((err) => {
	console.error("❌ backfill failed:", err?.cause?.message ?? err?.message ?? err);
	process.exit(1);
});
