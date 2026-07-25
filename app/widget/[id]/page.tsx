import { getWidget } from "@/lib/actions/widgetConfigs";
import { notFound } from "next/navigation";
import WidgetChat from "./WidgetChat";

export default async function WidgetPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const widget = await getWidget(id);

	if (!widget || !widget.enabled) {
		notFound();
	}

	return (
		<WidgetChat
			widget={{
				id: widget.id,
				name: widget.name,
				domains: widget.domains,
				greeting: widget.greeting,
				suggestedQuestions: widget.suggestedQuestions,
				accentColor: widget.accentColor,
				// Echoed back on every chat POST so a guessed widget id alone can't
				// drive the bot. Public by design — see widget_configs.widget_token.
				widgetToken: widget.widgetToken,
			}}
		/>
	);
}
