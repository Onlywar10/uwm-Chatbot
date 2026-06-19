import type { Metadata } from "next";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata: Metadata = {
	title: "Chat • Catapult CMS Chatbot",
};

// The chat page is fully client-interactive (useChat) and pulls in browser-only
// libs (sonner, streamdown) that touch `document` at module load. Static
// prerendering runs that code in a build worker with an incomplete `document`,
// crashing the build. Render on demand instead — there's no SSG value here.
export const dynamic = "force-dynamic";

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
