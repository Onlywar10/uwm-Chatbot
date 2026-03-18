import { nanoid } from "@/lib/utils";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { districts } from "./districts";

export const schools = pgTable("schools", {
	id: varchar("id", { length: 191 })
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	domain: varchar("domain", { length: 255 }).notNull(),
	createdAt: timestamp("created_at").notNull().default(sql`now()`),
	updatedAt: timestamp("updated_at")
		.notNull()
		.default(sql`now()`)
		.$onUpdateFn(() => new Date()),
	districtId: varchar("district_id", { length: 191 })
		.notNull()
		.references(() => districts.id, { onDelete: "cascade" }),
});
