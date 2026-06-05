import { processGoogleDocs, processGoogleDrivePdf } from "./google";
import { processHtml } from "./html";
import { processPdf } from "./pdf";
import { upsertPdfResource, upsertResource } from "../../resources";

export async function processPage(
	url: string,
	response: Response,
	entityId: string,
	maxCharsPerPage: number,
	domain: string,
	crawlSettingId: string,
) {
	try {
		let fileType: "html" | "pdf" | "doc" | null = null;
		let contentSnapshot: string = "";
		let resourceId: string = "";

		if (response.headers.get("content-type")?.includes("application/pdf")) {
			const result = await processPdf(url);
			if (!result.ok) throw new Error(result.error);

			const resource = await upsertPdfResource({
				domain: domain,
				url,
				entityId,
				crawlSettingId,
				pdfName: result.pdfName,
				content: result.content,
				pages: result.pages,
				pdfCreation: result.pdfCreation,
				headings: result.headings,
			});

			if (!resource.ok) throw new Error(resource.error);

			fileType = "pdf";
			contentSnapshot = result.content;
			resourceId = resource.resourceId;
		} else if (url.startsWith("https://drive.google.com/file/d/")) {
			const result = await processGoogleDrivePdf(url);
			if (!result.ok) throw new Error(result.error);

			const resource = await upsertPdfResource({
				domain: domain,
				url,
				entityId,
				crawlSettingId,
				pdfName: result.pdfName,
				content: result.content,
				pages: result.pages,
				pdfCreation: result.pdfCreation,
				headings: result.headings,
			});

			if (!resource.ok) throw new Error(resource.error);

			fileType = "pdf";
			contentSnapshot = result.content;
			resourceId = resource.resourceId;
		} else if (url.startsWith("https://docs.google.com/document/d/")) {
			const result = await processGoogleDocs(url);
			if (!result.ok) throw new Error(result.error);

			const resource = await upsertResource({
				domain,
				url,
				entityId,
				content: result.content,
				crawlSettingId,
				pageTitle: "",
				file_type: "html",
				categories: {},
			});

			if (!resource.ok) throw new Error(resource.error);

			fileType = "doc";
			contentSnapshot = result.content;
			resourceId = resource.resourceId;
		} else {
			const result = await processHtml(url, response, maxCharsPerPage);
			if (!result.ok) throw new Error(result.error);

			const resource = await upsertResource({
				domain,
				url,
				entityId,
				content: result.content,
				crawlSettingId,
				pageTitle: result.pageTitle,
				file_type: "html",
				categories: result.categories,
			});

			if (!resource.ok) throw new Error(resource.error);

			fileType = "html";
			contentSnapshot = result.content;
			resourceId = resource.resourceId;
		}

		return {
			ok: true as const,
			resourceId,
			fileType,
			contentSnapshot,
		};
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof Error && error.message.length > 0
					? error.message
					: "Error, please try again.",
		};
	}
}
