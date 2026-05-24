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
