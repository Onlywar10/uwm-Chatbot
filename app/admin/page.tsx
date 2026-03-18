import { getDistricts } from "@/lib/actions/admin";
import AdminClient from "./AdminClient";

export default async function AdminPage() {
	const allDistricts = await getDistricts();
	return <AdminClient allDistricts={allDistricts} />;
}
