import { getWidget } from "@/lib/actions/widgetConfigs";
import { notFound } from "next/navigation";
import WidgetChat from "./WidgetChat";
import { DebugOverlay, WidgetErrorBoundary } from "./WidgetDebug";

export default async function WidgetPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const widget = await getWidget(id);

	if (!widget || !widget.enabled) {
		notFound();
	}

	return (
		<WidgetErrorBoundary>
			<DebugOverlay />
			<WidgetChat
				widget={{
					id: widget.id,
					name: widget.name,
					domains: widget.domains,
					greeting: widget.greeting,
					suggestedQuestions: widget.suggestedQuestions,
					accentColor: widget.accentColor,
				}}
			/>
		</WidgetErrorBoundary>
	);
}
