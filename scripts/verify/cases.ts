import { runCalls, runServiceNeeds } from "@/lib/analytics/builder";
import type { ResolvedRange } from "@/lib/analytics/dates";
import type { QueryCallsInput, QueryServiceNeedsInput } from "@/lib/analytics/schema";
import type { ParsedData } from "@/lib/import/parse";

/**
 * Golden cases: expected values are computed independently from the parsed CSVs
 * and compared against the DB-backed builder. All use the all-time range so
 * results are deterministic. They target the traps we found: distinct needs vs
 * referral rows, need-level unmet rate, the calls/needs join, and canonical merges.
 */

const ALL: ResolvedRange = { from: null, to: null, label: "all available data" };
const ci = (s: string | null | undefined, sub: string): boolean =>
	!!s && s.toLowerCase().includes(sub.toLowerCase());
const round1 = (n: number): number => Math.round(n * 10) / 10;

const scalarCalls = async (input: QueryCallsInput): Promise<number> =>
	(await runCalls(input, ALL)).rows[0]?.value ?? 0;
const scalarNeeds = async (input: QueryServiceNeedsInput): Promise<number> =>
	(await runServiceNeeds(input, ALL)).rows[0]?.value ?? 0;

export type GoldenCase = {
	name: string;
	expected: (d: ParsedData) => number;
	actual: () => Promise<number>;
	tolerance?: number;
};

export const goldenCases: GoldenCase[] = [
	{
		name: "total calls",
		expected: (d) => d.calls.length,
		actual: () => scalarCalls({ metric: "count_calls" }),
	},
	{
		name: "total needs (distinct)",
		expected: (d) => d.needs.length,
		actual: () => scalarNeeds({ metric: "count_needs" }),
	},
	{
		name: "total referrals (rows)",
		expected: (d) => d.referrals.length,
		actual: () => scalarNeeds({ metric: "count_referrals" }),
	},
	{
		name: "calls with children under 5",
		expected: (d) => d.calls.filter((c) => c.hasChildren0to5 === true).length,
		actual: () => scalarCalls({ metric: "count_calls", filters: { hasChildren0to5: true } }),
	},
	{
		name: "calls in a non-English language",
		expected: (d) =>
			d.calls.filter((c) => c.languageCanonical && c.languageCanonical !== "English").length,
		actual: () => scalarCalls({ metric: "count_calls", filters: { language: ["non_english"] } }),
	},
	{
		name: "Black/African American callers (canonical merge)",
		expected: (d) =>
			d.calls.filter((c) => c.ethnicityCanonical === "Black/African American").length,
		actual: () =>
			scalarCalls({ metric: "count_calls", filters: { ethnicity: ["Black/African American"] } }),
	},
	{
		name: "Food/Meals needs (distinct)",
		expected: (d) => d.needs.filter((n) => n.airsNeedCategory === "Food/Meals").length,
		actual: () => scalarNeeds({ metric: "count_needs", filters: { needCategory: ["Food/Meals"] } }),
	},
	{
		name: "referrals to food pantries (rows)",
		expected: (d) => {
			const ids = new Set(
				d.needs.filter((n) => ci(n.taxonomyName, "Food Pantries")).map((n) => n.reportNeedNum),
			);
			return d.referrals.filter((r) => ids.has(r.reportNeedNum)).length;
		},
		actual: () =>
			scalarNeeds({ metric: "count_referrals", filters: { taxonomyContains: "Food Pantries" } }),
	},
	{
		name: "average age of callers referred to LIHEAP (join, no fan-out)",
		expected: (d) => {
			const needIds = new Set(
				d.referrals.filter((r) => ci(r.agencyNamePublic, "LIHEAP")).map((r) => r.reportNeedNum),
			);
			const callIds = new Set(
				d.needs.filter((n) => needIds.has(n.reportNeedNum)).map((n) => n.callReportNum),
			);
			const ages = d.calls
				.filter((c) => callIds.has(c.callReportNum) && c.ageNumeric != null)
				.map((c) => c.ageNumeric as number);
			return ages.length ? round1(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
		},
		actual: () => scalarCalls({ metric: "avg_age", filters: { agencyContains: "LIHEAP" } }),
		tolerance: 0.05,
	},
	{
		name: "overall unmet rate (need-level)",
		expected: (d) => {
			const total = d.needs.length;
			const unmet = d.needs.filter((n) => n.needWasUnmet).length;
			return total ? unmet / total : 0;
		},
		actual: () => scalarNeeds({ metric: "unmet_rate" }),
		tolerance: 0.001,
	},
];
