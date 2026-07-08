"use client";

/**
 * Static crisis resources, rendered instantly when the server's keyword screen
 * flags a message (crisis metadata on the assistant message). Every number is
 * hardcoded — never composed by the model.
 */
export function CrisisCard() {
	return (
		<div className="mb-2 w-full rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
			<div className="font-medium text-red-900">If you're in crisis, help is available now</div>
			<div className="mt-2 flex flex-wrap gap-2">
				<a
					href="tel:988"
					className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white"
				>
					📞 Call or text 988
				</a>
				<a
					href="tel:911"
					className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-800"
				>
					🚨 911 if in danger
				</a>
				<a
					href="tel:211"
					className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-800"
				>
					Dial 2-1-1
				</a>
			</div>
			<p className="mt-1.5 text-xs text-red-800">
				988 Suicide & Crisis Lifeline — free, confidential, 24/7.
			</p>
		</div>
	);
}
