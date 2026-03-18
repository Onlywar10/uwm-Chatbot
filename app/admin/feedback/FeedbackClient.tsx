"use client";

import { useState } from "react";
import type { FeedbackWithTurn, FeedbackStats, FeedbackFilters } from "@/lib/types/feedback";
import { FEEDBACK_REASONS } from "@/lib/types/feedback";
import { listFeedback, getFeedbackStats } from "@/lib/actions/feedback";

function formatTime(date: Date): string {
	return new Date(date).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function getReasonLabel(reason: string): string {
	return FEEDBACK_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

export function FeedbackClient({
	initialItems,
	initialStats,
	domains,
}: {
	initialItems: FeedbackWithTurn[];
	initialStats: FeedbackStats;
	domains: string[];
}) {
	const [items, setItems] = useState(initialItems);
	const [stats, setStats] = useState(initialStats);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [domain, setDomain] = useState("");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");

	const applyFilters = async (next: FeedbackFilters) => {
		const filters: FeedbackFilters = {};
		if (next.domain) filters.domain = next.domain;
		if (next.from) filters.from = next.from;
		if (next.to) filters.to = next.to;

		const hasFilters = Object.keys(filters).length > 0;
		const [filtered, updatedStats] = await Promise.all([
			listFeedback(hasFilters ? filters : undefined),
			getFeedbackStats(hasFilters ? filters : undefined),
		]);
		setItems(filtered);
		setStats(updatedStats);
	};

	const onDomainChange = (value: string) => {
		setDomain(value);
		applyFilters({ domain: value, from, to });
	};

	const onFromChange = (value: string) => {
		setFrom(value);
		applyFilters({ domain, from: value, to });
	};

	const onToChange = (value: string) => {
		setTo(value);
		applyFilters({ domain, from, to: value });
	};

	const positiveRate = stats.total > 0 ? Math.round((stats.positive / stats.total) * 100) : 0;

	return (
		<div>
			<div className="flex gap-4 mb-6">
				<select
					value={domain}
					onChange={(e) => onDomainChange(e.target.value)}
					className="border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200"
				>
					<option value="">All domains</option>
					{domains.map((d) => (
						<option key={d} value={d}>
							{d}
						</option>
					))}
				</select>
				<input
					type="date"
					value={from}
					onChange={(e) => onFromChange(e.target.value)}
					className="border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200"
				/>
				<input
					type="date"
					value={to}
					onChange={(e) => onToChange(e.target.value)}
					className="border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200"
				/>
			</div>
			<div className="grid grid-cols-4 gap-4 mb-6">
				<div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
					<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">Total</p>
					<p className="text-2xl font-semibold text-neutral-800 dark:text-neutral-200">
						{stats.total}
					</p>
				</div>
				<div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
					<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">Positive</p>
					<p className="text-2xl font-semibold text-green-500">{stats.positive}</p>
				</div>
				<div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
					<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">Negative</p>
					<p className="text-2xl font-semibold text-red-500">{stats.negative}</p>
				</div>
				<div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
					<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
						Positive Rate
					</p>
					<p className="text-2xl font-semibold text-neutral-800 dark:text-neutral-200">
						{positiveRate}%
					</p>
				</div>
			</div>

			{stats.reasonBreakdown.length > 0 && (
				<div className="mb-6">
					<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-2">
						Negative Reason Breakdown
					</p>
					<ul className="text-sm text-neutral-700 dark:text-neutral-300 space-y-1">
						{stats.reasonBreakdown.map((r) => (
							<li key={r.reason} className="flex items-center justify-between max-w-xs">
								<span>{getReasonLabel(r.reason)}</span>
								<span className="text-neutral-500 dark:text-neutral-400">{r.count}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			<div className="space-y-2">
				{items.map((item) => {
					const isExpanded = expandedId === item.id;

					return (
						<div key={item.id}>
							<button
								type="button"
								onClick={() =>
									setExpandedId((prev) => (prev === item.id ? null : item.id))
								}
								className={`w-full text-left border border-neutral-200 dark:border-neutral-800 p-4 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer transition-colors ${
									isExpanded ? "rounded-t-lg" : "rounded-lg"
								}`}
							>
								<div className="flex items-center justify-between mb-2">
									<div className="flex items-center gap-3">
										<span className="text-neutral-500 dark:text-neutral-400 text-sm">
											{formatTime(item.createdAt)}
										</span>
										<span className="text-neutral-800 dark:text-neutral-200 font-mono text-sm">
											{item.domain}
										</span>
									</div>
									<span
										className={`px-2 py-0.5 rounded text-xs ${
											item.sentiment === "positive"
												? "bg-green-500/20 text-green-400"
												: "bg-red-500/20 text-red-400"
										}`}
									>
										{item.sentiment}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<p className="text-neutral-700 dark:text-neutral-300 text-sm truncate max-w-md">
										{item.userMessage}
									</p>
									{item.reason && (
										<span className="text-xs text-neutral-500 dark:text-neutral-400">
											{getReasonLabel(item.reason)}
										</span>
									)}
								</div>
							</button>

							{isExpanded && (
								<div className="border border-t-0 border-neutral-200 dark:border-neutral-800 rounded-b-lg p-4 bg-neutral-50 dark:bg-neutral-800/50 space-y-4">
									<div>
										<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
											User Message
										</p>
										<p className="text-neutral-800 dark:text-neutral-200 text-sm">
											{item.userMessage}
										</p>
									</div>
									<div>
										<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
											Response
										</p>
										<p className="text-neutral-800 dark:text-neutral-200 text-sm whitespace-pre-wrap">
											{item.response}
										</p>
									</div>
									{item.reason && (
										<div>
											<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
												Reason
											</p>
											<p className="text-neutral-800 dark:text-neutral-200 text-sm">
												{getReasonLabel(item.reason)}
											</p>
										</div>
									)}
								</div>
							)}
						</div>
					);
				})}

				{items.length === 0 && (
					<div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
						No feedback yet. Users can submit feedback via the chat interface.
					</div>
				)}
			</div>
		</div>
	);
}
