import type { ChatSource } from "@/lib/types/chat";

function hostLabel(url: string): string {
	try {
		const u = new URL(url);
		return (u.hostname + u.pathname).replace(/\/$/, "");
	} catch {
		return url;
	}
}

/**
 * Expandable "Sources" list shown under an assistant reply: the pages the answer
 * was grounded in. Renders nothing when there are no sources.
 */
export function Sources({ sources }: { sources: ChatSource[] }) {
	if (!sources || sources.length === 0) return null;

	return (
		<details className="mt-1 max-w-[85%] text-xs text-neutral-500">
			<summary className="cursor-pointer select-none hover:text-neutral-700">
				Sources ({sources.length})
			</summary>
			<ul className="mt-1 flex flex-col gap-1 pl-1">
				{sources.map((source) => (
					<li key={source.url}>
						<a
							href={source.url}
							target="_blank"
							rel="noreferrer"
							className="text-blue-600 underline underline-offset-2 hover:text-blue-800 break-all"
							title={source.url}
						>
							{source.title?.trim() || hostLabel(source.url)}
						</a>
					</li>
				))}
			</ul>
		</details>
	);
}
