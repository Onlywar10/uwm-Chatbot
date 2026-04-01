import { qstash } from "@/lib/qstash";

const CRAWL_URL = `${process.env.APP_URL}/api/crawl`;

type CrawlSettings = {
	maxDepth?: number;
	maxPages?: number;
	maxCharsPerPage?: number;
	includeSitemapSeeds?: boolean;
	ignoreRobots?: boolean;
	dropAllQuery?: boolean;
	urlsToIgnore?: string[];
	domain?: string;
};

type RobotsRules = { allow: string[]; disallow: string[]; crawlDelay: number };

type FlowControl = { key: string; parallelism: number; rate: number; period: `${bigint}m` };

export async function publishCrawlJob(
	domain: string,
	crawlUrl: string,
	schoolId: string,
	depth: number,
	crawlDelay: number,
	robots: RobotsRules,
	crawlSettingId: string,
	crawlJobId: string,
	crawlSetting: CrawlSettings,
	flowControl: FlowControl,
) {
	console.log(`Publishing crawl job to QStash: ${CRAWL_URL} for ${crawlUrl}`);
	return await qstash.publishJSON({
		url: CRAWL_URL,
		body: {
			crawlUrl,
			domain,
			schoolId,
			depth,
			crawlDelay,
			robots,
			crawlSettingId,
			crawlJobId,
			crawlSetting,
		},
		flowControl: {
			key: flowControl.key,
			parallelism: flowControl.parallelism,
			rate: flowControl.rate,
			period: flowControl.period,
		},
	});
}
