import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { requireRole } from "@/lib/auth/guards";

export const metadata: Metadata = {
	title: "Dev Tools • Catapult CMS Chatbot",
	description: "Developer tools for debugging the chat pipeline",
};

export default async function DevLayout({ children }: { children: React.ReactNode }) {
	try {
		await requireRole("admin");
	} catch {
		redirect("/login");
	}

	return (
		<div className="min-h-screen dark:bg-neutral-900">
			<header className="flex items-center justify-end px-4 py-3">
				<LogoutButton />
			</header>
			{children}
		</div>
	);
}
