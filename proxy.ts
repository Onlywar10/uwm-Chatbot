import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE = "session_token";

function isPublicPath(pathname: string) {
	return (
		pathname.startsWith("/_next") ||
		pathname.startsWith("/favicon") ||
		pathname.startsWith("/robots.txt") ||
		pathname.startsWith("/sitemap.xml") ||
		pathname.startsWith("/icons/") ||
		pathname.startsWith("/images/") ||
		pathname.startsWith("/login") ||
		pathname.startsWith("/api/chat") ||
		pathname.startsWith("/api/crawl")
	);
}

export function proxy(req: NextRequest) {
	const { pathname } = req.nextUrl;

	if (isPublicPath(pathname)) return NextResponse.next();

	const token = req.cookies.get(SESSION_COOKIE)?.value;
	if (!token) {
		return NextResponse.redirect(new URL("/login", req.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/:path*"],
};
