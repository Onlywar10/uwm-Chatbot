import { qstash } from "@/lib/qstash";
import type { FlowControl } from "@upstash/qstash";

import { env } from "@/lib/env.mjs";
import { log } from "../logger";

// const URL = `https://${process.env.VERCEL_BRANCH_URL}/api/crawl`;
const URL = env.VERCEL_AUTOMATION_BYPASS_SECRET
	? `${env.APP_URL}/api/crawl?x-vercel-protection-bypass=${env.VERCEL_AUTOMATION_BYPASS_SECRET}`
	: `${env.APP_URL}/api/crawl`;

export function getFlowControl(link: string, crawlSetting: string): FlowControl {
	if (link.startsWith("https://drive.google.com/file/d/") || link.endsWith(".pdf")) {
		return { key: `${crawlSetting}-pdf`, parallelism: 2, rate: 30, period: "1m" as `${bigint}m` };
	} else if (link.startsWith("https://docs.google.com/document/d/")) {
		return { key: `${crawlSetting}-docs`, parallelism: 5, rate: 50, period: "1m" };
	} else {
		return { key: `${crawlSetting}-html`, parallelism: 10, rate: 100, period: "1m" };
	}
}

export async function isCrawlEndpointReachable() {
	const res = await fetch(URL, { method: "POST" }).catch(() => null);
	return !!res && (res.status === 401 || res.status === 403);
}

export async function publishCrawlJob(
	crawlJobId: string,
	flowControl: FlowControl,
	delay?: number,
) {
	try {
		return await qstash.publishJSON({
			url: URL,
			body: {
				crawlJobId,
			},
			flowControl: flowControl,
			timeout: "120s",
			delay: delay,
		});
	} catch (error) {
		await log({
			level: "error",
			source: "qstash",
			message: "Failed to publish crawl job",
			metadata: { crawlJobId, error: error instanceof Error ? error.message : String(error) },
		});

		throw error;
	}
}
