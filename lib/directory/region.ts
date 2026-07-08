/**
 * Static geography for the 211 service region (Merced + Mariposa counties).
 * Used to turn a user's city/zip/county into service_areas tokens that match
 * the coverage tokens written by the sync (see transform.ts).
 *
 * Programs in the shared iCarol database cover other California counties too;
 * searches with no usable location fall back to the whole region so those rows
 * simply never surface.
 */

const CITY_TO_COUNTY: Record<string, "merced" | "mariposa"> = {
	// Merced County
	atwater: "merced",
	ballico: "merced",
	cressey: "merced",
	delhi: "merced",
	"dos palos": "merced",
	"south dos palos": "merced",
	"el nido": "merced",
	gustine: "merced",
	"santa nella": "merced",
	hilmar: "merced",
	"le grand": "merced",
	livingston: "merced",
	"los banos": "merced",
	merced: "merced",
	planada: "merced",
	snelling: "merced",
	stevinson: "merced",
	winton: "merced",
	// Mariposa County
	mariposa: "mariposa",
	"catheys valley": "mariposa",
	coulterville: "mariposa",
	"greeley hill": "mariposa",
	"el portal": "mariposa",
	"fish camp": "mariposa",
	hornitos: "mariposa",
	midpines: "mariposa",
	wawona: "mariposa",
	"yosemite national park": "mariposa",
};

const ZIP_TO_CITY: Record<string, string> = {
	// Merced County
	"95301": "atwater",
	"95303": "ballico",
	"95312": "cressey",
	"95315": "delhi",
	"93620": "dos palos",
	"93665": "south dos palos",
	"95317": "el nido",
	"95322": "gustine",
	"95324": "hilmar",
	"95333": "le grand",
	"95334": "livingston",
	"93635": "los banos",
	"95340": "merced",
	"95341": "merced",
	"95343": "merced",
	"95344": "merced",
	"95348": "merced",
	"95365": "planada",
	"95369": "snelling",
	"95374": "stevinson",
	"95388": "winton",
	// Mariposa County
	"95338": "mariposa",
	"95306": "catheys valley",
	"95311": "coulterville",
	"95318": "el portal",
	"93623": "fish camp",
	"95325": "hornitos",
	"95345": "midpines",
	"95389": "yosemite national park",
};

function cityTokensForCounty(county: "merced" | "mariposa"): string[] {
	return Object.entries(CITY_TO_COUNTY)
		.filter(([, c]) => c === county)
		.map(([city]) => `city:${city}`);
}

export type ResolvedLocation = {
	/** service_areas tokens a matching program must overlap with */
	tokens: string[];
	/** Normalized city/county when known — used for location tiering */
	city: string | null;
	county: string | null;
	/** Caveat the model should relay when location handling was imperfect */
	note: string | null;
};

/**
 * Resolve a user-supplied location to matching tokens.
 *
 * - zip → city + county (statewide programs always match via state:ca)
 * - city → its county when we know it; unknown cities keep the city token but
 *   can't match county-scoped coverage, so we widen to the whole region and say so
 * - county → every city in it plus the county itself
 * - nothing → the whole two-county region
 */
export function resolveUserLocation(input: {
	city?: string;
	zip?: string;
	county?: string;
}): ResolvedLocation {
	const zip = input.zip?.trim();
	let city = input.city?.trim().toLowerCase() || null;
	const note: string | null = null;

	if (zip) {
		const zipCity = ZIP_TO_CITY[zip];
		if (zipCity) {
			city = zipCity;
		} else if (!city) {
			return {
				...regionWide(),
				note: `Zip ${zip} isn't in the Merced/Mariposa lookup — searched the whole region instead. Asking for the city may narrow results.`,
			};
		}
	}

	if (city) {
		const county = CITY_TO_COUNTY[city] ?? null;
		if (!county) {
			const region = regionWide();
			return {
				tokens: [...new Set([`city:${city}`, ...region.tokens])],
				city,
				county: null,
				note: `"${city}" isn't in the Merced/Mariposa city map — results include the whole region. If the person is outside Merced/Mariposa counties, suggest calling 2-1-1.`,
			};
		}
		return {
			tokens: [`city:${city}`, ...(zip ? [`zip:${zip}`] : []), `county:${county}`, "state:ca"],
			city,
			county,
			note,
		};
	}

	const countyInput = input.county
		?.trim()
		.toLowerCase()
		.replace(/\s+county$/, "");
	if (countyInput === "merced" || countyInput === "mariposa") {
		return {
			tokens: [`county:${countyInput}`, ...cityTokensForCounty(countyInput), "state:ca"],
			city: null,
			county: countyInput,
			note,
		};
	}
	if (countyInput) {
		return {
			...regionWide(),
			note: `"${countyInput}" isn't Merced or Mariposa County — searched the whole region. If the person lives elsewhere, suggest calling 2-1-1 for their local directory.`,
		};
	}

	return regionWide();
}

/** All tokens for the two-county service region (the no-location default). */
export function regionWide(): ResolvedLocation {
	return {
		tokens: [
			"county:merced",
			"county:mariposa",
			...cityTokensForCounty("merced"),
			...cityTokensForCounty("mariposa"),
			"state:ca",
		],
		city: null,
		county: null,
		note: null,
	};
}
