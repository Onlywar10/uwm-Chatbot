import { nanoid } from "@/lib/utils";
import { sql } from "drizzle-orm";
import {
	boolean,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar,
	vector,
} from "drizzle-orm/pg-core";

export type DirectoryPhone = {
	label: string;
	number: string;
	description?: string;
};

export type DirectoryAddress = {
	line1?: string;
	line2?: string;
	city?: string;
	county?: string;
	stateProvince?: string;
	zipPostalCode?: string;
	/** Site name the address came from, when it differs from the program. */
	siteName?: string;
};

export type DirectoryHours = {
	note?: string;
	days: { dayOfWeek: string; opens?: string; closes?: string }[];
};

/**
 * Searchable 211 resource directory, mirrored nightly from the iCarol Resource
 * API (see lib/directory/). Grain: one row per Program × Site, so a row is a
 * concrete place a person can go or call; programs with no Site get a single
 * row with null location (falling back to the agency's address when public).
 *
 * The iCarol database is shared across California — rows whose serviceAreas
 * never match a local user are imported anyway and simply never surface.
 * Confidential contact details are stripped at import; nothing private is
 * stored here.
 *
 * serviceAreas holds normalized tokens derived from iCarol's structured
 * coverage[] field: "city:atwater", "county:merced", "zip:95365", or
 * "state:ca" for entries with no county/city (statewide programs).
 */
export const directoryPrograms = pgTable(
	"directory_programs",
	{
		id: varchar("id", { length: 191 })
			.primaryKey()
			.$defaultFn(() => nanoid()),

		// iCarol resource ids (natural keys in the source system)
		programId: integer("program_id").notNull(),
		siteId: integer("site_id"),
		agencyId: integer("agency_id"),

		programName: text("program_name").notNull(),
		agencyName: text("agency_name"),
		siteName: text("site_name"),
		description: text("description"),

		taxonomyCodes: text("taxonomy_codes").array().default(sql`'{}'::text[]`).notNull(),
		taxonomyNames: text("taxonomy_names").array().default(sql`'{}'::text[]`).notNull(),

		serviceAreas: text("service_areas").array().default(sql`'{}'::text[]`).notNull(),
		// Human-readable coverage summary for cards, e.g. "Serves Merced County"
		coverageDisplay: text("coverage_display"),

		eligibility: text("eligibility"),
		languages: text("languages"),
		fees: text("fees"),
		applicationProcess: text("application_process"),
		requiredDocumentation: text("required_documentation"),

		hours: jsonb("hours").$type<DirectoryHours | null>(),
		phones: jsonb("phones").$type<DirectoryPhone[]>().default([]).notNull(),
		website: varchar("website", { length: 1024 }),

		address: jsonb("address").$type<DirectoryAddress | null>(),
		// Denormalized from address for cheap filtering/sorting
		city: varchar("city", { length: 128 }),
		county: varchar("county", { length: 128 }),
		latitude: doublePrecision("latitude"),
		longitude: doublePrecision("longitude"),
		addressIsPrivate: boolean("address_is_private").notNull().default(false),

		lastVerifiedOn: timestamp("last_verified_on"),

		// Composed searchable text (what the embedding was computed over) and its
		// hash, used to reuse embeddings across syncs when content is unchanged.
		embeddingText: text("embedding_text").notNull(),
		contentHash: varchar("content_hash", { length: 64 }).notNull(),
		embedding: vector("embedding", { dimensions: 1536 }).notNull(),

		// A SECOND, deliberately narrow embedding over just "what this program is":
		// name + AIRS taxonomy + a short description snippet.
		//
		// The full embeddingText above averages ~700 chars of description, eligibility,
		// coverage and address. Cosine between a three-word query ("winter coats") and
		// that blob lands around 0.25 even for a perfect topical match — barely above
		// where off-topic junk sits (~0.24) — so no similarity threshold could separate
		// a real need from nonsense. The narrow text restores that separation, and is
		// what ranking and the honesty gate key off.
		topicText: text("topic_text"),
		topicEmbedding: vector("topic_embedding", { dimensions: 1536 }),

		syncedAt: timestamp("synced_at").notNull().default(sql`now()`),
	},
	(t) => [
		index("directory_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
		index("directory_topic_embedding_idx").using("hnsw", t.topicEmbedding.op("vector_cosine_ops")),
		index("directory_service_areas_idx").using("gin", t.serviceAreas),
		index("directory_program_id_idx").on(t.programId),
		index("directory_city_idx").on(t.city),
	],
);

export type DirectoryProgram = typeof directoryPrograms.$inferSelect;
export type NewDirectoryProgram = typeof directoryPrograms.$inferInsert;
