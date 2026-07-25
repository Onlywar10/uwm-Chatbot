import { describe, expect, it } from "vitest";
import { assertUrlAllowed, isPrivateIp, SsrfError } from "./ssrf";

describe("isPrivateIp", () => {
	it("flags loopback, private, link-local, CGNAT, and metadata IPv4", () => {
		for (const ip of [
			"127.0.0.1",
			"10.1.2.3",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"169.254.169.254", // cloud metadata
			"100.64.0.1", // CGNAT
			"0.0.0.0",
			"224.0.0.1", // multicast
		]) {
			expect(isPrivateIp(ip), ip).toBe(true);
		}
	});

	it("allows public IPv4", () => {
		for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34"]) {
			expect(isPrivateIp(ip), ip).toBe(false);
		}
	});

	it("flags loopback/link-local/unique-local and mapped-private IPv6", () => {
		for (const ip of ["::1", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1"]) {
			expect(isPrivateIp(ip), ip).toBe(true);
		}
	});

	it("allows public IPv6", () => {
		expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
	});
});

describe("assertUrlAllowed", () => {
	it("rejects non-http(s) schemes", async () => {
		await expect(assertUrlAllowed("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfError);
		await expect(assertUrlAllowed("ftp://example.com")).rejects.toBeInstanceOf(SsrfError);
	});

	it("rejects literal private/metadata IP hosts without DNS", async () => {
		await expect(assertUrlAllowed("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
			SsrfError,
		);
		await expect(assertUrlAllowed("http://127.0.0.1:8080/")).rejects.toBeInstanceOf(SsrfError);
		await expect(assertUrlAllowed("http://[::1]/")).rejects.toBeInstanceOf(SsrfError);
	});

	it("allows a literal public IP host", async () => {
		await expect(assertUrlAllowed("https://8.8.8.8/")).resolves.toBeUndefined();
	});

	it("rejects a malformed URL", async () => {
		await expect(assertUrlAllowed("not a url")).rejects.toBeInstanceOf(SsrfError);
	});
});
