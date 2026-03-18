import { listTurns } from "@/lib/actions/dev";
import { DevClient } from "./DevClient";

export default async function DevPage() {
	const turns = await listTurns(50);

	return (
		<main className="min-h-screen w-full dark:bg-neutral-900 px-4 py-6">
			<div className="max-w-3xl mx-auto">
				<h1 className="text-2xl font-semibold text-neutral-800 dark:text-neutral-100 mb-6">
					Chat Turns
				</h1>
				<DevClient initialTurns={turns} />
			</div>
		</main>
	);
}
