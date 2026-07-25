import { describe, expect, it } from "vitest";
import { isDialable, splitExtension, toTelHref } from "./phone";

describe("isDialable", () => {
	it("rejects the URL that reached a Call button in production", () => {
		expect(isDialable("https://www.facebook.com/people/Food-Para-todos/100086979151946/")).toBe(
			false,
		);
	});

	it("rejects other non-phone values found in the live phones column", () => {
		expect(isDialable("https://benefitscal.com/")).toBe(false);
		expect(isDialable("www.example.org")).toBe(false);
		expect(isDialable("resourcecenter@211sandiego.org")).toBe(false);
		expect(isDialable("call the office")).toBe(false);
		expect(isDialable("")).toBe(false);
		expect(isDialable(null)).toBe(false);
	});

	it("keeps short codes that people genuinely dial or text", () => {
		// A length-based rule would have wrongly killed all of these.
		expect(isDialable("9-1-1")).toBe(true);
		expect(isDialable("7-1-1")).toBe(true);
		expect(isDialable("2-1-1")).toBe(true);
		expect(isDialable("898211")).toBe(true);
		expect(isDialable("898-211")).toBe(true);
	});

	it("accepts ordinary numbers, with and without extensions", () => {
		expect(isDialable("209-385-3000")).toBe(true);
		expect(isDialable("(209) 385-3000")).toBe(true);
		expect(isDialable("209-385-3000 ext 5001")).toBe(true);
		expect(isDialable("+1 209 385 3000")).toBe(true);
	});
});

describe("splitExtension", () => {
	it("separates the extension from the dialable part", () => {
		expect(splitExtension("209-385-3000 ext 5001")).toEqual({
			base: "209-385-3000",
			extension: "5001",
		});
		expect(splitExtension("209-385-3000 x12")).toEqual({ base: "209-385-3000", extension: "12" });
		expect(splitExtension("209-385-3000")).toEqual({ base: "209-385-3000", extension: null });
	});
});

describe("toTelHref", () => {
	it("excludes the extension so the href dials the right number", () => {
		// The old behaviour stripped non-digits from the whole string and produced
		// tel:20938530005001 — a wrong number.
		expect(toTelHref("209-385-3000 ext 5001")).toBe("tel:2093853000");
	});

	it("preserves a leading +", () => {
		expect(toTelHref("+1 209 385 3000")).toBe("tel:+12093853000");
	});

	it("returns null for anything not dialable", () => {
		expect(toTelHref("https://www.facebook.com/people/Food-Para-todos/100086979151946/")).toBeNull();
	});

	it("handles short codes", () => {
		expect(toTelHref("9-1-1")).toBe("tel:911");
		expect(toTelHref("898-211")).toBe("tel:898211");
	});
});
