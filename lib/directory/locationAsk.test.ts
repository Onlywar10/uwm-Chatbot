import { describe, expect, it } from "vitest";
import { asksForLocation } from "./locationAsk";

describe("asksForLocation", () => {
	it("matches the phrasing the referral prompt asks for", () => {
		expect(
			asksForLocation("I can find nearby options — what city or zip are you in?"),
		).toBe(true);
	});

	it("matches natural variations the model may produce", () => {
		for (const text of [
			"Happy to help with food. What city are you in?",
			"Which town are you closest to?",
			"Can you tell me your zip code so I can find something close by?",
			"Where are you located right now?",
			"What part of Merced County are you in?",
		]) {
			expect(asksForLocation(text), text).toBe(true);
		}
	});

	it("does not fire on ordinary replies", () => {
		for (const text of [
			"Here are three food pantries that can help this week.",
			"Sorry, I couldn't find a good match for that — you can dial 2-1-1.",
			"United Way of Merced runs a free tax preparation program each spring.",
			"They're open until 4:00pm today.",
			"",
		]) {
			expect(asksForLocation(text), text).toBe(false);
		}
	});

	it("handles null and undefined", () => {
		expect(asksForLocation(null)).toBe(false);
		expect(asksForLocation(undefined)).toBe(false);
	});
});
