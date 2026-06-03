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
		// Model used by the internal /admin analytics chat. Bare "provider/model"
		// string: routed via AI Gateway in prod, or talked to directly when that
		// provider's API key is set (see lib/analytics/model.ts). Override freely,
		// e.g. "openai/gpt-5.1", "openai/o4-mini", "anthropic/claude-sonnet-4-5".
		ANALYTICS_MODEL: z.string().min(1).default("openai/gpt-5"),
		// Optional: when set, the analytics chat talks to OpenAI directly via the
		// provider instead of the AI Gateway (useful for local dev when gateway
		// credits are unavailable). Production leaves this unset and uses the gateway.
		OPENAI_API_KEY: z.string().optional(),
		// Clerk (identity provider). Server-side API key.
		CLERK_SECRET_KEY: z.string().min(1),
	},
	client: {
		// Clerk publishable key, exposed to the browser by ClerkProvider.
		NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
	},
	// NEXT_PUBLIC_* vars are inlined by Next at build time, so t3-env needs them
	// listed explicitly here (server-only vars are read from process.env directly).
	experimental__runtimeEnv: {
		NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
	},
});
