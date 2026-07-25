import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Server-Side Request Forgery guard for outbound fetches/renders of URLs that a
// user can influence (crawl targets, the render endpoint). It rejects non-http(s)
// schemes and any host that resolves to non-public address space — loopback,
// link-local (including the cloud metadata endpoint 169.254.169.254), private
// ranges, CGNAT, and IPv6 loopback/link-local/unique-local — so a crafted URL
// can't reach internal services.
//
// Known limitation: a hostname is resolved once and its addresses checked, so a
// determined DNS-rebinding attacker could return a public address here and a
// private one at connect time. Closing that fully requires pinning the resolved
// IP into the socket; these paths are already admin/token-gated, so the
// resolve-then-check mitigation is the pragmatic bar for now.

export class SsrfError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SsrfError";
	}
}

function ipv4Parts(ip: string): number[] | null {
	const parts = ip.split(".").map((p) => Number(p));
	if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
		return null;
	}
	return parts;
}

function isPrivateIpv4(ip: string): boolean {
	const p = ipv4Parts(ip);
	if (!p) return false;
	const [a, b] = p;
	if (a === 0) return true; // 0.0.0.0/8 "this network"
	if (a === 10) return true; // 10.0.0.0/8 private
	if (a === 127) return true; // loopback
	if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
	if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
	if (a >= 224) return true; // 224.0.0.0/3 multicast + reserved
	return false;
}

function isPrivateIpv6(raw: string): boolean {
	const ip = raw.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
	if (ip === "::1" || ip === "::") return true; // loopback / unspecified
	if (ip.startsWith("fe80")) return true; // link-local
	if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // fc00::/7 unique-local
	const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
	if (mapped) return isPrivateIpv4(mapped[1]);
	return false;
}

export function isPrivateIp(ip: string): boolean {
	const family = isIP(ip);
	if (family === 4) return isPrivateIpv4(ip);
	if (family === 6) return isPrivateIpv6(ip);
	return false;
}

/** Throws SsrfError if `rawUrl` is not a public http(s) destination. */
export async function assertUrlAllowed(rawUrl: string): Promise<void> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new SsrfError(`Invalid URL: ${rawUrl}`);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new SsrfError(`Blocked non-http(s) URL scheme: ${url.protocol}`);
	}

	const host = url.hostname.replace(/^\[|\]$/g, "");

	// Literal IP host: check directly, no DNS.
	if (isIP(host)) {
		if (isPrivateIp(host)) throw new SsrfError(`Blocked request to private address: ${host}`);
		return;
	}

	// Hostname: reject if ANY resolved address is private.
	let addresses: { address: string }[];
	try {
		addresses = await lookup(host, { all: true });
	} catch {
		throw new SsrfError(`Could not resolve host: ${host}`);
	}
	for (const { address } of addresses) {
		if (isPrivateIp(address)) {
			throw new SsrfError(`Blocked request to private address ${address} (host ${host})`);
		}
	}
}
