import { boolean, pgEnum, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";

import { nanoid } from "@/lib/utils";

export const userRoleEnum = pgEnum("user_role", ["admin", "crawler"]);

export const users = pgTable("users", {
	id: varchar("id", { length: 191 })
		.primaryKey()
		.$defaultFn(() => nanoid()),

	email: varchar("email", { length: 255 }).notNull().unique(),

	passwordHash: varchar("password_hash", { length: 255 }).notNull(),

	role: userRoleEnum("role").notNull().default("crawler"),

	isActive: boolean("is_active").notNull().default(true),

	createdAt: timestamp("created_at").notNull().defaultNow(),
});


export const insertUserSchema = createInsertSchema(users).omit({
	id: true,
	createdAt: true, 
});

export type NewUserParams = z.infer<typeof insertUserSchema>;
