/**
 * Distance helpers for proximity-based referral ranking.
 *
 * Why distance rather than city membership: a food pantry two miles away in the
 * next town is more useful than one on the far side of your own city, but a
 * city/zip only tells us which bucket someone is in, not how far anything is.
 * 1,205 of 1,278 directory rows carry coordinates, so once a visitor shares their
 * location we can rank on the real thing.
 */

const EARTH_RADIUS_MILES = 3958.8;

export type Coords = { latitude: number; longitude: number };

/** True when a value pair is usable as a coordinate. */
export function isValidCoords(
	latitude: number | null | undefined,
	longitude: number | null | undefined,
): boolean {
	return (
		typeof latitude === "number" &&
		typeof longitude === "number" &&
		Number.isFinite(latitude) &&
		Number.isFinite(longitude) &&
		Math.abs(latitude) <= 90 &&
		Math.abs(longitude) <= 180 &&
		// 0,0 is in the Atlantic and is what a broken geocode looks like.
		!(latitude === 0 && longitude === 0)
	);
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in miles. */
export function distanceMiles(a: Coords, b: Coords): number {
	const dLat = toRad(b.latitude - a.latitude);
	const dLon = toRad(b.longitude - a.longitude);
	const lat1 = toRad(a.latitude);
	const lat2 = toRad(b.latitude);

	const h =
		Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
	return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Human phrasing for a card. Deliberately coarse: the coordinate we hold is a
 * building, and implying more precision than "about a mile" is false confidence.
 */
export function formatDistance(miles: number | null | undefined): string | null {
	if (typeof miles !== "number" || !Number.isFinite(miles) || miles < 0) return null;
	if (miles < 0.1) return "Less than 0.1 mi away";
	if (miles < 10) return `${miles.toFixed(1)} mi away`;
	return `${Math.round(miles)} mi away`;
}
