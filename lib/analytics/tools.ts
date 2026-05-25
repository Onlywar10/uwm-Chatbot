import { tool } from "ai";

import { cleanFilters, runCalls, runServiceNeeds } from "./builder";
import {
	buildCoverageNotes,
	fieldAvailability,
	getCoverageContext,
	usedCoverageFields,
} from "./coverage";
import { getDataAnchor, resolveDateRange } from "./dates";
import { queryCallsInputSchema, queryServiceNeedsInputSchema } from "./schema";

export type ToolLog = { tool: string; input: unknown; rowCount: number };

/**
 * The two analytics tools, sharing one query builder. A log array is passed in
 * so the route can record which tools the model called (telemetry).
 *
 * Every result carries structural honesty: the resolved date range, a
 * denominator, per-field availability, and coverage notes — so the model
 * always has the context it needs to caveat numbers.
 */
export function createAnalyticsTools(log: ToolLog[]) {
	return {
		queryCalls: tool({
			description:
				"Query the 211 CALLS (caller-level) data. Metrics: count_calls (distinct callers), " +
				"avg_age / min_age / max_age. Filter by caller demographics, geography, language, and " +
				"household; you may also filter by need/referral attributes (needCategory, taxonomyContains, " +
				"agencyContains, needUnmet) to count callers who had such a referral. groupBy time " +
				"(day/week/month/year) or caller dimensions.",
			inputSchema: queryCallsInputSchema,
			execute: async (input) => {
				const anchor = await getDataAnchor();
				const range = resolveDateRange(input.filters?.dateRange, anchor);
				const ctx = await getCoverageContext();
				const used = usedCoverageFields(cleanFilters(input.filters ?? {}), input.groupBy ?? []);

				const result = await runCalls(input, range);
				const denom = await runCalls(
					{
						metric: "count_calls",
						filters: {
							county: input.filters?.county,
							city: input.filters?.city,
							postalCode: input.filters?.postalCode,
						},
					},
					range,
				);

				const payload = {
					metric: input.metric,
					resolvedDateRange: range.label,
					groupedBy: input.groupBy ?? [],
					denominator: {
						description: `total calls in ${range.label}`,
						value: denom.rows[0]?.value ?? 0,
					},
					coverageNotes: buildCoverageNotes(used, range, ctx),
					fieldAvailability: fieldAvailability(used, ctx),
					rows: result.rows,
				};
				log.push({ tool: "queryCalls", input, rowCount: result.rows.length });
				return payload;
			},
		}),

		queryServiceNeeds: tool({
			description:
				"Query the 211 NEEDS and REFERRALS data. Metrics: count_needs (distinct needs), " +
				"count_referrals (agency referral rows — a need can have several), unmet_rate (share of " +
				"needs marked unmet, computed at the need level). Filter by needCategory (AIRS), " +
				"taxonomyContains, agencyContains, needUnmet, reasonIfUnmet, plus any caller filter. groupBy " +
				"time, needCategory, taxonomy, level1, reasonIfUnmet, or agency.",
			inputSchema: queryServiceNeedsInputSchema,
			execute: async (input) => {
				const anchor = await getDataAnchor();
				const range = resolveDateRange(input.filters?.dateRange, anchor);
				const ctx = await getCoverageContext();
				const used = usedCoverageFields(cleanFilters(input.filters ?? {}), input.groupBy ?? []);

				const result = await runServiceNeeds(input, range);
				const denomMetric = input.metric === "count_referrals" ? "count_referrals" : "count_needs";
				const denom = await runServiceNeeds(
					{
						metric: denomMetric,
						filters: {
							county: input.filters?.county,
							city: input.filters?.city,
							postalCode: input.filters?.postalCode,
						},
					},
					range,
				);

				const payload = {
					metric: input.metric,
					resolvedDateRange: range.label,
					groupedBy: input.groupBy ?? [],
					denominator: {
						description: `total ${denomMetric === "count_referrals" ? "referrals" : "needs"} in ${range.label}`,
						value: denom.rows[0]?.value ?? 0,
					},
					coverageNotes: buildCoverageNotes(used, range, ctx),
					fieldAvailability: fieldAvailability(used, ctx),
					rows: result.rows,
				};
				log.push({ tool: "queryServiceNeeds", input, rowCount: result.rows.length });
				return payload;
			},
		}),
	};
}
