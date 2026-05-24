import { computeCoverage } from "./coverage";
import { load } from "./load";
import { parseSources } from "./parse";

function getArg(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
	const callsPath = getArg("--calls");
	const referralsPath = getArg("--referrals");
	if (!callsPath || !referralsPath) {
		console.error("Usage: pnpm db:import --calls <master_file.csv> --referrals <unmet_met.csv>");
		process.exit(1);
	}

	console.log("⏳ Parsing CSVs...");
	const data = parseSources(callsPath, referralsPath);
	console.log(
		`   calls=${data.calls.length}  needs=${data.needs.length}  referrals=${data.referrals.length}`,
	);

	const coverage = computeCoverage(data.calls, data.needs);

	console.log("⏳ Loading into database (truncate + reload)...");
	await load(data, coverage);
	console.log("✅ Load complete.");

	if (data.rejects.length) {
		console.log(`\n⚠️  ${data.rejects.length} rejected rows:`);
		for (const r of data.rejects.slice(0, 50)) console.log(`   [${r.file}:${r.row}] ${r.reason}`);
		if (data.rejects.length > 50) console.log(`   ... and ${data.rejects.length - 50} more`);
	} else {
		console.log("\n✅ No rejected rows.");
	}

	const unmapped = data.canonicalizer.report();
	if (unmapped.length) {
		console.log(
			`\n⚠️  ${unmapped.length} unmapped canonical values (passed through raw — add to lib/data/canonical-maps.ts):`,
		);
		for (const u of unmapped) console.log(`   [${u.field}] "${u.value}" ×${u.count}`);
	} else {
		console.log("✅ No unmapped canonical values.");
	}

	process.exit(0);
}

main().catch((err) => {
	console.error("❌ Import failed");
	console.error(err);
	process.exit(1);
});
