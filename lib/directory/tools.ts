import { tool } from "ai";
import { z } from "zod";

import { getDirectoryProgram, searchDirectory } from "./search";

export type DirectoryToolLog = {
	tool: string;
	input: unknown;
	resultCount: number;
	programIds?: string[];
	error?: string;
};

const TOOL_ERROR = {
	error:
		"The resource search failed to run. Tell the user something went wrong and that they can always dial 2-1-1 to talk to a live specialist.",
};

const searchResourcesInputSchema = z.object({
	need: z
		.string()
		.min(3)
		.describe(
			'The person\'s need in plain language, as specific as they made it, e.g. "behind on rent, facing eviction" or "free food for a family this weekend".',
		),
	city: z
		.string()
		.optional()
		.describe('City or community the person is in, e.g. "Atwater". Prefer this over county.'),
	zip: z
		.string()
		.optional()
		.describe("5-digit zip code, if the person gave one instead of a city."),
	county: z
		.string()
		.optional()
		.describe('Only when the person gave a county instead of a city: "Merced" or "Mariposa".'),
	taxonomyContains: z
		.string()
		.optional()
		.describe(
			'Optional filter against official service-category names, e.g. "Food Pantries" or "Rent Payment Assistance". Use only when confident; the need text already searches semantically.',
		),
	offset: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe(
			"Row offset for paging. Use the previous result's offset + 3 when the user asks for more options.",
		),
});

const getResourceDetailsInputSchema = z.object({
	id: z.string().describe("The `id` of a resource returned by searchResources."),
});

/**
 * Resource-referral tools over the mirrored 211 directory (lib/directory/).
 * Registered only for widgets with resource search enabled. A log array is
 * passed in so the route can record calls + displayed programs (telemetry).
 */
/**
 * Coordinates the visitor chose to share, resolved server-side from the request.
 * Deliberately NOT a tool input: the model must not be able to invent or alter a
 * location, and a shared location is a fact about the request rather than
 * something to reason about.
 */
export type UserLocation = { latitude: number; longitude: number } | null;

export function createDirectoryTools(log: DirectoryToolLog[], userLocation: UserLocation = null) {
	return {
		searchResources: tool({
			description:
				"Search the 211 Merced/Mariposa resource directory for programs that can help with a " +
				"person's need (food, housing, utilities, transportation, health care, etc.). Returns at " +
				"most 3 matches — these render as cards the user sees, so never restate their phone " +
				"numbers, addresses, or hours in your reply. Also returns totalMatches/moreCount (offer to " +
				"narrow or show more), citiesRepresented (ask which city only when this shows results span " +
				"cities), noGoodMatch (be honest and point to dialing 2-1-1), and locationNote (relay it). " +
				"Gather the person's city or zip before calling; results are region-wide without it. " +
				"If the person has shared their device location, the system supplies it automatically and " +
				"results are already sorted by real distance — do not ask for a city in that case.",
			inputSchema: searchResourcesInputSchema,
			execute: async (input) => {
				try {
					const result = await searchDirectory({
						...input,
						// Shared coordinates win over anything the model inferred: they are
						// precise, and they let a program in the next town outrank a farther
						// one in the visitor's own city.
						latitude: userLocation?.latitude ?? null,
						longitude: userLocation?.longitude ?? null,
					});
					log.push({
						tool: "searchResources",
						input,
						resultCount: result.matches.length,
						programIds: result.matches.map((m) => m.id),
					});
					return result;
				} catch (err) {
					log.push({
						tool: "searchResources",
						input,
						resultCount: 0,
						error: err instanceof Error ? err.message : String(err),
					});
					return TOOL_ERROR;
				}
			},
		}),

		getResourceDetails: tool({
			description:
				"Fetch the full record for one previously returned resource, for follow-up questions " +
				"(required documents, application process, full hours, fees, languages). Answer such " +
				"follow-ups in plain text from this data; do not re-run searchResources.",
			inputSchema: getResourceDetailsInputSchema,
			execute: async (input) => {
				try {
					const program = await getDirectoryProgram(input.id);
					log.push({
						tool: "getResourceDetails",
						input,
						resultCount: program ? 1 : 0,
						programIds: program ? [program.id] : [],
					});
					return program ?? { error: "No resource with that id — it may have left the directory." };
				} catch (err) {
					log.push({
						tool: "getResourceDetails",
						input,
						resultCount: 0,
						error: err instanceof Error ? err.message : String(err),
					});
					return TOOL_ERROR;
				}
			},
		}),
	};
}
