import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const ALLOWED_ORIGINS = [
	"https://www.unitedwaymerced.org",
	"https://www.211merced.org",
	"https://www.freetaxesmerced.com",
	"https://freetaxesmerced.com",
];

const nextConfig: NextConfig = {
	reactCompiler: true,
	async headers() {
		const securityHeaders = [
			{ key: "X-Content-Type-Options", value: "nosniff" },
			{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
			{
				key: "Strict-Transport-Security",
				value: "max-age=31536000; includeSubDomains",
			},
		];

		// Permissions-Policy allowlists. An EMPTY list — geolocation=() — denies the
		// feature to everyone including our own origin, which is not the same as
		// "don't request it": it makes navigator.geolocation throw before any
		// permission prompt appears. Everything outside the widget keeps that hard
		// denial; the widget needs its own origin allowed so a visitor can opt in to
		// distance-ranked referrals.
		const denyAllFeatures = "camera=(), microphone=(), geolocation=()";
		const widgetFeatures = "camera=(), microphone=(), geolocation=(self)";

		return [
			// Global security headers + frame deny (everything except widget)
			{
				source: "/((?!widget).*)",
				headers: [
					...securityHeaders,
					{ key: "Permissions-Policy", value: denyAllFeatures },
					{ key: "X-Frame-Options", value: "DENY" },
				],
			},
			// Widget iframe — allow known domains, no X-Frame-Options.
			// NOTE: when embedded cross-origin, geolocation needs BOTH this header and
			// allow="geolocation" on the parent's <iframe> (set in public/widget.js).
			// Either one missing blocks it with no prompt shown.
			{
				source: "/widget/:path*",
				headers: [
					...securityHeaders,
					{ key: "Permissions-Policy", value: widgetFeatures },
					{
						key: "Content-Security-Policy",
						value: `frame-ancestors 'self' ${ALLOWED_ORIGINS.join(" ")}`,
					},
				],
			},
		];
	},
};

// withBotId adds the first-party proxy rewrites BotID needs so its challenge script is
// served from this domain (dodging ad blockers). The client proof is attached in
// instrumentation-client.ts; POST /api/chat verifies it server-side.
export default withBotId(nextConfig);
