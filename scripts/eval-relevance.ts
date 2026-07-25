/**
 * LLM-judged relevance evaluation for resource retrieval.
 *
 * The keyword-assertion eval (scripts/eval-directory.ts) checks that the RIGHT
 * program appears. This one checks the opposite and harder property: that nothing
 * IRRELEVANT is shown. Product rule being enforced — a 2-1-1 handoff is better than
 * a bad suggestion, so a card that doesn't plausibly address the need is a defect
 * even when a good card sits above it ("Game Night for Kids" for a clothing need).
 *
 * Hand-writing expected-match patterns does not scale across this many phrasings,
 * so each returned card is rated by a model against the user's actual words.
 *
 *   pnpm eval:relevance                 # full battery
 *   pnpm eval:relevance --topic food    # filter by topic substring
 *   pnpm eval:relevance --verbose       # show every card + verdict
 *
 * Reports precision@k (share of shown cards judged relevant), coverage (how often
 * we returned anything at all), and abstention (how often we correctly stayed
 * silent rather than guessing).
 */
import { generateText, Output } from "ai";
import { z } from "zod";
import { analyticsModel } from "@/lib/analytics/model";
import { searchDirectory } from "@/lib/directory/search";

type Probe = {
	topic: string;
	/** How the person actually typed it. */
	need: string;
	city?: string;
	zip?: string;
	/** Plain description of what they want, given to the judge. */
	intent: string;
	/** True when the honest answer is "we have nothing for this". */
	expectAbstain?: boolean;
};

const P = (
	topic: string,
	need: string,
	intent: string,
	city?: string,
	extra?: Partial<Probe>,
): Probe => ({ topic, need, intent, city, ...extra });

export const probes: Probe[] = [
	// ---------- FOOD ----------
	P("food", "I need food for my family", "Free food / groceries for a family", "merced"),
	P("food", "food pantry", "Food pantry", "merced"),
	P("food", "where can i get free groceries im broke", "Free groceries", "atwater"),
	P("food", "my kids are hungry and payday isnt until friday", "Emergency food", "los banos"),
	P("food", "calfresh application help", "Help applying for CalFresh/SNAP", "merced"),
	P("food", "hot meal today", "A prepared hot meal", "merced"),
	P("food", "help with groceries", "Food assistance", "coulterville"),
	P("food", "food assistance", "Food assistance", undefined, { zip: "95340" }),

	// ---------- HOUSING / RENT ----------
	P("rent", "behind on rent, facing eviction", "Rent help / eviction prevention", "merced"),
	P("rent", "landlord is kicking me out next week", "Eviction help", "merced"),
	P("rent", "I need help paying rent", "Rent assistance (no location given)"),
	P("rent", "help with a security deposit", "Move-in / deposit assistance", "merced"),
	P("shelter", "I have nowhere to sleep tonight", "Emergency shelter", "merced"),
	P("shelter", "homeless shelter", "Homeless shelter", "los banos"),
	P("housing", "looking for affordable apartments", "Affordable housing", "merced"),

	// ---------- UTILITIES ----------
	P("utilities", "help paying my utility bill", "Utility bill assistance", "atwater"),
	P("utilities", "my power is about to get shut off", "Prevent utility shutoff", "merced"),
	P("utilities", "water bill assistance", "Water bill help", "merced"),
	P("utilities", "help with my gas bill this winter", "Heating bill assistance", "merced"),

	// ---------- HEAT / COOLING ----------
	P("cooling", "I need a cooling center, it is too hot", "Cooling center", "mariposa"),
	P("cooling", "somewhere to cool off during the heat wave", "Cooling center", "atwater"),

	// ---------- CLOTHING / GOODS ----------
	P("clothing", "free clothes for my kids", "Free children's clothing", "merced"),
	P("clothing", "i need work clothes for a job interview", "Interview/work clothing", "merced"),
	P("clothing", "winter coats", "Warm clothing / coats", "merced"),
	P("goods", "I need furniture for my apartment", "Household furniture", "merced"),
	P("baby", "diapers and formula for a newborn", "Diapers and baby formula", "merced"),

	// ---------- CHILDREN / FAMILY ----------
	P("childcare", "I need help with childcare", "Child care assistance", "los banos"),
	P("school", "school supplies for my kids", "School supplies", "merced"),
	P("parenting", "parenting classes", "Parenting classes", "merced"),
	P("youth", "after school programs for my son", "After-school youth programs", "merced"),

	// ---------- HEALTH ----------
	P("insurance", "I need help signing up for Medi-Cal", "Medi-Cal enrollment help", "merced"),
	P("dental", "I have a really bad toothache and no insurance", "Low-cost dental care", "merced"),
	P("mentalhealth", "mental health counseling for a teenager", "Youth mental health", "merced"),
	P("substance", "my son needs help with drug addiction", "Substance use treatment", "merced"),
	P("prescription", "cant afford my prescriptions", "Prescription assistance", "merced"),
	P("clinic", "I need a doctor but have no insurance", "Free/low-cost medical clinic", "merced"),
	P("vision", "I need glasses but cant afford them", "Vision / eyeglasses assistance", "merced"),

	// ---------- SAFETY ----------
	P("dv", "domestic violence shelter", "Domestic violence shelter", "merced"),
	P("dv", "my husband hits me and I need to get out", "Domestic violence help", "merced"),

	// ---------- SENIORS / DISABILITY ----------
	P("senior", "meals for my elderly mother", "Senior meals", "merced"),
	P("senior", "in home care for my dad", "In-home supportive services", "merced"),
	P("disability", "help applying for disability benefits", "Disability benefits help", "merced"),

	// ---------- ECONOMIC ----------
	P("jobs", "looking for work", "Employment services", "merced"),
	P("jobs", "job training programs", "Job training", "merced"),
	P("taxes", "free tax preparation", "Free tax prep / VITA", "merced"),
	P("legal", "legal help with an eviction notice", "Legal aid for eviction", "merced"),
	P("immigration", "help with citizenship application", "Immigration/citizenship help", "merced"),
	P("financial", "help creating a budget and managing debt", "Financial counseling", "merced"),

	// ---------- TRANSPORT / MISC ----------
	P("transport", "transportation to a doctor appointment", "Medical transportation", "merced"),
	P("transport", "I need a bus pass", "Transit assistance", "merced"),
	P("veteran", "I am a veteran and need help", "Veteran services", "merced"),
	P("holiday", "christmas presents for my kids", "Holiday gift assistance", "merced"),

	// ---------- ABSTENTION (should return nothing) ----------
	P("nonsense", "asdkjfh qwerty zzzz", "Gibberish", "merced", { expectAbstain: true }),
	P("offtopic", "I want to buy a sports car", "Buying a sports car", "merced", {
		expectAbstain: true,
	}),
	P("offtopic", "what is the capital of France", "Trivia question", "merced", {
		expectAbstain: true,
	}),
	P("offtopic", "I need a wedding photographer", "Wedding photographer", "merced", {
		expectAbstain: true,
	}),
	// NOT an abstention case, despite first appearances: the directory genuinely
	// carries animal adoption programs, so returning them is correct. Kept as a live
	// relevance probe rather than deleted — it guards against pet queries drifting
	// into unrelated "adoption" (child/foster) services.
	P("pets", "where can I adopt a puppy", "Adopting a pet", "merced"),
];

const verdictSchema = z.object({
	verdicts: z.array(
		z.object({
			program: z.string().describe("The program name being rated, copied verbatim."),
			relevant: z
				.boolean()
				.describe("True only if this program plausibly helps with the stated need."),
			why: z.string().describe("Under 12 words."),
		}),
	),
});

type Verdict = z.infer<typeof verdictSchema>["verdicts"][number];

async function judge(
	intent: string,
	need: string,
	cards: { programName: string; agencyName: string | null; description: string | null }[],
): Promise<Verdict[]> {
	const list = cards
		.map(
			(c, i) =>
				`${i + 1}. ${c.programName} (${c.agencyName ?? "unknown agency"}) — ${
					c.description?.slice(0, 220) ?? "no description"
				}`,
		)
		.join("\n");

	const { output } = await generateText({
		model: analyticsModel(),
		system:
			"You audit a 211 community-resource referral bot. A person asked for help; the bot showed these programs. " +
			"For EACH program decide whether it plausibly helps with that specific need. " +
			"Be strict: a program serving the same population but a different need (e.g. a kids' game night when someone " +
			"needs clothing) is NOT relevant. A program that is a reasonable route to the need (e.g. a general assistance " +
			"agency that also does this, or a benefits-enrollment program for that benefit) IS relevant. Reply with JSON only.",
		prompt: `Person's request (verbatim): "${need}"\nWhat they need: ${intent}\n\nPrograms shown:\n${list}\n\nRate each program. Return JSON matching the schema.`,
		output: Output.json(verdictSchema),
	});
	const parsed = verdictSchema.safeParse(output);
	return parsed.success ? parsed.data.verdicts : [];
}

async function main() {
	const args = process.argv.slice(2);
	const verbose = args.includes("--verbose");
	const topicFilter = args.includes("--topic") ? args[args.indexOf("--topic") + 1] : null;
	const selected = probes.filter((p) => !topicFilter || p.topic.includes(topicFilter));

	let shown = 0;
	let relevant = 0;
	let emptyWhenShouldAnswer = 0;
	let abstainCorrect = 0;
	const offenders: string[] = [];

	for (const p of selected) {
		const r = await searchDirectory({ need: p.need, city: p.city, zip: p.zip });

		if (p.expectAbstain) {
			if (r.noGoodMatch) abstainCorrect += 1;
			else {
				offenders.push(
					`  [should have abstained] "${p.need}"\n        -> ${r.matches.map((m) => m.programName).join(" | ")}`,
				);
			}
			if (verbose) console.log(`\n${r.noGoodMatch ? "✓" : "✗"} [abstain] ${p.need}`);
			continue;
		}

		if (r.noGoodMatch || r.matches.length === 0) {
			emptyWhenShouldAnswer += 1;
			offenders.push(`  [no results] ${p.topic}: "${p.need}"`);
			if (verbose) console.log(`\n✗ [${p.topic}] ${p.need}\n      (no good match)`);
			continue;
		}

		const verdicts = await judge(p.intent, p.need, r.matches);
		if (verbose) console.log(`\n[${p.topic}] "${p.need}"`);

		r.matches.forEach((m, i) => {
			const v: Verdict | undefined =
				verdicts.find((x: Verdict) => x.program.trim() === m.programName.trim()) ?? verdicts[i];
			const ok = v?.relevant ?? true;
			shown += 1;
			if (ok) relevant += 1;
			else {
				offenders.push(
					`  [irrelevant] ${p.topic}: "${p.need}"\n        -> ${m.programName} (${v?.why ?? "?"})`,
				);
			}
			if (verbose) {
				console.log(`      ${ok ? "✓" : "✗"} ${m.programName}${ok ? "" : `  — ${v?.why}`}`);
			}
		});
	}

	const answerable = selected.filter((p) => !p.expectAbstain).length;
	const abstainCases = selected.length - answerable;
	const precision = shown ? ((relevant / shown) * 100).toFixed(1) : "—";

	console.log(`\n${"=".repeat(66)}`);
	console.log(`RELEVANCE   ${relevant}/${shown} cards judged relevant   (precision ${precision}%)`);
	console.log(`COVERAGE    ${answerable - emptyWhenShouldAnswer}/${answerable} needs returned results`);
	if (abstainCases) {
		console.log(`ABSTENTION  ${abstainCorrect}/${abstainCases} correctly returned nothing`);
	}
	if (offenders.length) {
		console.log(`${"=".repeat(66)}`);
		console.log(offenders.join("\n"));
	}
	console.log("");
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
