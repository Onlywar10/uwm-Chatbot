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

	accentColor: varchar("accent_color", { length: 9 }),

	enabled: boolean("enabled").notNull().default(true),

	createdAt: timestamp("created_at").notNull().default(sql`now()`),

	updatedAt: timestamp("updated_at")
		.notNull()
		.default(sql`now()`)
		.$onUpdateFn(() => new Date()),
});
