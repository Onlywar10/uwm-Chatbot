import { createEnv } from "@t3-oss/env-nextjs";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export const env = createEnv({
	server: {
		NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
		DATABASE_URL: z.string().min(1),
		QSTASH_TOKEN: z.string().min(1),
		QSTASH_URL: z.string().url(),
		// Model used by the internal /admin analytics chat (resolved via AI Gateway).
		// Swap to e.g. "anthropic/claude-sonnet-4-5" without code changes.
		ANALYTICS_MODEL: z.string().min(1).default("openai/gpt-4o"),
	},
	client: {},
	experimental__runtimeEnv: process.env,
});
