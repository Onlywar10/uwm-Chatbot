"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import type React from "react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { type AnalyticsPayload, EvidenceStrip } from "@/components/EvidenceStrip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SUGGESTIONS = [
	"How many people called last month?",
	"Top referred-to agencies for food pantries in the last 3 months",
	"How many calls needed language assistance?",
];

function MessageView({ message }: { message: UIMessage }) {
	const isUser = message.role === "user";
	return (
		<div className={isUser ? "flex justify-end" : "flex justify-start"}>
			<div
				className={
					isUser
						? "max-w-[80%] rounded-lg bg-neutral-200 dark:bg-neutral-700 px-3 py-2 text-sm text-neutral-800 dark:text-neutral-100"
						: "max-w-[90%] text-sm text-neutral-800 dark:text-neutral-200"
				}
			>
				{message.parts.map((part, i) => {
					if (part.type === "text") {
						return (
							<div key={`${message.id}-t${i}`} className="prose-sm whitespace-pre-wrap">
								<ReactMarkdown>{part.text}</ReactMarkdown>
							</div>
						);
					}
					const p = part as { type: string; state?: string; output?: unknown };
					if (p.type.startsWith("tool-") && p.output) {
						return (
							<EvidenceStrip key={`${message.id}-e${i}`} data={p.output as AnalyticsPayload} />
						);
					}
					return null;
				})}
			</div>
		</div>
	);
}

export default function AnalyticsChat() {
	const { messages, status, sendMessage } = useChat({
		transport: new DefaultChatTransport({ api: "/api/analytics" }),
		onError: () => toast.error("Something went wrong. Please try again."),
	});
	const [input, setInput] = useState("");
	const busy = status === "submitted" || status === "streaming";

	const submit = (text: string) => {
		const trimmed = text.trim();
		if (!trimmed) return;
		sendMessage({ text: trimmed });
		setInput("");
	};

	return (
		<main className="min-h-screen flex flex-col dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300">
			<div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
				<h1 className="text-2xl font-semibold mb-1 text-neutral-800 dark:text-neutral-100">
					211 Analytics
				</h1>
				<p className="mb-6 text-sm">Ask questions about 211 caller data. Internal use only.</p>

				<div className="flex-1 space-y-4">
					{messages.length === 0 && (
						<div className="flex flex-col gap-2">
							{SUGGESTIONS.map((s) => (
								<button
									type="button"
									key={s}
									onClick={() => submit(s)}
									className="text-left text-sm underline text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
								>
									{s}
								</button>
							))}
						</div>
					)}
					{messages.map((m) => (
						<MessageView key={m.id} message={m} />
					))}
					{busy && <div className="text-sm text-neutral-500 dark:text-neutral-400">Thinking…</div>}
				</div>

				<form
					onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
						e.preventDefault();
						submit(input);
					}}
					className="sticky bottom-4 mt-6 flex gap-2"
				>
					<Input
						className="bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-100"
						value={input}
						placeholder="Ask about calls, needs, or referrals…"
						onChange={(e) => setInput(e.target.value)}
						disabled={busy}
					/>
					<Button type="submit" disabled={busy}>
						Ask
					</Button>
				</form>
			</div>
		</main>
	);
}
