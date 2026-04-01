import type { NextConfig } from "next";

const ALLOWED_ORIGINS = [
	"https://www.unitedwaymerced.org",
	"https://www.211merced.org",
];

const nextConfig: NextConfig = {
	reactCompiler: true,
	async headers() {
		return [
			// Global security headers
			{
				source: "/:path*",
				headers: [
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					{ key: "X-Frame-Options", value: "DENY" },
					{
						key: "Strict-Transport-Security",
						value: "max-age=31536000; includeSubDomains",
					},
					{
						key: "Permissions-Policy",
						value: "camera=(), microphone=(), geolocation=()",
					},
				],
			},
			// Widget iframe — allow only known domains
			{
				source: "/widget/:path*",
				headers: [
					{
						key: "Content-Security-Policy",
						value: `frame-ancestors 'self' ${ALLOWED_ORIGINS.join(" ")}`,
					},
					{ key: "X-Frame-Options", value: "ALLOWALL" },
				],
			},
		];
	},
};

export default nextConfig;
