import { extractText, getDocumentProxy } from "unpdf";

export async function extractTextFromPdf(url: string) {
	try {
		const buffer = await fetch(url).then((res) => res.arrayBuffer());

		const pdf = await getDocumentProxy(new Uint8Array(buffer));
		const { text } = await extractText(pdf, { mergePages: true });

		const cleaned = text
			.replace(/[^\x20-\x7E\n\r\t]/g, "")
			.replace(/[□◎©®™•◦▪▫●○■□★☆♦♥♠♣←→↑↓]/g, "")
			.replace(/[!]{2,}/g, " ")
			.replace(/[?]{2,}/g, " ")
			.replace(/[.]{3,}/g, " ")
			.replace(/[-]{3,}/g, " ")
			.replace(/\s+\n+/g, " ");

		pdf.destroy();

		return {
			ok: true as const,
			text: cleaned,
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
