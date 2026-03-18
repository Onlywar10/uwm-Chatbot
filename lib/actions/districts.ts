"use server";

import { eq } from "drizzle-orm";
import { db } from "../db";
import { districts } from "../db/schema/districts";
import { z } from "zod";

const insertDistrictSchema = z.object({
	name: z.string().min(1),
});

export async function addDistrict(input: unknown) {
	try {
		const parsed = insertDistrictSchema.parse(input);

		return await db.transaction(async (tx) => {
			const [district] = await tx
				.insert(districts)
				.values(parsed)
				.returning({ id: districts.id, name: districts.name });

			return {
				ok: true as const,
				districtId: district.id,
				name: district.name,
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

export async function purgeDistrict(id: string, name: string) {
	await db.delete(districts).where(eq(districts.id, id));
	return { message: `Purged district with name: ${name}` };
}
