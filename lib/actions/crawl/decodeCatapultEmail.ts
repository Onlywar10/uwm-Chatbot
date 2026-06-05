// Port of Catapult's client-side email de-obfuscation (ccms_l / ccms_O2). Emails
// are stored as `javascript:ccms_O('a&b&c...', z, y)` where each number is a
// char code recovered via modular exponentiation (char^y mod z). Decoding lets
// us keep the real address in crawled content even when the visible link text is
// just a label (e.g. "BOESecretary").

function ccmsPow(m: number, n: number, o: number): number {
	let u = m;
	const v = (m * m) % n;
	if (o % 2 === 0) u = 1;
	const half = o / 2;
	for (let i = 1; i <= half; i++) u = (v * u) % n;
	return u;
}

function ccmsDecode(x: string, z: number, y: number): string {
	let out = "";
	for (const part of `${x} `.split("&")) {
		const code = Number.parseInt(part, 10);
		if (Number.isNaN(code)) continue;
		out += String.fromCharCode(ccmsPow(code, z, y));
	}
	return out;
}

/**
 * Decodes a Catapult `javascript:ccms_O(...)` / `O(...)` email link to the plain
 * address, or returns null if the href isn't such a link or doesn't decode to an
 * email.
 */
export function decodeCatapultEmail(href: string): string | null {
	const match = href.match(/(?:ccms_O|O)\(\s*['"]([^'"]+)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (!match) return null;

	const decoded = ccmsDecode(match[1], Number(match[2]), Number(match[3]));
	const value = decoded.replace(/^mailto:/i, "").trim();
	return value.includes("@") ? value : null;
}
