import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema/calls";
import { fieldCoverage } from "@/lib/db/schema/fieldCoverage";
import type { ResolvedRange } from "./dates";
import type { Filters } from "./schema";

type Cov = { minDate: Date | null; maxDate: Date | null; nonNullCount: number; totalCount: number };

export type CoverageContext = {
	fields: Map<string, Cov>;
	globalMin: Date | null;
	globalMax: Date | null;
};

const FIELD_LABELS: Record<string, string> = {
	language_canonical: "Language of call",
	tele_interpretation_used: "Tele-interpretation",
	ethnicity_canonical: "Caller ethnicity",
	gender_canonical: "Caller gender",
	age_numeric: "Caller age",
	health_insurance: "Health insurance",
	has_children_0_5: "Children under 5 in household",
	seniors_60_plus_count: "Seniors in household",
	county: "County",
	city: "City",
	postal_code: "Postal code",
	airs_need_category: "Need category",
	reason_if_unmet: "Reason unmet",
};

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOf = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

export async function getCoverageContext(): Promise<CoverageContext> {
	const rows = await db.select().from(fieldCoverage);
	const fields = new Map<string, Cov>();
	for (const r of rows) {
		fields.set(r.field, {
			minDate: r.minDate,
			maxDate: r.maxDate,
			nonNullCount: r.nonNullCount,
			totalCount: r.totalCount,
		});
	}
	const [g] = await db
		.select({
			min: sql<string | null>`min(${calls.enteredOn})`,
			max: sql<string | null>`max(${calls.enteredOn})`,
		})
		.from(calls);
	return {
		fields,
		globalMin: g?.min ? new Date(g.min) : null,
		globalMax: g?.max ? new Date(g.max) : null,
	};
}

/** DB column names for the fields a query touches (for coverage notes / availability). */
export function usedCoverageFields(f: Filters, groupBy: string[]): string[] {
	const s = new Set<string>();
	if (f.language?.length) s.add("language_canonical");
	if (f.teleInterpretationUsed !== undefined) s.add("tele_interpretation_used");
	if (f.gender?.length) s.add("gender_canonical");
	if (f.ethnicity?.length) s.add("ethnicity_canonical");
	if (f.healthInsurance?.length) s.add("health_insurance");
	if (f.hasChildren0to5 !== undefined) s.add("has_children_0_5");
	if (f.hasSeniors !== undefined) s.add("seniors_60_plus_count");
	if (f.ageMin !== undefined || f.ageMax !== undefined) s.add("age_numeric");
	if (f.needCategory?.length) s.add("airs_need_category");
	if (f.reasonIfUnmet?.length) s.add("reason_if_unmet");

	const gb: Record<string, string> = {
		language: "language_canonical",
		gender: "gender_canonical",
		ethnicity: "ethnicity_canonical",
		health_insurance: "health_insurance",
		needCategory: "airs_need_category",
		reasonIfUnmet: "reason_if_unmet",
	};
	for (const g of groupBy) if (gb[g]) s.add(gb[g]);
	return [...s];
}

/** Notes when a query's range falls outside a field's collection window. */
export function buildCoverageNotes(
	usedFields: string[],
	range: ResolvedRange,
	ctx: CoverageContext,
): string[] {
	const notes: string[] = [];
	for (const field of usedFields) {
		const cov = ctx.fields.get(field);
		if (!cov?.minDate || !cov?.maxDate) continue;
		const label = FIELD_LABELS[field] ?? field;
		const introducedLate = ctx.globalMin
			? cov.minDate.getTime() > ctx.globalMin.getTime() + 31 * DAY
			: false;
		const retired = ctx.globalMax
			? cov.maxDate.getTime() < ctx.globalMax.getTime() - 31 * DAY
			: false;
		const coversBefore = !range.from || range.from < cov.minDate;
		const coversAfter = !range.to || range.to > cov.maxDate;
		if (introducedLate && coversBefore) {
			notes.push(`${label} was only recorded from ${monthOf(cov.minDate)} onward.`);
		}
		if (retired && coversAfter) {
			notes.push(`${label} was discontinued after ${monthOf(cov.maxDate)}.`);
		}
	}
	return notes;
}

/** How fully each used field is populated, for honest denominators. */
export function fieldAvailability(usedFields: string[], ctx: CoverageContext) {
	return usedFields
		.map((field) => {
			const cov = ctx.fields.get(field);
			if (!cov) return null;
			return {
				field: FIELD_LABELS[field] ?? field,
				recorded: cov.nonNullCount,
				of: cov.totalCount,
				window:
					cov.minDate && cov.maxDate
						? `${monthOf(cov.minDate)} – ${monthOf(cov.maxDate)}`
						: "unknown",
			};
		})
		.filter((x): x is NonNullable<typeof x> => x !== null);
}
