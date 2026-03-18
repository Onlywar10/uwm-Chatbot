import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

import { nanoid } from "@/lib/utils";
import { users } from "./users";

export const sessions = pgTable("sessions", {
	id: varchar("id", { length: 191 })
		.primaryKey()
		.$defaultFn(() => nanoid()),

	tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),

	userId: varchar("user_id", { length: 191 })
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),

	expiresAt: timestamp("expires_at").notNull(),

	createdAt: timestamp("created_at").notNull().defaultNow(),
});
