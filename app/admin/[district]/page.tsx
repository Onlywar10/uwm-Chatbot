import { getDistrictDetails, getDomainStats } from "@/lib/actions/admin";
import AdminDistrictClient from "./AdminDistrictClient";

export default async function AdminPage({ params }: { params: Promise<{ district: string }> }) {
	const { district } = await params;
	const districtDetails = await getDistrictDetails(district);

	const initialStats = await getDomainStats();
	return <AdminDistrictClient initialStats={initialStats} districtDetails={districtDetails} />;
}
