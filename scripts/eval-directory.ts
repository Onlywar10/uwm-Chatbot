/**
 * Golden-set evaluation for resource retrieval.
 *
 * The original ranking was tuned against nine ad-hoc searches, which is how a
 * same-city bonus ended up outweighing relevance and a 40-row cap ended up
 * discarding 200+ eligible programs. This harness makes ranking changes measurable:
 * every case names what a good answer looks like, and the runner reports whether it
 * appeared in the three cards a user actually sees.
 *
 *   pnpm eval:directory            # summary
 *   pnpm eval:directory --verbose  # per-case cards
 *
 * A case passes when at least one `expect` pattern matches a card in the top 3.
 * `forbid` patterns catch known-bad results (out-of-area programs, policy pages).
 * Patterns are case-insensitive substrings of "<programName> — <agencyName>".
 */
import { searchDirectory } from "@/lib/directory/search";

type Case = {
	label: string;
	need: string;
	city?: string;
	zip?: string;
	county?: string;
	/** At least one must appear in the top 3. Omitted when expectNoMatch is set. */
	expect?: string[];
	/** None of these may appear in the top 3. */
	forbid?: string[];
	/** Set when the honest answer is "nothing good here". */
	expectNoMatch?: boolean;
};

export const cases: Case[] = [
	// --- Core safety-net verticals -------------------------------------------
	{
		label: "food – conversational",
		need: "I need food for my family",
		city: "merced",
		expect: ["food bank", "emergency food", "food distribution", "pantry", "calfresh"],
	},
	{
		label: "food – short vocabulary",
		need: "food pantry",
		city: "merced",
		expect: ["food bank", "emergency food", "food distribution", "pantry"],
	},
	{
		label: "rent / eviction",
		need: "behind on rent, facing eviction",
		city: "merced",
		expect: ["rent", "housing", "eviction", "tenant", "homeless"],
	},
	{
		label: "utility bill",
		need: "help paying my utility bill",
		city: "atwater",
		expect: ["liheap", "energy", "reach", "arrearage", "care"],
		forbid: ["discontinuation policy"],
	},
	{
		label: "utilities – short",
		need: "electric bill assistance",
		city: "merced",
		expect: ["liheap", "energy", "reach", "care", "arrearage"],
	},
	{
		label: "cooling center (heat emergency)",
		need: "I need a cooling center, it is too hot",
		city: "mariposa",
		expect: ["cooling"],
	},
	{
		label: "cooling center – Merced",
		need: "somewhere to cool off during the heat wave",
		city: "atwater",
		expect: ["cooling"],
	},
	{
		label: "domestic violence",
		need: "domestic violence shelter",
		city: "merced",
		expect: ["crisis center", "domestic", "shelter", "valley crisis"],
	},
	{
		label: "clothing",
		need: "free clothes for my kids",
		city: "merced",
		expect: ["clothing", "clothes", "boutique", "thrift"],
		forbid: ["game night"],
	},
	{
		label: "baby supplies",
		need: "diapers and formula for a newborn",
		city: "merced",
		expect: ["wic", "maternity", "baby", "infant"],
		// NOTE: "Golden State Start" (Baby2Baby, Los Angeles) was originally forbidden
		// here, on the assumption that an LA address made it irrelevant. On review it
		// is a genuine CA-wide baby-supply program, so appearing BELOW a local option
		// is correct behaviour, not a defect. What mattered was that it stopped taking
		// the top card — which the remote penalty fixed. Assertion corrected rather
		// than the ranking bent to satisfy a wrong expectation.
	},
	{
		label: "childcare",
		need: "I need help with childcare",
		city: "los banos",
		expect: ["child care", "childcare", "access", "calworks", "head start"],
	},
	{
		label: "youth mental health",
		need: "mental health counseling for a teenager",
		city: "merced",
		expect: ["behavioral health", "mental health", "counsel", "youth", "children"],
	},
	{
		label: "transportation",
		need: "transportation to a doctor appointment",
		city: "merced",
		expect: ["transportation", "transit", "paratransit", "rides"],
	},
	{
		label: "legal aid",
		need: "legal help with an eviction notice",
		city: "merced",
		expect: ["legal", "tenant", "self help", "fair housing"],
	},
	{
		label: "senior services",
		need: "meals for my elderly mother",
		city: "merced",
		expect: ["senior", "meals", "aging", "nutrition", "food"],
	},
	{
		label: "health insurance",
		need: "I need help signing up for Medi-Cal",
		city: "merced",
		expect: ["medi-cal", "health", "insurance", "alliance", "human services"],
	},
	{
		label: "substance use",
		need: "my son needs help with drug addiction",
		city: "merced",
		expect: ["recovery", "substance", "behavioral health", "treatment", "addiction"],
	},
	{
		label: "homeless shelter",
		need: "I have nowhere to sleep tonight",
		city: "merced",
		expect: ["shelter", "rescue mission", "homeless", "housing"],
	},
	{
		label: "job help",
		need: "looking for work",
		city: "merced",
		expect: ["employment", "worknet", "job", "workforce", "career"],
	},
	{
		label: "veteran services",
		need: "I am a veteran and need help",
		city: "merced",
		expect: ["veteran"],
	},

	// --- Location handling ----------------------------------------------------
	{
		label: "zip instead of city",
		need: "food assistance",
		zip: "95340",
		expect: ["food", "pantry", "calfresh"],
	},
	{
		label: "small town – Mariposa",
		need: "help with groceries",
		city: "coulterville",
		expect: ["food", "pantry", "nutrition", "meals"],
	},
	{
		label: "county only",
		need: "housing assistance",
		county: "mariposa",
		expect: ["housing", "rent", "shelter", "homeless"],
	},
	{
		label: "no location given",
		need: "I need help paying rent",
		expect: ["rent", "housing", "eviction", "homeless"],
	},

	// --- Honesty --------------------------------------------------------------
	{
		label: "nonsense query stays honest",
		need: "asdkjfh qwerty zzzz",
		city: "merced",
		expectNoMatch: true,
	},
	{
		label: "out-of-domain stays honest",
		need: "I want to buy a sports car",
		city: "merced",
		expectNoMatch: true,
	},
];

const norm = (s: string) => s.toLowerCase();

async function run() {
	const verbose = process.argv.includes("--verbose");
	let passed = 0;
	const failures: string[] = [];

	for (const c of cases) {
		const r = await searchDirectory({
			need: c.need,
			city: c.city,
			zip: c.zip,
			county: c.county,
		});
		const cards = r.matches.map((m) => `${m.programName} — ${m.agencyName ?? ""}`);
		const hay = cards.map(norm);

		let ok: boolean;
		let why = "";

		if (c.expectNoMatch) {
			ok = r.noGoodMatch;
			if (!ok) why = `expected noGoodMatch, got: ${cards.join(" | ")}`;
		} else if (r.noGoodMatch) {
			ok = false;
			why = "noGoodMatch (expected results)";
		} else {
			const hit = (c.expect ?? []).some((p) => hay.some((h) => h.includes(norm(p))));
			const bad = (c.forbid ?? []).filter((p) => hay.some((h) => h.includes(norm(p))));
			ok = hit && bad.length === 0;
			if (!hit) why = `no expected match in top 3: ${cards.join(" | ")}`;
			else if (bad.length) why = `forbidden result present (${bad.join(", ")}): ${cards.join(" | ")}`;
		}

		if (ok) passed += 1;
		else failures.push(`  ✗ ${c.label}\n      ${why}`);

		if (verbose) {
			console.log(`\n${ok ? "✓" : "✗"} ${c.label}  ("${c.need}"${c.city ? ` / ${c.city}` : ""})`);
			if (r.noGoodMatch) console.log("      (no good match)");
			for (const m of r.matches) {
				console.log(`      • ${m.programName} — ${m.agencyName ?? "?"}  [${m.locality}]`);
			}
			console.log(`      total=${r.totalMatches} more=${r.moreCount}`);
		}
	}

	const pct = ((passed / cases.length) * 100).toFixed(0);
	console.log(`\n${"=".repeat(60)}`);
	console.log(`Directory retrieval: ${passed}/${cases.length} passed (${pct}%)`);
	if (failures.length) {
		console.log(`${"=".repeat(60)}`);
		console.log(failures.join("\n"));
	}
	console.log("");
	process.exit(failures.length ? 1 : 0);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
