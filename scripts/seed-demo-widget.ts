import { db } from "@/lib/db";
import { widgetConfigs } from "@/lib/db/schema/widgetConfigs";

// The /demo page embeds the widget loader with a fixed data-widget-id, so a
// widget_configs row with this exact id must exist or /widget/<id> 404s.
// `domains` should match a crawled domain so widget retrieval finds content.
const DEMO_WIDGET = {
	id: "uwm-widget-001",
	name: "UWM Demo Widget",
	domains: ["www.unitedwaymerced.org"],
	greeting: "Hi! How can I help you today?",
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
				accentColor: DEMO_WIDGET.accentColor,
				enabled: true,
			},
		});

	console.log(`Seeded demo widget "${DEMO_WIDGET.id}" scoped to ${DEMO_WIDGET.domains.join(", ")}`);
	process.exit(0);
}

main();
