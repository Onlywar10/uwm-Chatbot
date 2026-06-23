"use client";

import { FeedbackButtons } from "@/components/FeedbackButtons";
import { LoadingIcon } from "@/components/icons";
import { Sources } from "@/components/Sources";
import type { ChatSource } from "@/lib/types/chat";
import { type UIMessage, useChat } from "@ai-sdk/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";

type WidgetConfig = {
	id: string;
	name: string;
	domains: string[];
	greeting: string | null;
	suggestedQuestions: string[];
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

	const submitText = (raw: string) => {
		const text = raw.trim();
		if (!text || isAwaitingResponse) return;

		sendMessage({ text }, { body: { widgetId: widget.id } });
		setInput("");
	};

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		submitText(input);
	};

	// United Way of Merced brand blue (overridable per widget config).
	const accentColor = widget.accentColor || "#003DA5";

	return (
		<div className="flex flex-col h-full bg-white">
			<div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
				{widget.greeting && messages.length === 0 && (
					<div className="flex justify-start">
						<div className="bg-neutral-100 rounded-lg rounded-tl-none px-3 py-2 max-w-[85%] text-sm text-neutral-800">
							{widget.greeting}
						</div>
					</div>
				)}

				{messages.length === 0 && widget.suggestedQuestions.length > 0 && (
					<div className="flex flex-col items-start gap-2">
						{widget.suggestedQuestions.map((question) => (
							<button
								key={question}
								type="button"
								onClick={() => submitText(question)}
								disabled={isAwaitingResponse}
								className="rounded-full border px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
								style={{ borderColor: accentColor, color: accentColor }}
							>
								{question}
							</button>
						))}
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
						) : getTextFromMessage(message) ? (
							<div className="flex flex-col items-start">
								<div className="bg-neutral-100 rounded-lg rounded-tl-none px-3 py-2 max-w-[85%] text-sm text-neutral-800">
									<div className="chat-md text-sm text-neutral-800 leading-relaxed">
										<Streamdown>{getTextFromMessage(message)}</Streamdown>
									</div>
								</div>
								<Sources
									sources={(message.metadata as { sources?: ChatSource[] })?.sources ?? []}
								/>
								{(message.metadata as { turnId?: string })?.turnId && (
									<FeedbackButtons
										key={(message.metadata as { turnId: string }).turnId}
										turnId={(message.metadata as { turnId: string }).turnId}
									/>
								)}
							</div>
						) : (
							// Assistant message exists (sources/metadata may have arrived) but no
							// text has streamed yet — keep showing a loading indicator instead of
							// an empty bubble, right up until the first text token renders.
							<div className="flex justify-start">
								<div className="bg-neutral-100 rounded-lg rounded-tl-none px-3 py-2 text-sm text-neutral-500">
									<div className="flex items-center gap-2">
										<div className="animate-spin text-neutral-400">
											<LoadingIcon />
										</div>
										<span>Generating...</span>
									</div>
								</div>
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

			<form onSubmit={handleSubmit} className="border-t border-neutral-200 p-3 flex gap-2 bg-white">
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

			<div className="px-3 pb-2 pt-0 text-center text-[10px] text-neutral-400 bg-white">
				Powered by United Way of Merced County · 211 Community Resources
			</div>
		</div>
	);
}
