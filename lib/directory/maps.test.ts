import { describe, expect, it } from "vitest";
import { detectMapsPlatform, directionsUrl } from "./maps";

const IPHONE =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("detectMapsPlatform", () => {
	it("detects iPhone and iPad", () => {
		expect(detectMapsPlatform(IPHONE)).toBe("ios");
		expect(detectMapsPlatform("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)")).toBe("ios");
	});

	it("detects iPadOS 13+, which masquerades as macOS", () => {
		// Only distinguishable from a real Mac by the touch screen.
		expect(detectMapsPlatform(DESKTOP, "MacIntel", 5)).toBe("ios");
		expect(detectMapsPlatform(DESKTOP, "MacIntel", 0)).toBe("other");
	});

	it("treats Android and desktop as other", () => {
		expect(detectMapsPlatform(ANDROID)).toBe("other");
		expect(detectMapsPlatform(DESKTOP)).toBe("other");
		expect(detectMapsPlatform(undefined)).toBe("other");
	});
});

describe("directionsUrl", () => {
	const coords = { latitude: 37.3022, longitude: -120.4829, label: "Merced County Food Bank" };

	it("uses Apple Maps on iOS", () => {
		const url = directionsUrl(coords, "ios") as string;
		expect(url.startsWith("https://maps.apple.com/?")).toBe(true);
		expect(url).toContain("daddr=37.3022%2C-120.4829");
		expect(url).toContain("q=Merced+County+Food+Bank");
	});

	it("uses Google Maps elsewhere", () => {
		const url = directionsUrl(coords, "other") as string;
		expect(url.startsWith("https://www.google.com/maps/dir/?")).toBe(true);
		expect(url).toContain("destination=37.3022%2C-120.4829");
		expect(url).toContain("travelmode=driving");
	});

	it("prefers coordinates over the address string", () => {
		const url = directionsUrl({ ...coords, address: "1920 Canal St, Merced CA" }) as string;
		expect(url).toContain("destination=37.3022%2C-120.4829");
		expect(url).not.toContain("Canal");
	});

	it("falls back to the address when coordinates are missing", () => {
		const url = directionsUrl({ address: "1920 Canal St, Merced CA 95340" }) as string;
		expect(url).toContain("destination=1920+Canal+St%2C+Merced+CA+95340");
	});

	it("returns null when there is nothing to navigate to", () => {
		expect(directionsUrl({})).toBeNull();
		expect(directionsUrl({ address: "   " })).toBeNull();
		expect(directionsUrl({ latitude: 37.3, longitude: null })).toBeNull();
	});
});
