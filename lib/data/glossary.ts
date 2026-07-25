/**
 * ⚠️ APPROVAL REQUIRED — business definitions, not architecture.
 *
 * Human terms that have no direct column. Rendered into the analytics system
 * prompt so the model maps a term to the right tool + filter consistently.
 * The model still constructs the actual tool call; these are authoritative
 * hints + notes, not executed directly.
 */

export type GlossaryEntry = {
	/** The term(s) a user might say. */
	term: string;
	/** Which tool the term applies to. */
	tool: "queryCalls" | "queryServiceNeeds";
	/** Filter hint the model should apply (shape mirrors the tool's filter schema). */
	filter: Record<string, unknown>;
	/** Caveat the model should respect and, where relevant, surface to the user. */
	note?: string;
};

export const glossary: GlossaryEntry[] = [
	{
		term: "parents",
		tool: "queryCalls",
		filter: { hasChildren0to5: true },
		note: "Only the 'children under 5 in household' signal exists. Misses parents whose children are all 6+. Field collected only from Oct-2025 — say so for earlier ranges.",
	},
	{
		term: "after hours / evenings and weekends / call center calls / outside business hours",
		tool: "queryCalls",
		filter: { timeOfDay: "after_hours" },
		note: "business_hours = Mon-Fri 8:00AM-5:00PM (the United Way deliverables definition); after_hours = everything else. Based on when the call report was entered; holidays count as business days.",
	},
	{
		term: "unique callers / unduplicated callers / repeat callers / how many people called",
		tool: "queryCalls",
		filter: {},
		note: "Use metric count_unique_callers (distinct people via a privacy-preserving phone-number key). Coverage: 2022 onward; ~99% of those calls have a key — 2021 calls and calls with no phone are excluded, so say so. For repeat-caller share, also run count_calls and compare.",
	},
	{
		term: "children served / how many children / kids served",
		tool: "queryCalls",
		filter: {},
		note: "Use metric total_children_under_5 — the sum of children age 0-5 reported per call. The data records ONLY children 0-5 (no all-ages count exists) and only from Oct-2025 onward. Always state both limits.",
	},
	{
		term: "ECM referrals / ECM",
		tool: "queryServiceNeeds",
		filter: { agencyContains: "ECM Support Services" },
		note: "ECM Support Services programs only. Do NOT count other programs merely housed at the ECM office (e.g. REACH/Match My Payment).",
	},
	{
		term: "food pantry / food pantries",
		tool: "queryServiceNeeds",
		filter: { taxonomyContains: "Food Pantries" },
	},
	{
		term: "SNAP / CalFresh / food stamps",
		tool: "queryServiceNeeds",
		filter: { taxonomyContains: "SNAP" },
		note: "Direct SNAP referrals are few. For questions about SNAP benefit cuts driving demand, trend FOOD/MEALS (esp. Food Pantries) demand and the unmet rate instead — that is where a benefit cut shows up.",
	},
	{
		term: "LIHEAP / energy assistance",
		tool: "queryServiceNeeds",
		filter: { agencyContains: "LIHEAP" },
	},
	{
		term: "language assistance / needed an interpreter / non-English",
		tool: "queryCalls",
		filter: { language: ["non_english"], teleInterpretationUsed: true },
		note: "Either a non-English language of call OR tele-interpretation used. Language was only recorded from Oct-2025.",
	},
	{
		term: "unmet need / supply couldn't keep up / waitlisted",
		tool: "queryServiceNeeds",
		filter: { needUnmet: true },
		note: "Use unmet_rate (computed at the NEED level). Group by reasonIfUnmet to show why (e.g. 'Agency resources depleted', 'Agency full, waiting list').",
	},
];
