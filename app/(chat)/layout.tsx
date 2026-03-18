import type { Metadata } from "next";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata: Metadata = {
	title: "Chat • Catapult CMS Chatbot",
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-screen dark:bg-neutral-900">
			<header className="flex items-center justify-end px-4 py-3">
				<LogoutButton />
			</header>
			{children}
		</div>
	);
}
