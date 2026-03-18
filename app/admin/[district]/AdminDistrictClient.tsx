"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { crawlSite } from "@/lib/actions/crawl/crawl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DEFAULT_CRAWL_OPTIONS } from "@/lib/actions/crawlDefaults";
import { addSchool } from "@/lib/actions/schools";
import { canonicalizeUrlString } from "@/lib/ai/url";
import { startCrawl } from "@/lib/actions/crawl/start";

type DomainStat = {
	domain: string;
	resourceCount: number;
	embeddingCount: number;
	lastIndexed: string | Date;
	schoolName: string;
};

type District = {
	id: string;
	name: string;
};

function encodeDomain(domain: string) {
	return encodeURIComponent(domain);
}

export default function AdminDistrictClient({
	initialStats,
	districtDetails,
}: {
	initialStats: DomainStat[];
	districtDetails: District[];
}) {
	const router = useRouter();

	const [url, setUrl] = useState("");
	const [status, setStatus] = useState<string | null>(null);
	const [includeSitemapSeeds, setIncludeSitemapSeeds] = useState(true);
	const [ignoreRobots, setIgnoreRobots] = useState(true);
	const [dropAllQuery, setDropAllQuery] = useState(true);
	const [maxDepth, setMaxDepth] = useState<number>(DEFAULT_CRAWL_OPTIONS.maxDepth);
	const [maxPages, setMaxPages] = useState<number>(DEFAULT_CRAWL_OPTIONS.maxPages);
	const [maxCharsPerPage, setMaxCharsPerPage] = useState<number>(
		DEFAULT_CRAWL_OPTIONS.maxCharsPerPage,
	);
	const [newIgnoreUrl, setNewIgnoreUrl] = useState<string>("");
	const [urlsToIgnore, setUrlsToIgnore] = useState<string[]>([]);

	const [newSchool, setNewSchool] = useState<string>("");

	const stats = initialStats;
	const district = districtDetails[0];

	const getDomain = (): string => {
		const startCanonical = canonicalizeUrlString(url.trim(), { dropAllQuery });
		const start = new URL(startCanonical);

		const hostname = start.hostname.toLowerCase();
		const pathSegments = start.pathname.split("/").filter(Boolean);
		const basePrefix = pathSegments.length > 0 ? `/${pathSegments[0]}` : "";
		const domain = basePrefix ? `${hostname}${basePrefix}` : hostname;

		return domain;
	};

	const onSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setStatus("Crawling...");

		try {
			const domain = getDomain();

			const addSchoolResult = await addSchool({ name: newSchool, districtId: district.id, domain });

			if (addSchoolResult.ok) {
				await startCrawl(
					url,
					{
						dropAllQuery,
						maxPages,
						maxDepth,
						maxCharsPerPage,
						includeSitemapSeeds,
						ignoreRobots,
						urlsToIgnore,
					},
					addSchoolResult.schoolId,
					true,
				);
			} else {
				setStatus(`${addSchoolResult.error}`);
			}

			setUrl("");
			setNewSchool("");
			router.refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to crawl site";
			setStatus(message);
		}
	};

	const addUrlToIgnore = () => {
		if (!newIgnoreUrl) return;

		try {
			new URL(newIgnoreUrl);

			if (newIgnoreUrl === url) {
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
		setIncludeSitemapSeeds(true);
		setIgnoreRobots(true);
		setMaxDepth(DEFAULT_CRAWL_OPTIONS.maxDepth);
		setMaxPages(DEFAULT_CRAWL_OPTIONS.maxPages);
		setMaxCharsPerPage(DEFAULT_CRAWL_OPTIONS.maxCharsPerPage);
		setUrlsToIgnore([]);
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

	return (
		<main className="min-h-screen flex flex-row w-full dark:bg-neutral-900 px-4 py-6">
			<div className="w-3xl mx-auto p-3 ext-neutral-800 dark:text-neutral-100">
				<a href="/admin" className="underline">
					← Back to all districts
				</a>

				<h1 className="text-2xl font-semibold text-neutral-800 dark:text-neutral-100 my-2">
					{district.name}
				</h1>
				<p className="text-neutral-600 dark:text-neutral-300 mb-4">
					Enter a school name and their website URL to crawl and embed its content for domain-scoped
					RAG.
				</p>
				<form
					onSubmit={onSubmit}
					className="flex flex-col gap-3 text-neutral-800 dark:text-neutral-100 text-sm"
				>
					<label htmlFor="newSchoolInput">School Name:</label>
					<Input
						id="newSchoolInput"
						value={newSchool}
						onChange={(event) => setNewSchool(event.target.value)}
						placeholder="Enter school name to crawl..."
						required
					/>

					<label htmlFor="urlInput">URL:</label>
					<div className="flex gap-2">
						<Input
							id="urlInput"
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							placeholder="https://example.com"
							className="w-lg"
							required
						/>
						<Button
							type="submit"
							className="flex-1"
							variant="secondary"
							disabled={!url.trim() || !newSchool.trim()}
						>
							Crawl
						</Button>
					</div>
				</form>
				{status && (
					<div className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">{status}</div>
				)}
				<div className="mt-8">
					<h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 mb-2">
						Domains
					</h2>

					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead className="text-left text-neutral-600 dark:text-neutral-300">
								<tr>
									<th className="py-2 pr-4">School</th>
									<th className="py-2 pr-4">Domain</th>
									<th className="py-2 pr-4">Resources</th>
									<th className="py-2 pr-4">Embeddings</th>
									<th className="py-2 pr-4">Last Indexed</th>
								</tr>
							</thead>
							<tbody className="text-neutral-800 dark:text-neutral-200">
								{stats.map((row) => (
									<tr
										key={row.domain}
										className="border-t border-neutral-200 dark:border-neutral-800"
									>
										<td className="py-2 pr-4">
											<a
												className="underline"
												href={`/admin/${row.schoolName}/${encodeDomain(row.domain)}`}
											>
												{row.schoolName}
											</a>
										</td>
										<td className="py-2 pr-4">{row.domain}</td>
										<td className="py-2 pr-4">{row.resourceCount}</td>
										<td className="py-2 pr-4">{row.embeddingCount}</td>
										<td className="py-2 pr-4">{new Date(row.lastIndexed).toLocaleString()}</td>
									</tr>
								))}
								{stats.length === 0 && (
									<tr>
										<td colSpan={4} className="py-3 text-neutral-500 dark:text-neutral-400">
											No domains indexed yet.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
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
					<Button onClick={resetConfigurations} variant="destructive">
						Reset All Configurations
					</Button>
				</div>
			</div>
		</main>
	);
}
