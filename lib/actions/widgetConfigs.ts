"use server";

import { eq } from "drizzle-orm";
import { db } from "../db";
import { widgetConfigs } from "../db/schema/widgetConfigs";

export async function getWidget(id: string) {
	const rows = await db.select().from(widgetConfigs).where(eq(widgetConfigs.id, id)).limit(1);

	return rows[0] ?? null;
}
