import { z } from "zod";

import {
	ETHNICITY_CANONICAL_VALUES,
	GENDER_CANONICAL_VALUES,
	LANGUAGE_CANONICAL_VALUES,
} from "@/lib/data/canonical-maps";

/** AIRS need categories present in the data (the clean, low-cardinality layer). */
export const AIRS_CATEGORIES = [
	"Housing",
	"Utility Assistance",
	"Food/Meals",
	"Health Care",
	"Income Support/Assistance",
	"Individual, Family and Community Support",
	"Information Services",
	"Legal, Consumer and Public Safety Services",
	"Mental Health/Substance Use Disorders",
	"Clothing/Personal/Household Needs",
	"Disaster Services",
	"Transportation",
	"Employment",
	"Volunteers/Donations",
	"Education",
	"Other Government/Economic Services",
	"Arts, Culture and Recreation",
] as const;

export const dateRangeSchema = z
	.object({
		preset: z
			.enum(["last_week", "last_month", "last_3_months", "last_year", "all_time"])
			.optional(),
		from: z.string().describe("ISO date (inclusive). Overrides preset.").optional(),
		to: z.string().describe("ISO date (exclusive). Overrides preset.").optional(),
	})
	.optional();

/**
 * Shared filter shape for both tools. AND across fields; arrays are OR (IN).
 * Categorical fields are enums (the model cannot pass an invalid value);
 * agency/taxonomy are free-text ILIKE. Need/referral filters trigger a join.
 */
export const filtersSchema = z.object({
	dateRange: dateRangeSchema,

	// Caller / call
	timeOfDay: z
		.enum(["business_hours", "after_hours"])
		.describe(
			"business_hours = Mon-Fri 8:00AM-4:59PM (when the call was entered); after_hours = evenings + weekends.",
		)
		.optional(),
	county: z.string().describe("Matches county (contains).").optional(),
	city: z.string().describe("Matches city (contains).").optional(),
	postalCode: z.string().optional(),
	language: z.array(z.enum([...LANGUAGE_CANONICAL_VALUES, "non_english"])).optional(),
	teleInterpretationUsed: z.boolean().optional(),
	gender: z.array(z.enum(GENDER_CANONICAL_VALUES)).optional(),
	ethnicity: z.array(z.enum(ETHNICITY_CANONICAL_VALUES)).optional(),
	healthInsurance: z.array(z.string()).optional(),
	hasChildren0to5: z.boolean().optional(),
	hasSeniors: z.boolean().optional(),
	ageMin: z.number().int().optional(),
	ageMax: z.number().int().optional(),

	// Need / referral
	needCategory: z.array(z.enum(AIRS_CATEGORIES)).optional(),
	taxonomyContains: z
		.string()
		.describe("Matches taxonomy name (contains), e.g. 'Food Pantries'.")
		.optional(),
	agencyContains: z.string().describe("Matches agency name (contains), e.g. 'LIHEAP'.").optional(),
	needUnmet: z.boolean().optional(),
	reasonIfUnmet: z.array(z.string()).optional(),
});

export type Filters = z.infer<typeof filtersSchema>;

export const orderBySchema = z.enum(["metric_desc", "metric_asc", "group_asc"]).optional();

export const callMetricSchema = z.enum([
	"count_calls",
	// Distinct callers by pseudonymous phone-hash key (2022 onward; ~99% of calls
	// have a key). Compare with count_calls to quantify repeat callers.
	"count_unique_callers",
	"avg_age",
	"min_age",
	"max_age",
	// Sums of the per-call household counts (recorded Oct-2025 onward only).
	"total_children_under_5",
	"total_seniors_60_plus",
]);
export const callGroupBySchema = z.enum([
	"day",
	"week",
	"month",
	"year",
	"hour",
	"day_of_week",
	"language",
	"gender",
	"ethnicity",
	"county",
	"city",
	"health_insurance",
]);

export const needMetricSchema = z.enum(["count_needs", "count_referrals", "unmet_rate"]);
export const needGroupBySchema = z.enum([
	"day",
	"week",
	"month",
	"year",
	"needCategory",
	"taxonomy",
	"level1",
	"reasonIfUnmet",
	"agency",
]);

export const queryCallsInputSchema = z.object({
	filters: filtersSchema.optional(),
	metric: callMetricSchema,
	groupBy: z.array(callGroupBySchema).max(3).optional(),
	orderBy: orderBySchema,
	limit: z.number().int().min(1).max(100).optional(),
});

export const queryServiceNeedsInputSchema = z.object({
	filters: filtersSchema.optional(),
	metric: needMetricSchema,
	groupBy: z.array(needGroupBySchema).max(3).optional(),
	orderBy: orderBySchema,
	limit: z.number().int().min(1).max(100).optional(),
});

export type QueryCallsInput = z.infer<typeof queryCallsInputSchema>;
export type QueryServiceNeedsInput = z.infer<typeof queryServiceNeedsInputSchema>;
