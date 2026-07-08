import type { NextRequest } from "next/server";

import { syncDirectory } from "@/lib/directory";

// Full sweep + detail fetch of ~1k programs takes a couple of minutes.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
	const authHeader = request.headers.get("authorization");
	const cronSecret = process.env.CRON_SECRET;

	if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
		return new Response("Unauthorized", {
			status: 401,
		});
	}

	const stats = await syncDirectory();

	return Response.json({ success: true, stats });
}
