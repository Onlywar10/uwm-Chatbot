import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactCompiler: true,
	async headers() {
		return [
			{
				source: "/widget/:path*",
				headers: [
					{ key: "Content-Security-Policy", value: "frame-ancestors *" },
					{ key: "X-Frame-Options", value: "ALLOWALL" },
				],
			},
		];
	},
};

export default nextConfig;
