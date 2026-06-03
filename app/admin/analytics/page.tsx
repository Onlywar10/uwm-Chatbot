import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/guards";
import AnalyticsChat from "./AnalyticsChat";

export default async function AnalyticsPage() {
	try {
		await requireRole("admin");
	} catch {
		redirect("/admin");
	}
	return <AnalyticsChat />;
}
