import { db } from "@/lib/db";
import { widgetConfigs } from "@/lib/db/schema/widgetConfigs";

// The /demo page embeds the widget loader with a fixed data-widget-id, so a
// widget_configs row with this exact id must exist or /widget/<id> 404s.
// `domains` should match a crawled domain so widget retrieval finds content.
const DEMO_WIDGET = {
	id: "uwm-widget-001",
	name: "United Way of Merced Widget",
	domains: ["www.unitedwaymerced.org", "www.211merced.org", "www.freetaxesmerced.com"],
	greeting: "Ask about local resources, free tax help, or what United Way of Merced does.",
	// One per thing the bot can do: 211 directory search, site Q&A (VITA), about us.
	// WidgetChat.tsx falls back to the same three when a row has none.
	suggestedQuestions: [
		"I need help with food, rent, or utilities",
		"Where can I get my taxes done for free?",
		"What does United Way of Merced do?",
	],
	accentColor: "#003DA5",
	enabled: true,
};

async function main() {
	await db
		.insert(widgetConfigs)
		.values(DEMO_WIDGET)
		.onConflictDoUpdate({
			target: widgetConfigs.id,
			set: {
				name: DEMO_WIDGET.name,
				domains: DEMO_WIDGET.domains,
				greeting: DEMO_WIDGET.greeting,
				suggestedQuestions: DEMO_WIDGET.suggestedQuestions,
				accentColor: DEMO_WIDGET.accentColor,
				enabled: true,
			},
		});

	console.log(`Seeded demo widget "${DEMO_WIDGET.id}" scoped to ${DEMO_WIDGET.domains.join(", ")}`);
	process.exit(0);
}

main();
