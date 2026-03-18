import {
	listFeedback,
	getFeedbackStats,
	getDistinctFeedbackDomains,
} from "@/lib/actions/feedback";
import { FeedbackClient } from "./FeedbackClient";

export default async function FeedbackPage() {
	const [items, stats, domains] = await Promise.all([
		listFeedback(),
		getFeedbackStats(),
		getDistinctFeedbackDomains(),
	]);

	return (
		<main className="min-h-screen w-full dark:bg-neutral-900 px-4 py-6">
			<div className="max-w-3xl mx-auto">
				<h1 className="text-2xl font-semibold text-neutral-800 dark:text-neutral-100 mb-6">
					Feedback
				</h1>
				<FeedbackClient initialItems={items} initialStats={stats} domains={domains} />
			</div>
		</main>
	);
}
