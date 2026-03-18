"use server";

import { schools } from "../db/schema/schools";
import { db } from "../db";
import { z } from "zod";

const insertSchoolSchema = z.object({
	name: z.string().min(1),
	districtId: z.string().min(1),
	domain: z.string().min(1),
});

export async function addSchool(input: unknown) {
	try {
		const parsed = insertSchoolSchema.parse(input);

		return await db.transaction(async (tx) => {
			const [school] = await tx
				.insert(schools)
				.values(parsed)
				.returning({ id: schools.id, name: schools.name });

			return {
				ok: true as const,
				schoolId: school.id,
				name: school.name,
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
