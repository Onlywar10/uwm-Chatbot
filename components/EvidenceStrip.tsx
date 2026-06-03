"use client";

export type AnalyticsPayload = {
	metric?: string;
	resolvedDateRange?: string;
	groupedBy?: string[];
	denominator?: { description?: string; value?: number };
	coverageNotes?: string[];
	fieldAvailability?: { field: string; recorded: number; of: number; window: string }[];
	rows?: { group: Record<string, string | null>; value: number }[];
};

/**
 * Shows the data behind an answer: the resolved window, denominator, coverage
 * caveats, and the underlying rows. Lets staff verify a number before quoting it.
 */
export function EvidenceStrip({ data }: { data: AnalyticsPayload }) {
	const rows = data.rows ?? [];
	const groupKeys = data.groupedBy ?? [];

	return (
		<div className="mt-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 p-3 text-xs text-neutral-600 dark:text-neutral-400">
			<div className="flex flex-wrap gap-x-4 gap-y-1">
				{data.metric && (
					<span>
						metric: <span className="font-mono">{data.metric}</span>
					</span>
				)}
				{data.resolvedDateRange && <span>range: {data.resolvedDateRange}</span>}
				{data.denominator?.value !== undefined && (
					<span>
						{data.denominator.description ?? "total"}: {data.denominator.value.toLocaleString()}
					</span>
				)}
			</div>

			{data.coverageNotes && data.coverageNotes.length > 0 && (
				<ul className="mt-2 list-disc pl-4 text-amber-700 dark:text-amber-500">
					{data.coverageNotes.map((note) => (
						<li key={note}>{note}</li>
					))}
				</ul>
			)}

			{data.fieldAvailability && data.fieldAvailability.length > 0 && (
				<div className="mt-2">
					{data.fieldAvailability.map((f) => (
						<div key={f.field}>
							{f.field}: recorded on {f.recorded.toLocaleString()} of {f.of.toLocaleString()} (
							{f.window})
						</div>
					))}
				</div>
			)}

			{rows.length > 0 && (
				<table className="mt-2 w-full">
					<thead className="text-left">
						<tr>
							{groupKeys.map((k) => (
								<th key={k} className="pr-3 py-1 font-medium">
									{k}
								</th>
							))}
							<th className="py-1 font-medium">value</th>
						</tr>
					</thead>
					<tbody className="font-mono text-neutral-800 dark:text-neutral-200">
						{rows.slice(0, 25).map((r, i) => (
							<tr key={`${JSON.stringify(r.group)}-${i}`}>
								{groupKeys.map((k) => (
									<td key={k} className="pr-3 py-0.5">
										{r.group[k] ?? "—"}
									</td>
								))}
								<td className="py-0.5">{r.value.toLocaleString()}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
