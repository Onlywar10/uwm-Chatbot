import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Admin • Catapult CMS Chatbot",
	description: "Admin panel for managing a school districts specific resources and embeddings",
};

export default function AdminDistrictLayout({ children }: { children: React.ReactNode }) {
	return <>{children}</>;
}
