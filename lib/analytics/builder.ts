import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	ilike,
	inArray,
	lt,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import { calls } from "@/lib/db/schema/calls";
import { needs } from "@/lib/db/schema/needs";
import { referrals } from "@/lib/db/schema/referrals";
import type { ResolvedRange } from "./dates";
import type { Filters, QueryCallsInput, QueryServiceNeedsInput } from "./schema";

export type ResultRow = { group: Record<string, string | null>; value: number };
export type QueryResult = { groupByKeys: string[]; rows: ResultRow[] };

const compact = (xs: (SQL | undefined)[]): SQL[] => xs.filter((x): x is SQL => x !== undefined);

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

function languageCondition(values: string[]): SQL | undefined {
	const parts = values.map((v) =>
		v === "non_english"
			? sql`(${calls.languageCanonical} IS NOT NULL AND ${calls.languageCanonical} <> 'English')`
			: eq(calls.languageCanonical, v),
	);
	return parts.length ? or(...parts) : undefined;
}

function callConditions(f: Filters): SQL[] {
	return compact([
		f.county ? ilike(calls.county, `%${f.county}%`) : undefined,
		f.city ? ilike(calls.city, `%${f.city}%`) : undefined,
		f.postalCode ? eq(calls.postalCode, f.postalCode) : undefined,
		f.language?.length ? languageCondition(f.language) : undefined,
		f.teleInterpretationUsed !== undefined
			? eq(calls.teleInterpretationUsed, f.teleInterpretationUsed)
			: undefined,
		f.gender?.length ? inArray(calls.genderCanonical, f.gender) : undefined,
		f.ethnicity?.length ? inArray(calls.ethnicityCanonical, f.ethnicity) : undefined,
		f.healthInsurance?.length ? inArray(calls.healthInsurance, f.healthInsurance) : undefined,
		f.hasChildren0to5 !== undefined ? eq(calls.hasChildren0to5, f.hasChildren0to5) : undefined,
		f.hasSeniors !== undefined
			? f.hasSeniors
				? gt(calls.seniors60PlusCount, 0)
				: eq(calls.seniors60PlusCount, 0)
			: undefined,
		f.ageMin !== undefined ? gte(calls.ageNumeric, f.ageMin) : undefined,
		f.ageMax !== undefined ? lte(calls.ageNumeric, f.ageMax) : undefined,
	]);
}

function needConditions(f: Filters): SQL[] {
	return compact([
		f.needCategory?.length ? inArray(needs.airsNeedCategory, f.needCategory) : undefined,
		f.taxonomyContains ? ilike(needs.taxonomyName, `%${f.taxonomyContains}%`) : undefined,
		f.needUnmet !== undefined ? eq(needs.needWasUnmet, f.needUnmet) : undefined,
		f.reasonIfUnmet?.length ? inArray(needs.reasonIfUnmet, f.reasonIfUnmet) : undefined,
	]);
}

function referralConditions(f: Filters): SQL[] {
	return compact([
		f.agencyContains ? ilike(referrals.agencyNamePublic, `%${f.agencyContains}%`) : undefined,
	]);
}

export function hasNeedOrReferralFilter(f: Filters): boolean {
	return Boolean(
		f.needCategory?.length ||
			f.taxonomyContains ||
			f.needUnmet !== undefined ||
			f.reasonIfUnmet?.length ||
			f.agencyContains,
	);
}

function hasCallFilter(f: Filters): boolean {
	return Boolean(
		f.county ||
			f.city ||
			f.postalCode ||
			f.language?.length ||
			f.teleInterpretationUsed !== undefined ||
			f.gender?.length ||
			f.ethnicity?.length ||
			f.healthInsurance?.length ||
			f.hasChildren0to5 !== undefined ||
			f.hasSeniors !== undefined ||
			f.ageMin !== undefined ||
			f.ageMax !== undefined,
	);
}

// ---------------------------------------------------------------------------
// Group-by + metric expressions
// ---------------------------------------------------------------------------

const timeExpr = (col: SQL | ReturnType<typeof sql>, unit: string, fmt: string): SQL =>
	sql`to_char(date_trunc(${unit}, ${col}), ${fmt})`;

function callGroupExpr(key: string): SQL {
	switch (key) {
		case "day":
			return timeExpr(sql`${calls.enteredOn}`, "day", "YYYY-MM-DD");
		case "week":
			return timeExpr(sql`${calls.enteredOn}`, "week", "YYYY-MM-DD");
		case "month":
			return timeExpr(sql`${calls.enteredOn}`, "month", "YYYY-MM");
		case "year":
			return timeExpr(sql`${calls.enteredOn}`, "year", "YYYY");
		case "language":
			return sql`${calls.languageCanonical}`;
		case "gender":
			return sql`${calls.genderCanonical}`;
		case "ethnicity":
			return sql`${calls.ethnicityCanonical}`;
		case "county":
			return sql`${calls.county}`;
		case "city":
			return sql`${calls.city}`;
		default:
			return sql`${calls.healthInsurance}`;
	}
}

function needGroupExpr(key: string): SQL {
	switch (key) {
		case "day":
			return timeExpr(sql`${needs.dateOfCall}`, "day", "YYYY-MM-DD");
		case "week":
			return timeExpr(sql`${needs.dateOfCall}`, "week", "YYYY-MM-DD");
		case "month":
			return timeExpr(sql`${needs.dateOfCall}`, "month", "YYYY-MM");
		case "year":
			return timeExpr(sql`${needs.dateOfCall}`, "year", "YYYY");
		case "needCategory":
			return sql`${needs.airsNeedCategory}`;
		case "taxonomy":
			return sql`${needs.taxonomyName}`;
		case "level1":
			return sql`${needs.level1Name}`;
		case "reasonIfUnmet":
			return sql`${needs.reasonIfUnmet}`;
		default:
			return sql`${referrals.agencyNamePublic}`;
	}
}

function callMetricExpr(metric: string): SQL {
	switch (metric) {
		case "avg_age":
			return sql`round(avg(${calls.ageNumeric})::numeric, 1)`;
		case "min_age":
			return sql`min(${calls.ageNumeric})`;
		case "max_age":
			return sql`max(${calls.ageNumeric})`;
		default:
			return sql`count(*)`;
	}
}

function needMetricExpr(metric: string): SQL {
	switch (metric) {
		case "count_referrals":
			return sql`count(${referrals.id})`;
		case "unmet_rate":
			return sql`coalesce(count(distinct ${needs.reportNeedNum}) filter (where ${needs.needWasUnmet})::float / nullif(count(distinct ${needs.reportNeedNum}), 0), 0)`;
		default:
			return sql`count(distinct ${needs.reportNeedNum})`;
	}
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

function shape(rows: Record<string, unknown>[], groupByKeys: string[]): QueryResult {
	return {
		groupByKeys,
		rows: rows.map((r) => ({
			group: Object.fromEntries(
				groupByKeys.map((k, i) => [k, (r[`g${i}`] as string | null) ?? null]),
			),
			value: r.value === null || r.value === undefined ? 0 : Number(r.value),
		})),
	};
}

function orderClause(orderBy: string | undefined, groupExprs: SQL[], metricExpr: SQL): SQL {
	const choice = orderBy ?? (groupExprs.length ? "group_asc" : "metric_desc");
	if (choice === "group_asc" && groupExprs[0]) return asc(groupExprs[0]);
	if (choice === "metric_asc") return asc(metricExpr);
	return desc(metricExpr);
}

const clampLimit = (n: number | undefined): number => Math.min(Math.max(n ?? 50, 1), 100);

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

export async function runCalls(input: QueryCallsInput, range: ResolvedRange): Promise<QueryResult> {
	const f = input.filters ?? {};
	const where = compact([
		range.from ? gte(calls.enteredOn, range.from) : undefined,
		range.to ? lt(calls.enteredOn, range.to) : undefined,
		...callConditions(f),
	]);

	if (hasNeedOrReferralFilter(f)) {
		const refConds = referralConditions(f);
		let sub = db.selectDistinct({ id: needs.callReportNum }).from(needs).$dynamic();
		if (refConds.length) {
			sub = sub.innerJoin(referrals, eq(referrals.reportNeedNum, needs.reportNeedNum));
		}
		sub = sub.where(and(...needConditions(f), ...refConds));
		where.push(inArray(calls.callReportNum, sub));
	}

	const groupExprs = (input.groupBy ?? []).map(callGroupExpr);
	const metricExpr = callMetricExpr(input.metric);
	const selection: Record<string, SQL> = { value: metricExpr };
	groupExprs.forEach((g, i) => {
		selection[`g${i}`] = g;
	});

	let q = db
		.select(selection)
		.from(calls)
		.where(and(...where))
		.$dynamic();
	if (groupExprs.length) {
		q = q
			.groupBy(...groupExprs)
			.orderBy(orderClause(input.orderBy, groupExprs, metricExpr))
			.limit(clampLimit(input.limit));
	}
	return shape(await q, input.groupBy ?? []);
}

export async function runServiceNeeds(
	input: QueryServiceNeedsInput,
	range: ResolvedRange,
): Promise<QueryResult> {
	const f = input.filters ?? {};
	const groupBy = input.groupBy ?? [];
	const joinReferrals =
		input.metric === "count_referrals" || groupBy.includes("agency") || Boolean(f.agencyContains);
	const joinCalls = hasCallFilter(f);

	const where = compact([
		range.from ? gte(needs.dateOfCall, range.from) : undefined,
		range.to ? lt(needs.dateOfCall, range.to) : undefined,
		...needConditions(f),
		...(joinReferrals ? referralConditions(f) : []),
		...(joinCalls ? callConditions(f) : []),
	]);

	const groupExprs = groupBy.map(needGroupExpr);
	const metricExpr = needMetricExpr(input.metric);
	const selection: Record<string, SQL> = { value: metricExpr };
	groupExprs.forEach((g, i) => {
		selection[`g${i}`] = g;
	});

	let q = db.select(selection).from(needs).$dynamic();
	if (joinReferrals) q = q.innerJoin(referrals, eq(referrals.reportNeedNum, needs.reportNeedNum));
	if (joinCalls) q = q.innerJoin(calls, eq(calls.callReportNum, needs.callReportNum));
	q = q.where(and(...where));
	if (groupExprs.length) {
		q = q
			.groupBy(...groupExprs)
			.orderBy(orderClause(input.orderBy, groupExprs, metricExpr))
			.limit(clampLimit(input.limit));
	}
	return shape(await q, groupBy);
}
