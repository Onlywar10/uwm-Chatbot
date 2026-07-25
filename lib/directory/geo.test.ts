import { describe, expect, it } from "vitest";
import { distanceMiles, formatDistance, isValidCoords } from "./geo";

// Real places in the service region, used so the assertions mean something.
const MERCED = { latitude: 37.3022, longitude: -120.4829 };
const ATWATER = { latitude: 37.3477, longitude: -120.6091 };
const LOS_BANOS = { latitude: 37.0583, longitude: -120.8499 };

describe("distanceMiles", () => {
	it("is zero for the same point", () => {
		expect(distanceMiles(MERCED, MERCED)).toBeCloseTo(0, 5);
	});

	it("matches known distances in the service region", () => {
		// Merced -> Atwater is about 7-8 miles.
		expect(distanceMiles(MERCED, ATWATER)).toBeGreaterThan(6);
		expect(distanceMiles(MERCED, ATWATER)).toBeLessThan(9);
		// Merced -> Los Banos is about 25-30 miles.
		expect(distanceMiles(MERCED, LOS_BANOS)).toBeGreaterThan(23);
		expect(distanceMiles(MERCED, LOS_BANOS)).toBeLessThan(32);
	});

	it("is symmetric", () => {
		expect(distanceMiles(MERCED, LOS_BANOS)).toBeCloseTo(distanceMiles(LOS_BANOS, MERCED), 6);
	});

	it("demonstrates the case this feature exists for", () => {
		// Someone in Atwater: a program in Atwater beats one across Merced, even
		// though a city-based rule would rank every Merced result the same.
		const inAtwater = { latitude: 37.3489, longitude: -120.6055 };
		const acrossMerced = { latitude: 37.2895, longitude: -120.4351 };
		expect(distanceMiles(ATWATER, inAtwater)).toBeLessThan(distanceMiles(ATWATER, acrossMerced));
	});
});

describe("isValidCoords", () => {
	it("accepts real coordinates", () => {
		expect(isValidCoords(37.3022, -120.4829)).toBe(true);
	});

	it("rejects nulls, non-finite values and out-of-range", () => {
		expect(isValidCoords(null, -120)).toBe(false);
		expect(isValidCoords(37, undefined)).toBe(false);
		expect(isValidCoords(Number.NaN, -120)).toBe(false);
		expect(isValidCoords(91, 0)).toBe(false);
		expect(isValidCoords(37, 181)).toBe(false);
	});

	it("rejects 0,0, which is what a failed geocode looks like", () => {
		expect(isValidCoords(0, 0)).toBe(false);
	});
});

describe("formatDistance", () => {
	it("keeps one decimal up close and rounds further out", () => {
		expect(formatDistance(0.05)).toBe("Less than 0.1 mi away");
		expect(formatDistance(2.34)).toBe("2.3 mi away");
		expect(formatDistance(24.6)).toBe("25 mi away");
	});

	it("returns null when there is no distance to show", () => {
		expect(formatDistance(null)).toBeNull();
		expect(formatDistance(undefined)).toBeNull();
		expect(formatDistance(Number.NaN)).toBeNull();
	});
});
