import { describe, expect, it } from "vitest";
import { htmlToMarkdown, markdownToPlain } from "./html";

describe("htmlToMarkdown", () => {
	it("converts the list + link + mark case seen in live data", () => {
		const raw =
			'<ul> <li>Proof of address</li> <li>Proof of income</li> </ul> Fill an application for ' +
			'<a href="https://loveincmerced.com/client-forms.html">new or returning applicants</a> ' +
			"<mark>The Hoffmeister Center (1920 Canal St, Merced, CA 95340) is for dropping off " +
			"documents and forms only.</mark>";
		const md = htmlToMarkdown(raw);

		expect(md).toContain("- Proof of address");
		expect(md).toContain("- Proof of income");
		// The link survives as a real markdown link — these point at application forms.
		expect(md).toContain("[new or returning applicants](https://loveincmerced.com/client-forms.html)");
		// <mark> keeps its text but loses the tag.
		expect(md).not.toContain("<mark>");
		expect(md).toContain("Hoffmeister Center");
		expect(md).not.toMatch(/<[a-z/][^>]*>/i);
	});

	it("passes plain text through untouched", () => {
		expect(htmlToMarkdown("Call ahead to confirm hours.")).toBe("Call ahead to confirm hours.");
	});

	it("returns null for empty input", () => {
		expect(htmlToMarkdown(null)).toBeNull();
		expect(htmlToMarkdown("   ")).toBeNull();
	});

	it("unwraps anchors with no usable target", () => {
		expect(htmlToMarkdown('<a href="#">Click here</a> for details')).toBe("Click here for details");
	});

	it("converts <br> and <b> without leaving markup", () => {
		const md = htmlToMarkdown("Mon-Fri<br>9am-5pm<br><b>Closed holidays</b>");
		expect(md).not.toMatch(/<[a-z/][^>]*>/i);
		expect(md).toContain("Closed holidays");
	});

	it("does not leave backslash escapes in short prose", () => {
		expect(htmlToMarkdown("<p>Fee is $25 (9-5 only)</p>")).toBe("Fee is $25 (9-5 only)");
	});
});

describe("markdownToPlain", () => {
	it("keeps link labels and drops URLs, so embeddings never see them", () => {
		expect(markdownToPlain("Apply [here](https://example.org/forms) today")).toBe(
			"Apply here today",
		);
	});

	it("flattens bullets and emphasis", () => {
		expect(markdownToPlain("- **Proof** of address\n- Proof of income")).toBe(
			"Proof of address Proof of income",
		);
	});
});
