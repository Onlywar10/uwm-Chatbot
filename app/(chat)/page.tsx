"use client";

import { FeedbackButtons } from "@/components/FeedbackButtons";
import { LoadingIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { type UIMessage, useChat } from "@ai-sdk/react";
import { AnimatePresence, motion } from "framer-motion";
import type React from "react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

function deriveDomainKey(urlStr: string): string {
	try {
		const url = new URL(urlStr);
		const segments = url.pathname.split("/").filter(Boolean);
		const prefix = segments.length > 0 ? `/${segments[0]}` : "";
		const host = url.hostname.toLowerCase();
		return prefix ? `${host}${prefix}` : host;
	} catch {
		return "";
	}
}

function getLastUserMessage(messages: UIMessage[]): UIMessage | undefined {
	return [...messages].reverse().find((message) => message.role === "user");
}

function getLastAssistantMessage(messages: UIMessage[]): UIMessage | undefined {
	return [...messages].reverse().find((message) => message.role === "assistant");
}

function getTextFromMessage(message?: UIMessage): string {
	if (!message) return "";
	return message.parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join(" ")
		.trim();
}

export default function Chat() {
	const isDev = process.env.NODE_ENV !== "production";
	const [devReferer, setDevReferer] = useState("");

	const { messages, status, sendMessage } = useChat({
		onError: () => {
			toast.error("You've been rate limited, please try again later!");
		},
	});

	const [input, setInput] = useState("");
	const [isExpanded, setIsExpanded] = useState(false);

	useEffect(() => {
		if (messages.length > 0) setIsExpanded(true);
	}, [messages]);

	useEffect(() => {
		if (!isDev) return;

		if (devReferer) {
			document.cookie = `dev_referer=${encodeURIComponent(devReferer)}; path=/`;
		} else {
			document.cookie = `dev_referer=; path=/`;
		}
	}, [devReferer, isDev]);

	const isAwaitingResponse = status === "submitted" || status === "streaming";
	const [showLoading, setShowLoading] = useState(isAwaitingResponse);

	useEffect(() => {
		if (isAwaitingResponse) {
			setShowLoading(true);
			return;
		}

		const timeout = setTimeout(() => setShowLoading(false), 120);
		return () => clearTimeout(timeout);
	}, [isAwaitingResponse]);

	const userQuery = getLastUserMessage(messages);
	const lastAssistantMessage = getLastAssistantMessage(messages);

	const domainKey = (() => {
		const src =
			isDev && devReferer ? devReferer : typeof window !== "undefined" ? window.location.href : "";
		return src ? deriveDomainKey(src) : "";
	})();

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const text = input.trim();
		if (!text) return;

		sendMessage({ text });
		setInput("");
	};

	return (
		<div className="flex justify-center items-start sm:pt-16 w-full px-4 md:px-0 py-4">
			<div className="flex flex-col items-center w-full max-w-125">
				<motion.div
					animate={{
						minHeight: isExpanded ? 200 : 0,
						padding: isExpanded ? 12 : 0,
					}}
					transition={{ type: "spring", bounce: 0.5 }}
					className={cn(
						"rounded-lg w-full",
						isExpanded ? "bg-neutral-200 dark:bg-neutral-800" : "bg-transparent",
					)}
				>
					<div className="flex flex-col w-full justify-between gap-2">
						{isDev && (
							<div className="flex flex-col gap-2 mb-2">
								<label
									htmlFor="devReferer"
									className="text-xs text-neutral-600 dark:text-neutral-400"
								>
									Dev referer URL (used only in development)
								</label>
								<Input
									id="devReferer"
									placeholder="https://staging.example.com/1152/"
									value={devReferer}
									onChange={(e) => setDevReferer(e.target.value)}
								/>
								{domainKey && (
									<div className="text-xs text-neutral-600 dark:text-neutral-400">
										Domain scope: <span className="font-mono">{domainKey}</span>
									</div>
								)}
							</div>
						)}

						<form onSubmit={handleSubmit} className="flex space-x-2">
							<Input
								className="bg-neutral-100 text-base w-full text-neutral-700 dark:bg-neutral-700 dark:placeholder:text-neutral-400 dark:text-neutral-300"
								minLength={3}
								required
								value={input}
								placeholder="Ask me anything."
								onChange={(event) => setInput(event.target.value)}
								disabled={isAwaitingResponse}
							/>
							<Button type="submit" disabled={isAwaitingResponse}>
								Submit
							</Button>
						</form>

						<motion.div transition={{ type: "spring" }} className="min-h-fit flex flex-col gap-2">
							<AnimatePresence>
								{showLoading ? (
									<div className="px-2 min-h-12">
										<div className="dark:text-neutral-400 text-neutral-500 text-sm w-fit mb-1">
											{getTextFromMessage(userQuery)}
										</div>
										<Loading />
									</div>
								) : lastAssistantMessage ? (
									<div className="px-2 min-h-12">
										<div className="dark:text-neutral-400 text-neutral-500 text-sm w-fit mb-1">
											{getTextFromMessage(userQuery)}
										</div>
										<AssistantMessage message={lastAssistantMessage} />
										{(lastAssistantMessage.metadata as { turnId?: string })
											?.turnId && (
											<FeedbackButtons
												key={
													(lastAssistantMessage.metadata as { turnId: string })
														.turnId
												}
												turnId={
													(lastAssistantMessage.metadata as { turnId: string })
														.turnId
												}
											/>
										)}
									</div>
								) : null}
							</AnimatePresence>
						</motion.div>
					</div>
				</motion.div>
			</div>
		</div>
	);
}

function AssistantMessage({ message }: { message?: UIMessage }) {
	if (!message) return null;

	const text = getTextFromMessage(message);

	return (
		<AnimatePresence mode="wait">
			<motion.div
				key={message.id}
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				className="whitespace-pre-wrap font-mono text-sm text-neutral-800 dark:text-neutral-200 overflow-hidden"
				id="markdown"
			>
				<ReactMarkdown>{text}</ReactMarkdown>
			</motion.div>
		</AnimatePresence>
	);
}

function Loading() {
	return (
		<AnimatePresence mode="wait">
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				transition={{ type: "spring" }}
				className="overflow-hidden flex justify-start items-center"
			>
				<div className="flex flex-row gap-2 items-center">
					<div className="animate-spin dark:text-neutral-400 text-neutral-500">
						<LoadingIcon />
					</div>
					<div className="text-neutral-500 dark:text-neutral-400 text-sm">Thinking.</div>
				</div>
			</motion.div>
		</AnimatePresence>
	);
}
