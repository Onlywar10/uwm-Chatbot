import { nanoid } from "@/lib/utils";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const districts = pgTable("districts", {
	id: varchar("id", { length: 191 })
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	createdAt: timestamp("created_at").notNull().default(sql`now()`),
	updatedAt: timestamp("updated_at")
		.notNull()
		.default(sql`now()`)
		.$onUpdateFn(() => new Date()),
});
