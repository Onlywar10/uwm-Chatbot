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
			{
				key: "Permissions-Policy",
				value: "camera=(), microphone=(), geolocation=()",
			},
		];

		return [
			// Global security headers + frame deny (everything except widget)
			{
				source: "/((?!widget).*)",
				headers: [
					...securityHeaders,
					{ key: "X-Frame-Options", value: "DENY" },
				],
			},
			// Widget iframe — allow known domains, no X-Frame-Options
			{
				source: "/widget/:path*",
				headers: [
					...securityHeaders,
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
