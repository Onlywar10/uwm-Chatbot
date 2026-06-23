"use client";

import { Component, type ReactNode, useEffect, useState } from "react";

/**
 * TEMPORARY mobile debugging aids for the widget iframe.
 *
 * The widget renders blank-white on mobile and we can't tell from outside
 * whether (a) the document never rendered / a client crash happened, or
 * (b) the content rendered but the height chain collapsed to 0 (the known
 * iOS `height:100%`-inside-iframe issue). Both look identical: a white box.
 *
 * These two helpers make the difference observable directly on the phone:
 *  - WidgetErrorBoundary turns a silent render/hydration crash into on-screen
 *    red text (otherwise React renders nothing → blank).
 *  - DebugOverlay is position:fixed (so it shows even if the flex layout is
 *    0px tall) and prints the live viewport/element heights + any JS errors.
 *
 * Remove both once the cause is found. Enabled only when the iframe URL has
 * `?debug=1`, so it never shows for real users.
 */

export class WidgetErrorBoundary extends Component<
	{ children: ReactNode },
	{ error: Error | null }
> {
	state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	render() {
		if (this.state.error) {
			return (
				<div
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 2147483647,
						background: "#fff",
						color: "#b00020",
						font: "12px/1.4 ui-monospace,Menlo,monospace",
						padding: 12,
						overflow: "auto",
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
					}}
				>
					{"RENDER CRASH\n\n"}
					{this.state.error.name}: {this.state.error.message}
					{"\n\n"}
					{this.state.error.stack}
				</div>
			);
		}
		return this.props.children;
	}
}

type Metrics = {
	ua: string;
	winInner: string;
	docClient: string;
	bodyH: number;
	rootH: number;
	chatH: number;
	error: string;
};

export function DebugOverlay() {
	const [enabled, setEnabled] = useState(false);
	const [m, setM] = useState<Metrics | null>(null);

	useEffect(() => {
		if (typeof window === "undefined") return;
		if (!new URLSearchParams(window.location.search).has("debug")) return;
		setEnabled(true);

		let lastError = "";
		const onError = (e: ErrorEvent) => {
			lastError = `${e.message} @ ${e.filename}:${e.lineno}`;
		};
		const onRejection = (e: PromiseRejectionEvent) => {
			lastError = `unhandledrejection: ${String(e.reason)}`;
		};
		window.addEventListener("error", onError);
		window.addEventListener("unhandledrejection", onRejection);

		const sample = () => {
			const root = document.getElementById("widget-root");
			const chat = document.getElementById("widget-chat");
			setM({
				ua: navigator.userAgent,
				winInner: `${window.innerWidth}x${window.innerHeight}`,
				docClient: `${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
				bodyH: document.body?.offsetHeight ?? -1,
				rootH: root?.offsetHeight ?? -1,
				chatH: chat?.offsetHeight ?? -1,
				error: lastError || "(none)",
			});
		};

		sample();
		// Re-sample a few times: mobile chrome resizes after load, and we want
		// to see whether heights settle to non-zero or stay collapsed.
		const id = window.setInterval(sample, 1000);
		return () => {
			window.clearInterval(id);
			window.removeEventListener("error", onError);
			window.removeEventListener("unhandledrejection", onRejection);
		};
	}, []);

	if (!enabled || !m) return null;

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				zIndex: 2147483647,
				background: "rgba(0,0,0,0.85)",
				color: "#0f0",
				font: "11px/1.35 ui-monospace,Menlo,monospace",
				padding: "6px 8px",
				maxHeight: "45%",
				overflow: "auto",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
			}}
		>
			{`win(inner): ${m.winInner}
doc(client): ${m.docClient}
body H:      ${m.bodyH}
#widget-root H: ${m.rootH}
#widget-chat H: ${m.chatH}
err: ${m.error}
ua: ${m.ua}`}
		</div>
	);
}
