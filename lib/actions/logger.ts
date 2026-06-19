import { z } from "zod";

// Lightweight console logger used by the crawl pipeline. The upstream variant
// persisted to a `dev_logs` table; this app deliberately omits that table, so
// logs go to the server console only.
const insertLogSchema = z.object({
	level: z.enum(["info", "warn", "error"]),
	source: z.string().min(1),
	message: z.string().min(1),
	metadata: z.unknown().optional(),
	crawlRunId: z.string().optional(),
});

export async function log(input: unknown) {
	const { level, source, message, metadata, crawlRunId } = insertLogSchema.parse(input);

	const prefix = `[${source}]${crawlRunId ? ` (run ${crawlRunId})` : ""}`;
	const line = `${prefix} ${message}`;

	if (level === "error") {
		console.error(line, metadata ?? "");
	} else if (level === "warn") {
		console.warn(line, metadata ?? "");
	} else {
		console.log(line, metadata ?? "");
	}
}
