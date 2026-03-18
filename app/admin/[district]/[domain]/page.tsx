import { getCrawlSettings, getDomainDetails, getSchoolFromDomain } from "@/lib/actions/admin";
import AdminDomainClient from "./AdminDomainClient";

function decodeDomain(param: string) {
	return decodeURIComponent(param);
}

export default async function DomainPage({ params }: { params: Promise<{ domain: string }> }) {
	const { domain } = await params;
	const decodedDomain = decodeDomain(domain);
	const initialResources = await getDomainDetails(decodedDomain);
	const crawlSettings = await getCrawlSettings(decodedDomain);
	const schoolDetails = await getSchoolFromDomain(decodedDomain);

	return (
		<AdminDomainClient
			domain={decodedDomain}
			initialResources={initialResources}
			crawlSettings={crawlSettings}
			schoolDetails={schoolDetails}
		/>
	);
}
