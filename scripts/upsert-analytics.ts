/**
 * One-off idempotent UPSERT of the 211 analytics tables from the curated CSVs.
 *
 * Unlike `pnpm db:import` (which TRUNCATEs and reloads), this preserves rows
 * already in the DB that are absent from the new export — used when an export's
 * window has moved forward and no longer covers the earliest history (e.g. the
 * 2026-07 export starts at 2022 and would otherwise drop 2021 from Neon).
 *
 *   calls   — upsert by call_report_num
 *   needs   — upsert by report_need_num
 *   referrals — no natural key, so refreshed per-need: delete every referral
 *               whose need appears in the new file, then re-insert
 *   field_coverage — recomputed from the FULL post-upsert DB, not just the file
 *   caller_key (optional, --raw) — pseudonymous repeat-caller identity, enriched
 *               from the RAW iCarol CallReports export: reads ONLY CallReportNum +
 *               PhoneNumberFull, hashes the normalized phone (salted SHA-256,
 *               16 hex chars), and never touches any other PII column. The raw
 *               phone number is never stored anywhere.
 *
 * Usage: pnpm exec tsx scripts/upsert-analytics.ts \
 *          --calls <master.csv> --referrals <unmet_met.csv> \
 *          [--raw <iCarolExport-...-CallReports-*.csv>]
 *
 * NOTE: `pnpm db:import` (truncate-reload) wipes caller_key — re-run this with
 * --raw afterwards if you ever use it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { parse } from "csv-parse/sync";
import { getTableColumns, inArray, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema/calls";
import { needs } from "@/lib/db/schema/needs";
import { referrals } from "@/lib/db/schema/referrals";
import { Canonicalizer } from "@/lib/import/canonicalize";
import { parseSources } from "@/lib/import/parse";

const CHUNK = 1000;

async function chunked<T>(rows: T[], fn: (batch: T[]) => Promise<unknown>): Promise<void> {
	for (let i = 0; i < rows.length; i += CHUNK) await fn(rows.slice(i, i + CHUNK));
}

function getArg(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * ON CONFLICT DO UPDATE SET for every column except the primary key.
 * Keys must be the Drizzle JS property names (camelCase); values reference the
 * incoming row via `excluded.<db_column>`.
 */
function updateAllExcept(table: PgTable, pkColumn: string): Record<string, unknown> {
	const set: Record<string, unknown> = {};
	for (const [key, col] of Object.entries(getTableColumns(table))) {
		if (col.name === pkColumn) continue;
		set[key] = sql`excluded.${sql.identifier(col.name)}`;
	}
	return set;
}

const CALL_COVERAGE_FIELDS = [
	"caller_key",
	"language_canonical",
	"tele_interpretation_used",
	"ethnicity_canonical",
	"gender_canonical",
	"age_numeric",
	"health_insurance",
	"has_children_0_5",
	"children_under_5_count",
	"seniors_60_plus_count",
	"city",
	"county",
	"postal_code",
];
const NEED_COVERAGE_FIELDS = ["airs_need_category", "reason_if_unmet"];

/**
 * Fixed salt for the caller identity hash. NEVER change it — keys must stay
 * stable across imports or the same caller would get a new identity. The hash
 * (salted SHA-256 of the normalized phone, truncated) is pseudonymous: it
 * supports "same caller" comparisons without storing the number itself.
 */
const CALLER_KEY_SALT = "uwm211-caller-key-v1";

function callerKeyOf(phone: string): string | null {
	let digits = phone.replace(/\D/g, "");
	if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
	if (digits.length < 10) return null;
	return createHash("sha256").update(`${CALLER_KEY_SALT}:${digits}`).digest("hex").slice(0, 16);
}

/**
 * Reads the RAW iCarol CallReports export and returns CallReportNum → caller_key.
 * Only CallReportNum and PhoneNumberFull are ever read; the file's other ~264
 * columns (names, addresses, narratives — heavy PII) are discarded unparsed.
 * iCarol exports have a 2-line banner before the real header row.
 */
function parseCallerKeys(rawPath: string): Map<string, string> {
	const body = readFileSync(rawPath, "utf8").split(/\r?\n/).slice(2).join("\n");
	const rows: Record<string, string>[] = parse(body, {
		columns: true,
		bom: true,
		skip_empty_lines: true,
		relax_quotes: true,
		relax_column_count: true,
	});
	const keys = new Map<string, string>();
	for (const r of rows) {
		const id = (r.CallReportNum ?? "").trim();
		const key = callerKeyOf(r.PhoneNumberFull ?? "");
		if (id && key) keys.set(id, key);
	}
	return keys;
}

/** Batch-apply caller keys: UPDATE ... FROM (VALUES ...) in chunks. */
async function applyCallerKeys(
	// biome-ignore lint/suspicious/noExplicitAny: transaction handle
	tx: any,
	keys: Map<string, string>,
): Promise<void> {
	const entries = [...keys.entries()];
	await chunked(entries, async (batch) => {
		const values = sql.join(
			batch.map(([id, key]) => sql`(${id}, ${key})`),
			sql`, `,
		);
		await tx.execute(sql`
			update calls set caller_key = v.key
			from (values ${values}) as v(id, key)
			where calls.call_report_num = v.id and calls.caller_key is distinct from v.key
		`);
	});
}

/**
 * Recompute the canonical columns from the raw columns for EVERY row in calls,
 * using the current maps in lib/data/canonical-maps.ts. The CSV upsert only
 * touches rows present in the file — rows outside its window (e.g. 2021) would
 * otherwise keep canonical values from an older map version. One UPDATE per
 * distinct raw value (a few dozen), so this is cheap and idempotent.
 */
async function recanonicalizeAll(
	// biome-ignore lint/suspicious/noExplicitAny: transaction handle
	tx: any,
): Promise<void> {
	const canon = new Canonicalizer();
	const columns = [
		{ field: "ethnicity" as const, raw: "ethnicity_raw", canonical: "ethnicity_canonical" },
		{ field: "gender" as const, raw: "gender_raw", canonical: "gender_canonical" },
		{ field: "language" as const, raw: "language_raw", canonical: "language_canonical" },
	];
	for (const c of columns) {
		const rawId = sql.identifier(c.raw);
		const canonId = sql.identifier(c.canonical);
		const distinct = await tx.execute(
			sql`select distinct ${rawId} as v from calls where ${rawId} is not null`,
		);
		for (const { v } of distinct.rows as { v: string }[]) {
			const mapped = canon.canonicalize(c.field, v);
			await tx.execute(
				sql`update calls set ${canonId} = ${mapped} where ${rawId} = ${v} and ${canonId} is distinct from ${mapped}`,
			);
		}
	}
}

/**
 * Recompute + upsert field_coverage entirely in SQL. Keeping min/max_date in the
 * database avoids the timezone shift that round-tripping a naive timestamp
 * through a JS Date would introduce (the analytics data is stored as naive-UTC).
 */
async function recomputeCoverage(
	// biome-ignore lint/suspicious/noExplicitAny: dynamic-field aggregate over a known table
	tx: any,
	tableName: string,
	dateColumn: string,
	fields: string[],
): Promise<void> {
	const tableId = sql.identifier(tableName);
	const dateId = sql.identifier(dateColumn);
	for (const field of fields) {
		const fieldId = sql.identifier(field);
		await tx.execute(sql`
			insert into field_coverage (id, table_name, field, min_date, max_date, non_null_count, total_count, computed_at)
			select gen_random_uuid()::text, ${tableName}, ${field},
				min(${dateId}) filter (where ${fieldId} is not null),
				max(${dateId}) filter (where ${fieldId} is not null),
				count(${fieldId})::int, count(*)::int, now()
			from ${tableId}
			on conflict (table_name, field) do update set
				min_date = excluded.min_date,
				max_date = excluded.max_date,
				non_null_count = excluded.non_null_count,
				total_count = excluded.total_count,
				computed_at = now()
		`);
	}
}

async function main() {
	const callsPath = getArg("--calls");
	const referralsPath = getArg("--referrals");
	const rawPath = getArg("--raw");
	if (!callsPath || !referralsPath) {
		console.error(
			"Usage: pnpm exec tsx scripts/upsert-analytics.ts --calls <master.csv> --referrals <unmet_met.csv> [--raw <CallReports.csv>]",
		);
		process.exit(1);
	}

	console.log("⏳ Parsing CSVs...");
	const data = parseSources(callsPath, referralsPath);
	console.log(
		`   calls=${data.calls.length}  needs=${data.needs.length}  referrals=${data.referrals.length}`,
	);
	const callerKeys = rawPath ? parseCallerKeys(rawPath) : null;
	if (callerKeys) console.log(`   caller keys from raw export: ${callerKeys.size}`);

	const before = await db
		.select({
			n: sql<number>`count(*)::int`,
			mn: sql<string>`min(entered_on)`,
			mx: sql<string>`max(entered_on)`,
		})
		.from(calls);
	console.log(`   DB before: calls=${before[0].n}  range ${before[0].mn} → ${before[0].mx}`);

	const needIds = data.needs.map((n) => n.reportNeedNum);

	console.log("⏳ Upserting (calls → needs → referrals)...");
	await db.transaction(async (tx) => {
		await chunked(data.calls, (batch) =>
			tx
				.insert(calls)
				.values(batch)
				.onConflictDoUpdate({
					target: calls.callReportNum,
					set: updateAllExcept(calls, "call_report_num"),
				}),
		);
		await chunked(data.needs, (batch) =>
			tx
				.insert(needs)
				.values(batch)
				.onConflictDoUpdate({
					target: needs.reportNeedNum,
					set: updateAllExcept(needs, "report_need_num"),
				}),
		);

		// Referrals have no natural key: clear + reinsert only for needs in this file.
		await chunked(needIds, (batch) =>
			tx.delete(referrals).where(inArray(referrals.reportNeedNum, batch)),
		);
		await chunked(data.referrals, (batch) => tx.insert(referrals).values(batch));

		// Pseudonymous repeat-caller identity from the raw export (opt-in via --raw).
		if (callerKeys) await applyCallerKeys(tx, callerKeys);

		// Re-derive canonical values for ALL rows (covers rows outside the CSV window).
		await recanonicalizeAll(tx);

		// Recompute field coverage from the FULL post-upsert DB (pure SQL, no tz shift).
		await recomputeCoverage(tx, "calls", "entered_on", CALL_COVERAGE_FIELDS);
		await recomputeCoverage(tx, "needs", "date_of_call", NEED_COVERAGE_FIELDS);
	});

	const after = await db
		.select({
			n: sql<number>`count(*)::int`,
			mn: sql<string>`min(entered_on)`,
			mx: sql<string>`max(entered_on)`,
		})
		.from(calls);
	const needsAfter = await db.select({ n: sql<number>`count(*)::int` }).from(needs);
	const refsAfter = await db.select({ n: sql<number>`count(*)::int` }).from(referrals);
	console.log("✅ Upsert complete.");
	console.log(
		`   DB after: calls=${after[0].n}  needs=${needsAfter[0].n}  referrals=${refsAfter[0].n}`,
	);
	console.log(`   range ${after[0].mn} → ${after[0].mx}`);

	if (data.rejects.length) {
		console.log(`\n⚠️  ${data.rejects.length} rejected rows (first 20):`);
		for (const r of data.rejects.slice(0, 20)) console.log(`   [${r.file}:${r.row}] ${r.reason}`);
	} else {
		console.log("✅ No rejected rows.");
	}
	const unmapped = data.canonicalizer.report();
	if (unmapped.length) {
		console.log(`\n⚠️  ${unmapped.length} unmapped canonical values:`);
		for (const u of unmapped) console.log(`   [${u.field}] "${u.value}" ×${u.count}`);
	} else {
		console.log("✅ No unmapped canonical values.");
	}

	process.exit(0);
}

main().catch((err) => {
	console.error("❌ Upsert failed");
	console.error("cause:", err?.cause?.message ?? err?.message ?? err);
	if (err?.cause?.detail) console.error("detail:", err.cause.detail);
	process.exit(1);
});
