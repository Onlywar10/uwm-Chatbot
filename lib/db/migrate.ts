import { env } from "@/lib/env.mjs";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

async function run() {
	const pool = new Pool({ connectionString: env.DATABASE_URL });
	const db = drizzle(pool);

	console.log("⏳ Running migrations...");
	const start = Date.now();

	await migrate(db, { migrationsFolder: "lib/db/migrations" });

	const end = Date.now();
	console.log("✅ Migrations completed in", end - start, "ms");

	await pool.end();
}

run().catch((err) => {
	console.error("❌ Migration failed");
	console.error(err);
	process.exit(1);
});
