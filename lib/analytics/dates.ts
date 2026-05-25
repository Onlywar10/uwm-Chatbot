import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema/calls";

export type DatePreset = "last_week" | "last_month" | "last_3_months" | "last_year" | "all_time";

export type DateRangeInput = {
	preset?: DatePreset;
	from?: string;
	to?: string;
};

/** `from` inclusive, `to` exclusive. Null bounds mean unbounded. */
export type ResolvedRange = { from: Date | null; to: Date | null; label: string };

/**
 * The latest call date in the data. "now" is anchored here, not to wall-clock,
 * because the data is a batch export that lags real time by weeks.
 */
export async function getDataAnchor(): Promise<Date> {
	const [row] = await db.select({ max: sql<string | null>`max(${calls.enteredOn})` }).from(calls);
	if (!row?.max) return new Date();
	// The timestamp column is naive UTC wall-clock; parse it as UTC.
	const iso = typeof row.max === "string" ? `${row.max.replace(" ", "T")}Z` : row.max;
	return new Date(iso);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(d: Date): string {
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function ymd(d: Date): string {
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function mondayOf(d: Date): Date {
	const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const offset = (x.getUTCDay() + 6) % 7; // 0 = Monday
	x.setUTCDate(x.getUTCDate() - offset);
	return x;
}

/**
 * Resolves a relative preset against the data anchor using complete calendar
 * periods. Explicit from/to override the preset. Always returns a human label
 * so the tool can echo the exact window it used.
 */
export function resolveDateRange(input: DateRangeInput | undefined, anchor: Date): ResolvedRange {
	if (input?.from || input?.to) {
		return {
			from: input.from ? new Date(input.from) : null,
			to: input.to ? new Date(input.to) : null,
			label: `${input.from ?? "earliest"} to ${input.to ?? "latest"}`,
		};
	}

	switch (input?.preset ?? "all_time") {
		case "last_week": {
			const to = mondayOf(anchor); // start of the anchor's (partial) week
			const from = new Date(to);
			from.setUTCDate(from.getUTCDate() - 7);
			return { from, to, label: `week of ${ymd(from)}` };
		}
		case "last_month": {
			const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
			const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
			return { from, to, label: monthLabel(from) };
		}
		case "last_3_months": {
			const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 2, 1));
			const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
			return { from, to, label: `${monthLabel(from)} – ${monthLabel(anchor)}` };
		}
		case "last_year": {
			const from = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
			const to = new Date(Date.UTC(anchor.getUTCFullYear() + 1, 0, 1));
			return { from, to, label: `${anchor.getUTCFullYear()}` };
		}
		default:
			return { from: null, to: null, label: "all available data" };
	}
}
