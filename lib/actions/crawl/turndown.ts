import TurndownService from "turndown";
import { gfm } from "@truto/turndown-plugin-gfm";
import { decodeCatapultEmail } from "./decodeCatapultEmail";

const td = new TurndownService({ headingStyle: "atx" });
td.use(gfm);

// Catapult obfuscates emails as `javascript:` links and references internal
// pages via `__catapult_pages/{guid}/...` URLs. Both are noise as link targets,
// so unwrap them to plain text. For obfuscated emails we decode the real address
// (kept alongside the label when the visible text isn't already the email), so
// the chatbot can still surface contact emails. Also unwraps empty / `#` anchors.
td.addRule("unwrapJunkLinks", {
	filter: (node) => {
		if (node.nodeName !== "A") return false;
		const href = node.getAttribute("href") ?? "";
		return (
			href === "" ||
			href.startsWith("#") ||
			href.startsWith("javascript:") ||
			href.includes("__catapult_pages")
		);
	},
	replacement: (content, node) => {
		const href = (node as HTMLElement).getAttribute("href") ?? "";
		if (href.startsWith("javascript:")) {
			const email = decodeCatapultEmail(href);
			if (email) {
				const text = content.trim();
				return text && !text.includes("@") ? `${text} (${email})` : email;
			}
		}
		return content;
	},
});

export default td;
