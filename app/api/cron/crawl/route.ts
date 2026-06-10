import type { NextRequest } from "next/server";

import { searchAndStartDueCrawls } from "@/lib/actions/crawl/crawlSchedule";

export async function GET(request: NextRequest) {
	const authHeader = request.headers.get("authorization");
	const cronSecret = process.env.CRON_SECRET;

	if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
		return new Response("Unauthorized", {
			status: 401,
		});
	}

	const result = await searchAndStartDueCrawls();

	return Response.json({ success: true, result });
}
