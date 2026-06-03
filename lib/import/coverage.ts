import type { NewCall } from "@/lib/db/schema/calls";
import type { NewFieldCoverage } from "@/lib/db/schema/fieldCoverage";
import type { NewNeed } from "@/lib/db/schema/needs";

type FieldDef<T> = { field: string; get: (row: T) => unknown };

function coverFor<T>(
	tableName: string,
	rows: T[],
	date: (row: T) => Date,
	fields: FieldDef<T>[],
): NewFieldCoverage[] {
	return fields.map(({ field, get }) => {
		let nonNull = 0;
		let min: Date | null = null;
		let max: Date | null = null;
		for (const row of rows) {
			const value = get(row);
			if (value === null || value === undefined) continue;
			nonNull++;
			const d = date(row);
			if (!min || d < min) min = d;
			if (!max || d > max) max = d;
		}
		return {
			tableName,
			field,
			minDate: min,
			maxDate: max,
			nonNullCount: nonNull,
			totalCount: rows.length,
		};
	});
}

/**
 * Per-field data-availability windows, keyed by DB column name so the tools can
 * look them up directly. A field's `maxDate` lagging the global latest date is
 * how "retired" is later derived.
 */
export function computeCoverage(calls: NewCall[], needs: NewNeed[]): NewFieldCoverage[] {
	const callFields: FieldDef<NewCall>[] = [
		{ field: "language_canonical", get: (r) => r.languageCanonical },
		{ field: "tele_interpretation_used", get: (r) => r.teleInterpretationUsed },
		{ field: "ethnicity_canonical", get: (r) => r.ethnicityCanonical },
		{ field: "gender_canonical", get: (r) => r.genderCanonical },
		{ field: "age_numeric", get: (r) => r.ageNumeric },
		{ field: "health_insurance", get: (r) => r.healthInsurance },
		{ field: "has_children_0_5", get: (r) => r.hasChildren0to5 },
		{ field: "children_under_5_count", get: (r) => r.childrenUnder5Count },
		{ field: "seniors_60_plus_count", get: (r) => r.seniors60PlusCount },
		{ field: "city", get: (r) => r.city },
		{ field: "county", get: (r) => r.county },
		{ field: "postal_code", get: (r) => r.postalCode },
	];
	const needFields: FieldDef<NewNeed>[] = [
		{ field: "airs_need_category", get: (r) => r.airsNeedCategory },
		{ field: "reason_if_unmet", get: (r) => r.reasonIfUnmet },
	];
	return [
		...coverFor("calls", calls, (r) => r.enteredOn, callFields),
		...coverFor("needs", needs, (r) => r.dateOfCall, needFields),
	];
}
