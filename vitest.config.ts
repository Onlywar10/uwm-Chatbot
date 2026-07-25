import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["lib/**/*.test.ts"],
	},
	resolve: {
		// Mirror the tsconfig "@/*" -> repo-root path alias so tests can import
		// modules the same way the app does.
		alias: {
			"@": fileURLToPath(new URL(".", import.meta.url)),
			// The "server-only" guard throws when imported outside an RSC bundle; stub it
			// to a noop so server-only utility modules can be exercised in unit tests.
			"server-only": fileURLToPath(new URL("./lib/test/server-only-stub.ts", import.meta.url)),
		},
	},
});
