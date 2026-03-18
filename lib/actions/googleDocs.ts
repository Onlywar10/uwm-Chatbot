export async function extractTextFromGoogleDoc(url: string) {
	try {
		const response = await fetch(url);
		const rawText = await response.text();

		const content = rawText.replace(/\s+/g, " ").trim();

		return {
			ok: true as const,
			text: content,
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
