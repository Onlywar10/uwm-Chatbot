"use client";

import { useState } from "react";
import type { DevTurn } from "@/lib/types/dev";

function useExpandedTurn() {
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const toggle = (id: string) => {
		setExpandedId((prev) => (prev === id ? null : id));
	};

	return { expandedId, toggle };
}

function formatTime(date: Date): string {
	return new Date(date).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`;
}

function getStatusColor(status: DevTurn["status"]): string {
	switch (status) {
		case "answered":
			return "bg-green-500/20 text-green-400";
		case "no-answer":
			return "bg-yellow-500/20 text-yellow-400";
		case "error":
			return "bg-red-500/20 text-red-400";
	}
}

export function DevClient({ initialTurns }: { initialTurns: DevTurn[] }) {
	const { expandedId, toggle } = useExpandedTurn();

	return (
		<div>
			<p className="text-neutral-600 dark:text-neutral-300 mb-4">
				{initialTurns.length} turn{initialTurns.length !== 1 && "s"} logged
			</p>

			<div className="space-y-2">
				{initialTurns.map((turn) => {
					const isExpanded = expandedId === turn.id;

					return (
						<div key={turn.id}>
							<button
								type="button"
								onClick={() => toggle(turn.id)}
								className={`w-full text-left border border-neutral-200 dark:border-neutral-800 p-4 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer transition-colors ${
									isExpanded ? "rounded-t-lg" : "rounded-lg"
								}`}
							>
								<div className="flex items-center justify-between mb-2">
									<div className="flex items-center gap-3">
										<span className="text-neutral-500 dark:text-neutral-400 text-sm">
											{formatTime(turn.timestamp)}
										</span>
										<span className="text-neutral-800 dark:text-neutral-200 font-mono text-sm">
											{turn.domain}
										</span>
									</div>
									<span
										className={`px-2 py-0.5 rounded text-xs ${getStatusColor(turn.status)}`}
									>
										{turn.status}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<p className="text-neutral-700 dark:text-neutral-300 text-sm truncate max-w-md">
										{turn.prompt.userMessage}
									</p>
									<div className="flex items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
										<span>{turn.latency.total}ms</span>
										<span>{turn.tokens.input + turn.tokens.output} tokens</span>
										<span>{formatCost(turn.estimatedCost)}</span>
									</div>
								</div>
							</button>

							{isExpanded && (
								<div className="border border-t-0 border-neutral-200 dark:border-neutral-800 rounded-b-lg p-4 bg-neutral-50 dark:bg-neutral-800/50 space-y-4">
									<div className="grid grid-cols-3 gap-4 text-sm">
										<div>
											<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
												Model
											</p>
											<p className="text-neutral-800 dark:text-neutral-200 font-mono">
												{turn.model}
											</p>
										</div>
										<div>
											<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
												Tokens
											</p>
											<p className="text-neutral-800 dark:text-neutral-200">
												{turn.tokens.input} in / {turn.tokens.output} out
											</p>
										</div>
										<div>
											<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
												Cost
											</p>
											<p className="text-neutral-800 dark:text-neutral-200">
												{formatCost(turn.estimatedCost)}
											</p>
										</div>
									</div>

									<div>
										<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
											Latency Breakdown
										</p>
										<div className="flex gap-4 text-sm text-neutral-800 dark:text-neutral-200">
											<span>Query Gen: {turn.latency.queryGen}ms</span>
											<span>Retrieval: {turn.latency.retrieval}ms</span>
											<span>LLM: {turn.latency.llm}ms</span>
											<span className="text-neutral-500 dark:text-neutral-400">
												(Total: {turn.latency.total}ms)
											</span>
										</div>
									</div>

									<div>
										<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
											User Message
										</p>
										<p className="text-neutral-800 dark:text-neutral-200 text-sm">
											{turn.prompt.userMessage}
										</p>
									</div>

									<div>
										<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
											Response
										</p>
										<p className="text-neutral-800 dark:text-neutral-200 text-sm whitespace-pre-wrap">
											{turn.response}
										</p>
									</div>

									{turn.translation && (
										<div>
											<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
												Translation
											</p>
											<div className="flex gap-4 text-sm text-neutral-800 dark:text-neutral-200">
												<span>Language: {turn.translation.detectedLang}</span>
												<span>
													{turn.translation.wasTranslated
														? "Translated"
														: "No translation needed"}
												</span>
											</div>
										</div>
									)}

									<div>
										<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
											Generated Queries ({turn.retrieval.generatedQueries.length})
										</p>
										<ul className="list-disc list-inside text-sm text-neutral-800 dark:text-neutral-200">
											{turn.retrieval.generatedQueries.map((query) => (
												<li key={query}>{query}</li>
											))}
										</ul>
									</div>

									<div>
										<p className="text-neutral-500 dark:text-neutral-400 text-xs mb-1">
											Retrieved Chunks ({turn.retrieval.chunksReturned} of{" "}
											{turn.retrieval.topK} requested)
										</p>
										{turn.retrieval.chunks.length > 0 ? (
											<div className="space-y-2 mt-2">
												{turn.retrieval.chunks.map((chunk, idx) => (
													<details
														key={`${chunk.similarity}-${chunk.content.slice(0, 50)}`}
														className="border border-neutral-200 dark:border-neutral-700 rounded text-sm"
													>
														<summary className="flex justify-between items-center p-2 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700/50">
															<span className="text-neutral-500 dark:text-neutral-400 text-xs">
																Chunk {idx + 1}
															</span>
															<span className="text-xs font-mono text-neutral-600 dark:text-neutral-300">
																{(chunk.similarity * 100).toFixed(1)}% match
															</span>
														</summary>
														<p className="text-neutral-800 dark:text-neutral-200 text-xs whitespace-pre-wrap p-2 pt-0">
															{chunk.content}
														</p>
													</details>
												))}
											</div>
										) : (
											<p className="text-neutral-500 dark:text-neutral-400 text-sm">
												No chunks retrieved
											</p>
										)}
									</div>

									<details className="border border-neutral-200 dark:border-neutral-700 rounded text-sm">
										<summary className="p-2 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700/50 text-neutral-500 dark:text-neutral-400 text-xs">
											System Prompt
										</summary>
										<p className="text-neutral-800 dark:text-neutral-200 text-xs whitespace-pre-wrap p-2 pt-0">
											{turn.prompt.system}
										</p>
									</details>
								</div>
							)}
						</div>
					);
				})}

				{initialTurns.length === 0 && (
					<div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
						No turns logged yet. Send a chat message to see data here.
					</div>
				)}
			</div>
		</div>
	);
}
