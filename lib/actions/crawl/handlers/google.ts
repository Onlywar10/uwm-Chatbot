import { processPdf } from "./pdf";

async function getGoogleDriveFileName(fileId: string): Promise<string | null> {
	const res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, {
		method: "HEAD",
		redirect: "follow",
	});

	const disposition = res.headers.get("content-disposition");
	if (!disposition) return null;

	// Header looks like: attachment; filename="My Document.pdf"
	const match = disposition.match(/filename[^;=\n]*=["']?([^"'\n;]+)["']?/);
	return match?.[1]?.replace(/\.pdf$/i, "").replace(/-/g, " ") ?? null;
}

async function getGoogleDriveBuffer(
	url: string,
): Promise<{ buffer: ArrayBuffer; fileName: string | null }> {
	const match = url.match(/\/file\/d\/([^/]+)/);
	if (!match) throw new Error(`Could not extract file ID from: ${url}`);

	const fileId = match[1];
	const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

	const res1 = await fetch(downloadUrl, { redirect: "follow" });

	if (res1.status === 401 || res1.status === 403) {
		throw new Error(`Drive file is private or org-restricted: ${fileId}`);
	}

	const fileName = await getGoogleDriveFileName(fileId);
	const contentType = res1.headers.get("content-type") ?? "";

	if (contentType.includes("text/html")) {
		const html = await res1.text();
		const confirmMatch = html.match(/confirm=([0-9A-Za-z_]+)/);
		if (!confirmMatch) throw new Error(`Drive requires auth for file: ${fileId}`);

		const confirmUrl = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${fileId}`;
		const res2 = await fetch(confirmUrl, { redirect: "follow" });
		const buffer = await res2.arrayBuffer();

		const bytes = new Uint8Array(buffer.slice(0, 5));
		if (String.fromCharCode(...bytes) !== "%PDF-") {
			throw new Error(`Drive file is not a PDF: ${fileId}`);
		}

		return { buffer, fileName };
	}

	const buffer = await res1.arrayBuffer();

	const bytes = new Uint8Array(buffer.slice(0, 5));
	if (String.fromCharCode(...bytes) !== "%PDF-") {
		throw new Error(`Drive file is not a PDF: ${fileId}`);
	}

	return { buffer, fileName };
}

export async function processGoogleDrivePdf(url: string) {
	try {
		const result = await getGoogleDriveBuffer(url);
		const buffer = result.buffer;
		const pdfName = result.fileName ?? "";

		const response = await processPdf(url, pdfName, buffer);
		if (!response.ok) throw new Error(response.error);

		return {
			ok: true as const,
			pdfName: response.pdfName,
			content: response.content,
			pages: response.pages,
			pdfCreation: response.pdfCreation,
			headings: response.headings,
		};
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof Error && error.message.length > 0
					? error.message
					: `Error procesing google drive PDF: ${url}`,
		};
	}
}

export async function processGoogleDocs(url: string) {
	try {
		const docId = url.match(/\/d\/(.*?)\//)?.[1];
		const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=md`;

		const response = await fetch(exportUrl);
		const markdown = await response.text();

		const disposition = response.headers.get("content-disposition");
		const docName = disposition
			?.match(/filename="(.+?)"/)?.[1]
			.replace(".md", "")
			.replace(/-/g, " ");

		return {
			ok: true as const,
			content: markdown,
			docName,
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
