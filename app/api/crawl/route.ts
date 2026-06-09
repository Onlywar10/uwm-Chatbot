import { processCrawlJob } from "@/lib/actions/crawl/processCrawlJob";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

// Rendered fetches add browser latency on top of the page fetch; give the job
// room within the QStash 120s publish timeout.
export const maxDuration = 120;

async function handler(request: Request) {
	const data = await request.json();

	await processCrawlJob(data.crawlJobId);

	return Response.json({ success: true });
}

export const POST = verifySignatureAppRouter(handler);
