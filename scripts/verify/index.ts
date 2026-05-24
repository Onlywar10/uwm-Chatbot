import { parseSources } from "@/lib/import/parse";
import { goldenCases } from "./cases";

function getArg(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Cross-checks the analytics builder (DB) against values computed straight from
 * the CSVs. The DB must already be loaded from the SAME files (pnpm db:import).
 */
async function main() {
	const callsPath = getArg("--calls");
	const referralsPath = getArg("--referrals");
	if (!callsPath || !referralsPath) {
		console.error(
			"Usage: pnpm verify:queries --calls <master_file.csv> --referrals <unmet_met.csv>",
		);
		process.exit(1);
	}

	console.log("⏳ Parsing CSVs for ground truth...");
	const data = parseSources(callsPath, referralsPath);

	let pass = 0;
	let fail = 0;
	for (const c of goldenCases) {
		const expected = c.expected(data);
		const actual = await c.actual();
		const ok = c.tolerance ? Math.abs(expected - actual) <= c.tolerance : expected === actual;
		console.log(`${ok ? "✅" : "❌"} ${c.name}: expected ${expected}, got ${actual}`);
		ok ? pass++ : fail++;
	}

	console.log(`\n${pass} passed, ${fail} failed.`);
	process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error("❌ Verification failed to run");
	console.error(err);
	process.exit(1);
});
