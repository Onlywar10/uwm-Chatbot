/**
 * Directions links that open the right app on the user's device.
 *
 * Both URLs below are https universal links rather than custom schemes
 * (`maps://`, `geo:`), which matters because the widget runs inside a cross-site
 * iframe: a custom scheme that no app handles fails silently there, while an https
 * link always has a working web fallback. On iOS a maps.apple.com link opens the
 * Maps app; on Android a google.com/maps link opens the Google Maps app; on desktop
 * both open a normal tab.
 *
 * Destination prefers coordinates (1,205 of 1,278 directory rows have them) because
 * an address string leaves the maps provider to geocode, which is where "Suite B,
 * 1920 Canal St" style entries go wrong.
 */

export type MapsPlatform = "ios" | "other";

export type DirectionsTarget = {
	latitude?: number | null;
	longitude?: number | null;
	/** Human-readable address, used when coordinates are missing. */
	address?: string | null;
	/** Place name, shown as the pin label where the provider supports it. */
	label?: string | null;
};

/**
 * iOS detection, including iPadOS 13+ which reports itself as "MacIntel" and is
 * only distinguishable by having a touch screen.
 */
export function detectMapsPlatform(
	userAgent: string | undefined,
	platform?: string,
	maxTouchPoints = 0,
): MapsPlatform {
	const ua = userAgent ?? "";
	if (/iPad|iPhone|iPod/.test(ua)) return "ios";
	if (platform === "MacIntel" && maxTouchPoints > 1) return "ios";
	return "other";
}

/** Reads the platform from the current browser. Client-side only. */
export function currentMapsPlatform(): MapsPlatform {
	if (typeof navigator === "undefined") return "other";
	return detectMapsPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

function destinationParam(target: DirectionsTarget): string | null {
	const { latitude, longitude, address } = target;
	if (typeof latitude === "number" && typeof longitude === "number") {
		return `${latitude},${longitude}`;
	}
	return address?.trim() || null;
}

/**
 * Directions URL for a destination, or null when there is nothing to navigate to.
 * `dirflg=d` / `travelmode=driving` set driving as the default mode; the user can
 * still change it once the app opens.
 */
export function directionsUrl(
	target: DirectionsTarget,
	platform: MapsPlatform = "other",
): string | null {
	const destination = destinationParam(target);
	if (!destination) return null;

	if (platform === "ios") {
		const params = new URLSearchParams({ daddr: destination, dirflg: "d" });
		// Apple shows `q` as the pin label when daddr is a coordinate pair.
		if (target.label) params.set("q", target.label);
		return `https://maps.apple.com/?${params.toString()}`;
	}

	const params = new URLSearchParams({
		api: "1",
		destination,
		travelmode: "driving",
	});
	return `https://www.google.com/maps/dir/?${params.toString()}`;
}
