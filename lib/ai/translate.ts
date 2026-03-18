function getTranslateUrl(): string {
	const url = process.env.LINGVANEX_API_URL;
	if (!url) {
		throw new Error("LINGVANEX_API_URL is not set");
	}
	return url;
}

function getDetectUrl(): string {
	const url = process.env.LINGVANEX_DETECT_URL;
	if (!url) {
		throw new Error("LINGVANEX_DETECT_URL is not set");
	}
	return url;
}

function getApiKey(): string {
	const key = process.env.LINGVANEX_API_KEY;
	if (!key) {
		throw new Error("LINGVANEX_API_KEY is not set");
	}
	return key;
}

function lingvanexHeaders(): HeadersInit {
	return {
		accept: "application/json",
		"content-type": "application/json",
		Authorization: getApiKey(),
	};
}

interface DetectResponse {
	data: {
		detections: { language: string; confidence: number; isReliable: boolean }[][];
	};
}

interface TranslateRequest {
	to: string;
	data: string;
	platform: "api";
	from?: string;
}

interface TranslateResponse {
	err: string | null;
	result: string;
}

export interface TranslationResult {
	detectedLang: string;
	translatedText: string;
	wasTranslated: boolean;
}

export async function detectLanguage(text: string): Promise<string> {
	const res = await fetch(getDetectUrl(), {
		method: "POST",
		headers: lingvanexHeaders(),
		body: JSON.stringify({ q: text }),
	});

	if (!res.ok) {
		console.error(`[translate] detect failed: ${res.status} ${res.statusText}`);
		return "en";
	}

	const data: DetectResponse = await res.json();
	const detections = data.data?.detections;

	if (!detections?.length || !detections[0]?.length) {
		console.error("[translate] detect returned empty result");
		return "en";
	}

	return detections[0].reduce((best, item) =>
		item.confidence > best.confidence ? item : best,
	).language;
}

export async function translateText(text: string, to: string, from?: string): Promise<string> {
	const body: TranslateRequest = { to, data: text, platform: "api" };
	if (from) body.from = from;

	const res = await fetch(`${getTranslateUrl()}/translate`, {
		method: "POST",
		headers: lingvanexHeaders(),
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		console.error(`[translate] translate failed: ${res.status} ${res.statusText}`);
		return text;
	}

	const data: TranslateResponse = await res.json();

	if (data.err || !data.result) {
		console.error("[translate] returned error:", data.err);
		return text;
	}

	return data.result;
}

export async function translateUserMessage(text: string): Promise<TranslationResult> {
	const detectedLang = await detectLanguage(text);
	const isEnglish = detectedLang.startsWith("en");

	if (isEnglish) {
		return { detectedLang, translatedText: text, wasTranslated: false };
	}

	const translatedText = await translateText(text, "en_GB", detectedLang);
	return { detectedLang, translatedText, wasTranslated: true };
}
