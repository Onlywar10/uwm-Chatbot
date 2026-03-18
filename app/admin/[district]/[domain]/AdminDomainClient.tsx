"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
	getDomainDetails,
	purgeDomain,
	purgeSchool,
	reCrawlDomain,
	reIndexPage,
} from "@/lib/actions/admin";
import { useRouter } from "next/navigation";
import { useState } from "react";

type DomainResourceRow = {
	id: string;
	url: string;
	createdAt: Date;
	updatedAt: Date;
	embeddingCount: number;
};

type CrawlSettings = {
	maxDepth: number;
	maxPages: number;
	maxCharsPerPage: number;
	includeSitemapSeeds: boolean;
	ignoreRobots: boolean;
	dropAllQuery: boolean;
	urlsToIgnore: string[];
};

type School = {
	schoolName: string;
	schoolId: string;
	districtId: string;
};

export default function AdminDomainClient({
	domain,
	initialResources,
	crawlSettings,
	schoolDetails,
}: {
	domain: string;
	initialResources: DomainResourceRow[];
	crawlSettings: CrawlSettings[];
	schoolDetails: School[];
}) {
	const router = useRouter();
	const school = schoolDetails[0];

	const [resources, setResources] = useState<DomainResourceRow[]>(initialResources);
	const [status, setStatus] = useState<string | null>(null);
	const [seed, setSeed] = useState("");

	const [includeSitemapSeeds, setIncludeSitemapSeeds] = useState(
		crawlSettings[0].includeSitemapSeeds,
	);
	const [ignoreRobots, setIgnoreRobots] = useState(crawlSettings[0].ignoreRobots);
	const [dropAllQuery, setDropAllQuery] = useState(crawlSettings[0].dropAllQuery);
	const [maxDepth, setMaxDepth] = useState<number>(crawlSettings[0].maxDepth);
	const [maxPages, setMaxPages] = useState<number>(crawlSettings[0].maxPages);
	const [maxCharsPerPage, setMaxCharsPerPage] = useState<number>(crawlSettings[0].maxCharsPerPage);
	const [newIgnoreUrl, setNewIgnoreUrl] = useState<string>("");
	const [urlsToIgnore, setUrlsToIgnore] = useState<string[]>(crawlSettings[0].urlsToIgnore);

	const [saveSettings, setSaveSettings] = useState<boolean>(false);
	const [saveSucess, setSaveSuccess] = useState<boolean>(false);

	const refresh = async () => {
		const rows = await getDomainDetails(domain);
		setResources(rows);
		router.refresh();
	};

	const onPurge = async () => {
		setStatus("Purging...");
		const purgeResult = await purgeDomain(domain);
		setStatus(purgeResult.message);
		await refresh();
	};

	const onReCrawl = async (event: React.FormEvent) => {
		event.preventDefault();
		setStatus("Re-crawling...");
		setSaveSuccess(false);
		try {
			const crawlResult = await reCrawlDomain({
				domain,
				startUrl: seed.trim() ? seed.trim() : undefined,
				maxDepth: maxDepth,
				maxPages: maxPages,
				maxCharsPerPage: maxCharsPerPage,
				includeSitemapSeeds: includeSitemapSeeds,
				ignoreRobots: ignoreRobots,
				dropAllQuery: dropAllQuery,
				urlsToIgnore: urlsToIgnore,
				saveCrawlSettings: saveSettings,
				schoolId: school.schoolId,
			});

			if (saveSettings) {
				setSaveSuccess(true);
			}

			setSaveSettings(false);

			setStatus(`${crawlResult.message} (pages: ${crawlResult.pagesProcessed})`);
			await refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to re-crawl domain";
			setStatus(message);
		}
	};

	const onReindex = async (url: string) => {
		setStatus("Reindexing page...");
		try {
			const reindexResult = await reIndexPage({
				domain,
				url,
				maxCharsPerPage: crawlSettings[0].maxCharsPerPage,
				includeSitemapSeeds: crawlSettings[0].includeSitemapSeeds,
				ignoreRobots: crawlSettings[0].ignoreRobots,
				dropAllQuery: crawlSettings[0].dropAllQuery,
				schoolId: school.schoolId,
			});
			setStatus(`${reindexResult.message} (pages: ${reindexResult.pagesProcessed})`);
			await refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to reindex page";
			setStatus(message);
		}
	};

	const addUrlToIgnore = () => {
		if (!newIgnoreUrl) return;

		try {
			new URL(newIgnoreUrl);

			if (newIgnoreUrl === seed) {
				alert("Same URL as the one being scraped!");
				setNewIgnoreUrl("");
				return;
			}

			if (!urlsToIgnore.includes(newIgnoreUrl.trim())) {
				setUrlsToIgnore([...urlsToIgnore, newIgnoreUrl.trim()]);
				setNewIgnoreUrl("");
			} else {
				alert("You already added this url!");
			}
		} catch {
			alert("Not a vaild URL!");
		}
	};

	const resetConfigurations = () => {
		setIncludeSitemapSeeds(crawlSettings[0].includeSitemapSeeds);
		setIgnoreRobots(crawlSettings[0].ignoreRobots);
		setDropAllQuery(crawlSettings[0].dropAllQuery);
		setMaxDepth(crawlSettings[0].maxDepth);
		setMaxPages(crawlSettings[0].maxPages);
		setMaxCharsPerPage(crawlSettings[0].maxCharsPerPage);
		setUrlsToIgnore(crawlSettings[0].urlsToIgnore);
	};

	const UrlBadge = ({ url }: { url: string }) => {
		return (
			<Badge variant="secondary">
				{url}{" "}
				<button
					type="button"
					className="font-black hover:text-gray-500 hover:cursor-pointer"
					onClick={() => {
						setUrlsToIgnore(urlsToIgnore.filter((k) => k !== url));
					}}
				>
					X
				</button>{" "}
			</Badge>
		);
	};

	const onBackToDistricts = async () => {
		if (resources.length === 0) {
			await purgeSchool(school.schoolId);
		}

		router.back();
	};

	return (
		<main className="min-h-screen flex flex-row w-full dark:bg-neutral-900 px-4 py-6">
			<div className="w-4xl mx-auto p-3">
				<button
					type="button"
					onClick={onBackToDistricts}
					className="underline text-neutral-800 dark:text-neutral-100 hover:cursor-pointer"
				>
					← Back to all schools
				</button>

				<h1 className="text-2xl font-semibold text-neutral-800 dark:text-neutral-100 my-2">
					{school.schoolName}
				</h1>

				<p className="text-neutral-600 dark:text-neutral-300 mb-4">Domain: {domain}</p>

				<div className="flex flex-col gap-3 mb-4">
					<div className="flex gap-2">
						<Button variant="destructive" onClick={onPurge}>
							Purge
						</Button>

						<form onSubmit={onReCrawl} className="flex gap-2 flex-1">
							<Input
								value={seed}
								onChange={(event) => setSeed(event.target.value)}
								placeholder="Seed URL (optional)"
							/>
							<Button type="submit">Re-crawl</Button>
						</form>
					</div>

					{status && <div className="text-sm text-neutral-700 dark:text-neutral-300">{status}</div>}
				</div>

				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead className="text-left text-neutral-600 dark:text-neutral-300">
							<tr>
								<th className="py-2 pr-4">URL</th>
								<th className="py-2 pr-4">Embeddings</th>
								<th className="py-2 pr-4">Updated</th>
								<th className="py-2 pr-4">Actions</th>
							</tr>
						</thead>
						<tbody className="text-neutral-800 dark:text-neutral-200">
							{resources.map((row) => (
								<tr key={row.id} className="border-t border-neutral-200 dark:border-neutral-800">
									<td className="py-2 pr-4">
										<a className="underline" href={row.url} target="_blank" rel="noreferrer">
											{row.url}
										</a>
									</td>
									<td className="py-2 pr-4">{row.embeddingCount}</td>
									<td className="py-2 pr-4">{new Date(row.updatedAt).toLocaleString()}</td>
									<td className="py-2 pr-4">
										<button type="button" className="underline" onClick={() => onReindex(row.url)}>
											Reindex
										</button>
									</td>
								</tr>
							))}
							{resources.length === 0 && (
								<tr>
									<td colSpan={4} className="py-3 text-neutral-500 dark:text-neutral-400">
										No pages indexed yet.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>

			<div className="w-lg flex flex-col gap-3 border rounded-md p-3">
				<div className="flex items-center gap-2">
					<input
						id="includeSitemapSeeds"
						type="checkbox"
						checked={includeSitemapSeeds}
						onChange={(event) => setIncludeSitemapSeeds(event.target.checked)}
					/>
					<label
						htmlFor="includeSitemapSeeds"
						className="text-sm text-neutral-700 dark:text-neutral-300"
					>
						Use sitemap seeds when available
					</label>
				</div>

				<div className="flex items-center gap-2">
					<input
						id="ignoreRobots"
						type="checkbox"
						checked={ignoreRobots}
						onChange={(event) => setIgnoreRobots(event.target.checked)}
					/>
					<label htmlFor="ignoreRobots" className="text-sm text-neutral-700 dark:text-neutral-300">
						Ignore robots.txt (admin-only crawl)
					</label>
				</div>

				<div className="flex items-center gap-2">
					<input
						id="dropAllQuery"
						type="checkbox"
						checked={dropAllQuery}
						onChange={(event) => setDropAllQuery(event.target.checked)}
					/>
					<label htmlFor="dropAllQuery" className="text-sm text-neutral-700 dark:text-neutral-300">
						Drop all query
					</label>
				</div>

				<div className="flex items-center gap-2">
					<input
						id="maxDepth"
						type="number"
						value={maxDepth}
						onChange={(event) => setMaxDepth(Number(event.target.value))}
						className="bg-white w-16 pl-1 text-sm rounded-sm"
						min={1}
					/>
					<label htmlFor="maxDepth" className="text-sm text-neutral-700 dark:text-neutral-300">
						Max crawl depth
					</label>
				</div>

				<div className="flex items-center gap-2">
					<input
						id="maxPages"
						type="number"
						onChange={(event) => setMaxPages(Number(event.target.value))}
						value={maxPages}
						className="bg-white w-16 pl-1 text-sm rounded-sm"
						min={1}
					/>
					<label htmlFor="maxPages" className="text-sm text-neutral-700 dark:text-neutral-300">
						Max crawl pages
					</label>
				</div>

				<div className="flex items-center gap-2">
					<input
						id="maxChars"
						type="number"
						onChange={(event) => setMaxCharsPerPage(Number(event.target.value))}
						value={maxCharsPerPage}
						className="bg-white w-16 pl-1 text-sm rounded-sm"
						min={1}
					/>
					<label htmlFor="maxChars" className="text-sm text-neutral-700 dark:text-neutral-300">
						Max characters per page
					</label>
				</div>

				<div className="flex flex-col gap-2">
					<label htmlFor="ignoreUrls" className="text-sm text-neutral-700 dark:text-neutral-300">
						Skip urls that look like this:
					</label>

					<div className="flex gap-2">
						<Input
							id="ignoreUrls"
							placeholder="https://example.com"
							value={newIgnoreUrl}
							onChange={(event) => setNewIgnoreUrl(event.target.value)}
						/>
						<Button type="button" onClick={addUrlToIgnore} disabled={!newIgnoreUrl.trim()}>
							Add Url
						</Button>
					</div>
				</div>

				<div className="flex gap-2 flex-wrap">
					{urlsToIgnore.map((url) => (
						<UrlBadge key={url} url={url} />
					))}
				</div>

				{urlsToIgnore.length > 0 && (
					<Button
						variant="destructive"
						size="sm"
						className="flex w-fit"
						onClick={() => setUrlsToIgnore([])}
					>
						Clear urls
					</Button>
				)}

				<div className="flex items-center gap-2">
					<input
						id="saveSettings"
						type="checkbox"
						checked={saveSettings}
						onChange={(event) => setSaveSettings(event.target.checked)}
					/>
					<label htmlFor="saveSettings" className="text-sm text-neutral-700 dark:text-neutral-300">
						Save new crawl settings
					</label>
				</div>

				<div className="flex items-center gap-2">
					<Button onClick={resetConfigurations} variant="destructive">
						Reset to Original Settings
					</Button>
				</div>

				{saveSucess && (
					<div className="text-green-500 text-center">Successfully saved settings ✓</div>
				)}
			</div>
		</main>
	);
}
