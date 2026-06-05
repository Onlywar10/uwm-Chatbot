import pdf2md from "pdf2md-ts";
import { extractText, getDocumentProxy, getMeta } from "unpdf";

export async function processPdf(
	url: string,
	extractedPdfName?: string,
	extractedBuffer?: ArrayBuffer,
) {
	try {
		let pdfName: string | undefined = extractedPdfName;
		if (!pdfName) pdfName = url.split("/").pop()?.replace(".pdf", "").replace(/-/g, " ") ?? "";

		const buffer: ArrayBuffer =
			extractedBuffer ?? (await fetch(url).then((res) => res.arrayBuffer()));

		const pdf = await getDocumentProxy(new Uint8Array(buffer));

		// pdf2md only feeds heading extraction and throws on some PDFs (e.g. an
		// internal path error on certain Drive files). Degrade to no headings so
		// the unpdf text extraction below still produces the resource content.
		let markdown = "";
		try {
			markdown = (await pdf2md(Buffer.from(buffer))).join("\n");
		} catch {
			markdown = "";
		}

		const [{ text }, { info }] = await Promise.all([
			extractText(pdf, { mergePages: false }),
			getMeta(pdf, { parseDates: true }),
		]);

		pdf.destroy();

		const headings = [
			...new Set(
				markdown
					.split("\n")
					.filter((line) => /^#{1,6}\s/.test(line))
					.map((line) => line.replace(/^#{1,6}\s+/, "").trim())
					.filter((h) => /^[A-Z]/.test(h) && !/[.,:;!?]$/.test(h) && h.length <= 60),
			),
		];

		const { Author, CreationDate } = info;

		const pdfCreation = [
			Author ? `Written by ${Author}` : "",
			CreationDate ? `Published on ${new Date(CreationDate).toDateString()}` : "",
		].join("\n");

		const content = [pdfCreation, ...text].join("\n\n");

		return { ok: true as const, pdfName, content, pages: text, pdfCreation, headings };
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof Error && error.message.length > 0
					? error.message
					: `Error parsing pdf: ${url}`,
		};
	}
}
