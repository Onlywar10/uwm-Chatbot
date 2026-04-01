import Script from "next/script";

const WIDGET_ID = "uwm-widget-001";

export default function DemoPage() {
	return (
		<div className="min-h-screen bg-white">
			<header className="border-b border-neutral-200 px-8 py-4">
				<div className="max-w-5xl mx-auto flex items-center justify-between">
					<h1 className="text-xl font-semibold text-neutral-900">
						United Way of Merced County
					</h1>
					<nav className="flex gap-6 text-sm text-neutral-600">
						<span className="hover:text-neutral-900 cursor-default">About</span>
						<span className="hover:text-neutral-900 cursor-default">Programs</span>
						<span className="hover:text-neutral-900 cursor-default">211 Merced</span>
						<span className="hover:text-neutral-900 cursor-default">Contact</span>
					</nav>
				</div>
			</header>

			<main className="max-w-5xl mx-auto px-8 py-16">
				<h2 className="text-3xl font-bold text-neutral-900 mb-4">
					Welcome to Our Community
				</h2>
				<p className="text-neutral-600 text-lg mb-8 max-w-2xl">
					This is a demo page simulating a Squarespace site with the chat
					widget embedded. Click the chat bubble in the bottom-right corner to
					try it out.
				</p>

				<div className="grid grid-cols-2 gap-6">
					<div className="border border-neutral-200 rounded-lg p-6">
						<h3 className="font-semibold text-neutral-900 mb-2">
							United Way of Merced
						</h3>
						<p className="text-sm text-neutral-600">
							Placeholder content representing the main United Way site.
						</p>
					</div>
					<div className="border border-neutral-200 rounded-lg p-6">
						<h3 className="font-semibold text-neutral-900 mb-2">
							211 Merced
						</h3>
						<p className="text-sm text-neutral-600">
							Placeholder content representing the 211 Merced resource
							directory.
						</p>
					</div>
				</div>

				<div className="mt-12 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
					<p className="text-xs font-mono text-neutral-500">
						Widget ID: {WIDGET_ID}
					</p>
					<p className="text-xs text-neutral-400 mt-1">
						The chat bubble loader script is injected at the bottom of this
						page, just like it would be in Squarespace Code Injection.
					</p>
				</div>
			</main>

			<Script src="/widget.js" data-widget-id={WIDGET_ID} strategy="lazyOnload" />
		</div>
	);
}
