import { syncDirectory } from "./index";

async function main() {
	console.log("⏳ Syncing 211 resource directory from iCarol...");
	const stats = await syncDirectory((msg) => console.log(`   ${msg}`));
	console.log("✅ Sync complete.");
	console.log(`   programs swept:      ${stats.programsSwept}`);
	console.log(`   programs imported:   ${stats.programsImported}`);
	console.log(`   rows (program×site): ${stats.rows} (${stats.rowsWithAddress} with address)`);
	console.log(`   taxonomy fetched:    ${stats.taxonomyFetched}`);
	console.log(
		`   embeddings:          ${stats.embeddingsComputed} computed, ${stats.embeddingsReused} reused`,
	);
	console.log(`   duration:            ${Math.round(stats.durationMs / 1000)}s`);
	process.exit(0);
}

main().catch((err) => {
	console.error("❌ Directory sync failed");
	console.error(err);
	process.exit(1);
});
