"use server";

import { db } from "@/lib/db";
import { embeddings } from "@/lib/db/schema/embeddings";
import { resources } from "@/lib/db/schema/resources";
import { schools } from "../db/schema/schools";
import { districts } from "../db/schema/districts";
import { crawlSettings } from "../db/schema/crawlSettings";
import { and, eq, sql } from "drizzle-orm";

import { requireAuth } from "@/lib/auth/guards";
import { upsertCrawlSettings } from "./crawl/crawlSettings";
// NOTE: ./crawl/start (and its transitive deps: unpdf/pdf.js, pdf2md, puppeteer)
// are loaded lazily inside the actions below. A static import would pull those
// browser/native libs into the admin pages' render bundle and crash SSR with
// "window is not defined" / "document.querySelector is not a function".

export async function getDomainStats() {
	await requireAuth();
	const resourceSummary = await db
		.select({
			domain: resources.domain,
			resourceCount: sql<number>`count(*)`,
			lastIndexed: sql<Date>`max(${resources.updatedAt})`,
			schoolName: schools.name,
		})
		.from(resources)
		.groupBy(resources.domain, schools.name)
		.innerJoin(schools, eq(resources.entityId, schools.id));

	const embeddingSummary = await db
		.select({ domain: embeddings.domain, embeddingCount: sql<number>`count(*)` })
		.from(embeddings)
		.groupBy(embeddings.domain);

	const embedMap = new Map<string, number>();
	for (const row of embeddingSummary) embedMap.set(row.domain, row.embeddingCount);

	return resourceSummary.map((r) => ({
		domain: r.domain,
		resourceCount: r.resourceCount,
		embeddingCount: embedMap.get(r.domain) ?? 0,
		lastIndexed: r.lastIndexed,
		schoolName: r.schoolName,
	}));
}

export async function getDomainDetails(domain: string) {
	await requireAuth();
	return db
		.select({
			id: resources.id,
			url: resources.url,
			createdAt: resources.createdAt,
			updatedAt: resources.updatedAt,
			embeddingCount: sql<number>`count(${embeddings.id})`,
		})
		.from(resources)
		.leftJoin(embeddings, eq(embeddings.resourceId, resources.id))
		.where(eq(resources.domain, domain))
		.groupBy(resources.id, resources.url, resources.createdAt, resources.updatedAt)
		.orderBy(resources.updatedAt);
}

export async function getCrawlSettings(domain: string) {
	return db
		.select({
			id: crawlSettings.id,
			maxDepth: crawlSettings.maxCrawlDepth,
			maxPages: crawlSettings.maxCrawlPages,
			maxCharsPerPage: crawlSettings.maxCharsPerPage,
			includeSitemapSeeds: crawlSettings.useSitemaps,
			ignoreRobots: crawlSettings.ignoreRobots,
			dropAllQuery: crawlSettings.dropAllQuery,
			renderJavascript: crawlSettings.renderJavascript,
			crawlAllPages: crawlSettings.crawlAllPages,
			urlsToIgnore: crawlSettings.urlsToIgnore,
		})
		.from(crawlSettings)
		.where(eq(crawlSettings.domain, domain));
}

export async function purgeDomain(domain: string) {
	await requireAuth();
	await db.delete(resources).where(eq(resources.domain, domain));
	return { message: `Purged data for ${domain}` };
}

export async function reCrawlDomain(params: {
	domain: string;
	startUrl?: string;
	maxDepth: number;
	maxPages: number;
	maxCharsPerPage: number;
	includeSitemapSeeds: boolean;
	ignoreRobots: boolean;
	dropAllQuery: boolean;
	renderJavascript: boolean;
	crawlAllPages: boolean;
	urlsToIgnore: string[];
	schoolId: string;
}) {
	await requireAuth();
	const {
		domain,
		startUrl,
		maxDepth,
		maxPages,
		maxCharsPerPage,
		includeSitemapSeeds,
		ignoreRobots,
		dropAllQuery,
		renderJavascript,
		crawlAllPages,
		urlsToIgnore,
		schoolId,
	} = params;

	let seed = startUrl?.trim();
	if (!seed) {
		const first = await db
			.select({ url: resources.url })
			.from(resources)
			.where(eq(resources.domain, domain))
			.orderBy(resources.createdAt)
			.limit(1);

		seed = first[0]?.url;
		if (!seed) throw new Error(`No seed URL found for domain ${domain}`);
	}

	// Persist settings (the distributed crawl reads its config from the
	// crawl_settings row via crawlSettingId), then enqueue the crawl.
	const settings = await upsertCrawlSettings({
		domain,
		maxCrawlDepth: maxDepth,
		maxCrawlPages: maxPages,
		maxCharsPerPage,
		useSitemaps: includeSitemapSeeds,
		ignoreRobots,
		dropAllQuery,
		renderJavascript,
		crawlAllPages,
		urlsToIgnore,
		entityType: "school",
		entityId: schoolId,
	});
	if (!settings.ok) throw new Error(settings.error);

	const { startCrawl } = await import("./crawl/start");
	const result = await startCrawl(seed, "school", schoolId, settings.id);
	if (!result.ok) throw new Error(result.error);

	return { message: `Crawl started for ${domain}. Pages will be indexed in the background.` };
}

export async function reIndexPage(params: { domain: string; url: string; schoolId: string }) {
	await requireAuth();
	const { domain, url } = params;

	const [settings] = await db
		.select({ id: crawlSettings.id })
		.from(crawlSettings)
		.where(eq(crawlSettings.domain, domain));

	if (!settings) throw new Error(`No crawl settings found for domain ${domain}`);

	// Drop the existing resource so the recrawl re-embeds it even if content
	// is unchanged (content-hash dedup would otherwise skip it).
	await db.delete(resources).where(and(eq(resources.domain, domain), eq(resources.url, url)));

	const { startRecrawl } = await import("./crawl/start");
	const result = await startRecrawl([url], url, settings.id);
	if (!result.ok) throw new Error(result.error);

	return { message: `Reindex started for ${url}. It will update in the background.` };
}

export async function getDistricts() {
	const allDistricts = await db
		.select({
			id: districts.id,
			name: districts.name,
			schoolCount: sql<number>`cast(count(${schools.id}) as int)`,
		})
		.from(districts)
		.groupBy(districts.id)
		.leftJoin(schools, eq(districts.id, schools.districtId));

	return allDistricts.map((d) => ({
		id: d.id,
		name: d.name,
		schoolCount: d.schoolCount,
	}));
}

export async function getDistrictDetails(id: string) {
	return db
		.select({ id: districts.id, name: districts.name })
		.from(districts)
		.where(eq(districts.id, id));
}

export async function getSchoolFromDomain(domain: string) {
	return db
		.select({
			schoolName: schools.name,
			schoolId: schools.id,
			districtId: schools.districtId,
		})
		.from(schools)
		.where(eq(schools.domain, domain));
}

export async function purgeSchool(id: string) {
	await db.delete(schools).where(eq(schools.id, id));
}
