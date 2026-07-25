import { nanoid } from "@/lib/utils";
import { pgTable, text, varchar, timestamp, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const widgetConfigs = pgTable("widget_configs", {
	id: varchar("id", { length: 191 })
		.primaryKey()
		.$defaultFn(() => nanoid()),

	name: text("name").notNull(),

	domains: text("domains").array().default(sql`'{}'::text[]`).notNull(),

	greeting: text("greeting"),

	suggestedQuestions: text("suggested_questions").array().default(sql`'{}'::text[]`).notNull(),

	accentColor: varchar("accent_color", { length: 9 }),

	enabled: boolean("enabled").notNull().default(true),

	// Per-widget token the public widget page renders and its client echoes back on
	// every POST /api/chat. Not a secret (it ships to the browser) and not an auth
	// mechanism — it exists so a guessed or scraped widget id alone can't be used to
	// drive the bot from a script, and so a widget being abused can be cut off by
	// rotating one row instead of taking the endpoint down.
	widgetToken: varchar("widget_token", { length: 64 })
		.notNull()
		.$defaultFn(() => nanoid(32)),

	// Opt-in 211 resource referral mode (lib/directory/ tools + intake prompt).
	// Off by default so school-district tenants never see social-service intake.
	enableResourceSearch: boolean("enable_resource_search").notNull().default(false),

	createdAt: timestamp("created_at").notNull().default(sql`now()`),

	updatedAt: timestamp("updated_at")
		.notNull()
		.default(sql`now()`)
		.$onUpdateFn(() => new Date()),
});
