export default function WidgetLayout({ children }: { children: React.ReactNode }) {
	return (
		<>
			{/* The widget renders inside an iframe. Fill the iframe via a 100% height
			    chain (html → body → here) rather than viewport units (vh/dvh), which
			    resolve to ~0 inside an iframe on iOS Safari and leave the chat blank.
			    Scoped to this layout, so it only affects the /widget route's document. */}
			<style>{"html,body{height:100%;margin:0}"}</style>
			<div id="widget-root" className="h-full bg-white text-neutral-900">
				{children}
			</div>
		</>
	);
}
