"use server";

import { eq } from "drizzle-orm";
import { db } from "../db";
import { widgetConfigs } from "../db/schema/widgetConfigs";
import { z } from "zod";
import { requireRole } from "../auth/guards";

export async function getWidget(id: string) {
	const rows = await db
		.select()
		.from(widgetConfigs)
		.where(eq(widgetConfigs.id, id))
		.limit(1);

	return rows[0] ?? null;
}

const insertWidgetSchema = z.object({
	name: z.string().min(1),
	domains: z.array(z.string().min(1)).min(1),
	greeting: z.string().optional(),
	accentColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6,8}$/)
		.optional(),
});

export async function addWidget(input: unknown) {
	await requireRole("admin");

	try {
		const parsed = insertWidgetSchema.parse(input);

		return await db.transaction(async (tx) => {
			const [widget] = await tx
				.insert(widgetConfigs)
				.values(parsed)
				.returning({ id: widgetConfigs.id, name: widgetConfigs.name });

			return {
				ok: true as const,
				widgetId: widget.id,
				name: widget.name,
			};
		});
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof Error && error.message.length > 0
					? error.message
					: "Error, please try again.",
		};
	}
}
