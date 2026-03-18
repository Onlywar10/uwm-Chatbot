import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { requireAuth } from "@/lib/auth/guards";

export const metadata: Metadata = {
	title: "Admin • Catapult CMS Chatbot",
	description: "Admin panel for managing  resources and embeddings",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
	try {
		await requireAuth();
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
