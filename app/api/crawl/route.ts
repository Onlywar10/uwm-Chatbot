import { processCrawlJob } from "@/lib/actions/crawl/processCrawlJob";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

async function handler(request: Request) {
	const data = await request.json();

	await processCrawlJob(
		data.crawlSetting,
		data.crawlSettingId,
		data.crawlJobId,
		data.schoolId,
		data.crawlUrl,
		data.domain,
		data.depth,
		data.robots,
		data.crawlDelay,
	);

	await new Promise((resolve) => setTimeout(resolve, 500));

	return Response.json({ success: true });
}

export const POST = verifySignatureAppRouter(handler);
