"use client";

import { FeedbackButtons } from "@/components/FeedbackButtons";
import { LoadingIcon } from "@/components/icons";
import { type UIMessage, useChat } from "@ai-sdk/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

type WidgetConfig = {
	id: string;
	name: string;
	domains: string[];
	greeting: string | null;
	accentColor: string | null;
};

function getTextFromMessage(message: UIMessage): string {
	return message.parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join(" ")
		.trim();
}

export default function WidgetChat({ widget }: { widget: WidgetConfig }) {
	const { messages, status, sendMessage } = useChat({
		onError: () => {
			toast.error("Something went wrong, please try again.");
		},
	});

	const [input, setInput] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);

	const isAwaitingResponse = status === "submitted" || status === "streaming";

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages, status]);

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const text = input.trim();
		if (!text) return;

		sendMessage({ text }, { body: { widgetId: widget.id } });
		setInput("");
	};

	const accentColor = widget.accentColor || "#1a73e8";

	return (
		<div className="flex flex-col h-screen bg-white">
			<div
				ref={scrollRef}
				className="flex-1 overflow-y-auto p-4 space-y-4"
			>
				{widget.greeting && messages.length === 0 && (
					<div className="flex justify-start">
						<div className="bg-neutral-100 rounded-lg rounded-tl-none px-3 py-2 max-w-[85%] text-sm text-neutral-800">
							{widget.greeting}
						</div>
					</div>
				)}

				{messages.map((message) => (
					<div key={message.id}>
						{message.role === "user" ? (
							<div className="flex justify-end">
								<div
									className="rounded-lg rounded-tr-none px-3 py-2 max-w-[85%] text-sm text-white"
									style={{ backgroundColor: accentColor }}
								>
									{getTextFromMessage(message)}
								</div>
							</div>
						) : (
							<div className="flex flex-col items-start">
								<div className="bg-neutral-100 rounded-lg rounded-tl-none px-3 py-2 max-w-[85%] text-sm text-neutral-800">
									<div className="prose prose-sm prose-neutral max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
										<ReactMarkdown>{getTextFromMessage(message)}</ReactMarkdown>
									</div>
								</div>
								{(message.metadata as { turnId?: string })?.turnId && (
									<FeedbackButtons
										key={(message.metadata as { turnId: string }).turnId}
										turnId={(message.metadata as { turnId: string }).turnId}
									/>
								)}
							</div>
						)}
					</div>
				))}

				{isAwaitingResponse && messages[messages.length - 1]?.role === "user" && (
					<div className="flex justify-start">
						<div className="bg-neutral-100 rounded-lg rounded-tl-none px-3 py-2 text-sm text-neutral-500">
							<div className="flex items-center gap-2">
								<div className="animate-spin text-neutral-400">
									<LoadingIcon />
								</div>
								<span>Thinking...</span>
							</div>
						</div>
					</div>
				)}
			</div>

			<form
				onSubmit={handleSubmit}
				className="border-t border-neutral-200 p-3 flex gap-2 bg-white"
			>
				<input
					className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-offset-1"
					style={{ "--tw-ring-color": accentColor } as React.CSSProperties}
					minLength={3}
					required
					value={input}
					placeholder="Ask a question..."
					onChange={(e) => setInput(e.target.value)}
					disabled={isAwaitingResponse}
				/>
				<button
					type="submit"
					disabled={isAwaitingResponse}
					className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
					style={{ backgroundColor: accentColor }}
				>
					Send
				</button>
			</form>
		</div>
	);
}
