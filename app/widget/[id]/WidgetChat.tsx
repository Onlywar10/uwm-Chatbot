"use client";

import { FeedbackButtons } from "@/components/FeedbackButtons";
import { LoadingIcon } from "@/components/icons";
import { Sources } from "@/components/Sources";
import type { DirectorySearchResult } from "@/lib/directory/search";
import type { ChatSource } from "@/lib/types/chat";
import { type UIMessage, useChat } from "@ai-sdk/react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { CrisisCard } from "./CrisisCard";
import { ResourceCards, ResourceCardsSkeleton } from "./ResourceCards";
import { asksForLocation } from "@/lib/directory/locationAsk";

type WidgetConfig = {
	id: string;
	name: string;
	domains: string[];
	greeting: string | null;
	suggestedQuestions: string[];
	accentColor: string | null;
	widgetToken: string;
	enableResourceSearch: boolean;
};

function getTextFromMessage(message: UIMessage): string {
	return message.parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join(" ")
		.trim();
}

type MessageMeta = { turnId?: string; sources?: ChatSource[]; crisis?: boolean };

type SearchToolPart = {
	type: "tool-searchResources";
	state?: "input-streaming" | "input-available" | "output-available" | "output-error";
	output?: DirectorySearchResult | { error: string };
};

/**
 * The last searchResources tool part of a message — the one whose results the
 * model narrated. Earlier searches in the same multi-step turn stay hidden so
 * the user never sees two competing card sets.
 */
function getSearchPart(message: UIMessage): SearchToolPart | null {
	const parts = message.parts.filter((part) => part.type === "tool-searchResources");
	return (parts[parts.length - 1] as unknown as SearchToolPart | undefined) ?? null;
}

export default function WidgetChat({ widget }: { widget: WidgetConfig }) {
	const { messages, status, sendMessage } = useChat({
		onError: () => {
			toast.error("Something went wrong, please try again.");
		},
	});

	const [input, setInput] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);

	/**
	 * Shared location, held in memory for this conversation only.
	 *
	 * Never written to localStorage or a cookie: someone using a shared or family
	 * device should not leave their location behind for the next person, and this
	 * widget serves people for whom that matters a great deal. Closing the panel
	 * discards it.
	 */
	const [userLocation, setUserLocation] = useState<{
		latitude: number;
		longitude: number;
	} | null>(null);
	const [locationState, setLocationState] = useState<"idle" | "asking" | "on" | "denied">("idle");

	const isAwaitingResponse = status === "submitted" || status === "streaming";

	/**
	 * Should we offer to use the visitor's location?
	 *
	 * Two triggers, and the first one is the point: the moment the assistant asks
	 * "what city or zip are you in?", tapping the button ANSWERS that question, and
	 * it lands before the first search — so the very first set of cards is already
	 * distance-ranked instead of city-ranked.
	 *
	 * The tool-call trigger is the backstop, covering the case where the model
	 * searched without asking (someone who named their city up front) or phrased
	 * the question in a way the matcher missed.
	 *
	 * Irrelevant to someone asking about donation hours, so it stays hidden
	 * otherwise. Once shown it stays, since messages only accumulate.
	 */
	const isSeekingResources = useMemo(
		() =>
			messages.some(
				(m) =>
					m.parts.some((p) => p.type === "tool-searchResources") ||
					(m.role === "assistant" && asksForLocation(getTextFromMessage(m))),
			),
		[messages],
	);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages, status]);

	const submitText = (
		raw: string,
		// State updates are async, so the geolocation callback passes the coordinates
		// it just received rather than waiting a render for `userLocation` to settle.
		locationOverride?: { latitude: number; longitude: number },
	) => {
		const text = raw.trim();
		if (!text || isAwaitingResponse) return;

		const location = locationOverride ?? userLocation;
		sendMessage(
			{ text },
			{
				body: {
					widgetId: widget.id,
					widgetToken: widget.widgetToken,
					// Omitted entirely until the visitor opts in.
					...(location ? { userLocation: location } : {}),
				},
			},
		);
		setInput("");
	};

	const requestLocation = () => {
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			setLocationState("denied");
			toast.error("This browser can't share location.");
			return;
		}
		// Geolocation is only exposed in a secure context. That covers https and
		// localhost, but NOT a LAN address like http://192.168.x.x:3000 — which is
		// exactly how a dev server gets opened on a phone, and how this fails with no
		// permission prompt at all.
		if (typeof window !== "undefined" && window.isSecureContext === false) {
			setLocationState("denied");
			toast.error("Location needs a secure (https) connection.");
			return;
		}
		setLocationState("asking");
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				const coords = {
					latitude: pos.coords.latitude,
					longitude: pos.coords.longitude,
				};
				setUserLocation(coords);
				setLocationState("on");
				// Re-run the search straight away. Granting permission and then seeing
				// nothing change is a dead end — the button promises closer options, so
				// it should deliver them rather than waiting for the next question.
				if (!isAwaitingResponse) {
					submitText("Use my current location to find the closest options.", coords);
				}
			},
			(err) => {
				// These three fail for genuinely different reasons and only one of them
				// is worth retrying, so they get different copy. A Permissions-Policy
				// block (embedding page missing allow="geolocation") also surfaces as
				// PERMISSION_DENIED, with no prompt ever shown to the visitor.
				const message =
					err.code === err.PERMISSION_DENIED
						? "Location is blocked for this page — you can type your city instead."
						: err.code === err.POSITION_UNAVAILABLE
							? "Your device couldn't determine a location — type your city instead."
							: err.code === err.TIMEOUT
								? "That took too long. Try again, or type your city."
								: "Couldn't get your location — you can type your city instead.";

				// Surfaced in the console because the three causes are indistinguishable
				// from the UI, and one of them (Permissions-Policy) is a deployment
				// problem on the embedding site rather than anything the visitor did.
				if (process.env.NODE_ENV !== "production") {
					console.warn(`[widget] geolocation failed: code=${err.code} ${err.message}`);
				}

				// A timeout is transient, so leave the button offering another attempt
				// rather than parking it in the terminal "unavailable" state.
				setLocationState(err.code === err.TIMEOUT ? "idle" : "denied");
				toast.error(message);
			},
			// High accuracy is off on purpose: a rooftop-accurate fix is unnecessary for
			// ranking by miles, and it is slower and more battery-hungry. The timeout is
			// generous because desktop browsers fall back to network geolocation, which
			// is considerably slower than a phone's GPS.
			{ enableHighAccuracy: false, timeout: 20_000, maximumAge: 300_000 },
		);
	};

	const clearLocation = () => {
		setUserLocation(null);
		setLocationState("idle");
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

				{messages.map((message, index) => {
					// Cards are held back until the reply has finished streaming. The tool
					// resolves early in the turn, so rendering on tool completion dropped
					// three cards in while the model was still explaining them — the user
					// read an explanation for options that had already appeared above it.
					const isStreamingThisMessage =
						index === messages.length - 1 &&
						(status === "streaming" || status === "submitted");

					if (message.role === "user") {
						return (
							<div key={message.id} className="flex justify-end">
								<div
									className="rounded-lg rounded-tr-none px-3 py-2 max-w-[85%] text-sm text-white"
									style={{ backgroundColor: accentColor }}
								>
									{getTextFromMessage(message)}
								</div>
							</div>
						);
					}

					const text = getTextFromMessage(message);
					const meta = message.metadata as MessageMeta | undefined;
					const searchPart = getSearchPart(message);
					const searchResult =
						searchPart?.state === "output-available" &&
						searchPart.output &&
						!("error" in searchPart.output)
							? searchPart.output
							: null;
					const searchPending =
						searchPart != null &&
						searchPart.state !== "output-available" &&
						searchPart.state !== "output-error";

					if (!text && !meta?.crisis && !searchPart) {
						// Assistant message exists (sources/metadata may have arrived) but no
						// text has streamed yet — keep showing a loading indicator instead of
						// an empty bubble, right up until the first text token renders.
						return (
							<div key={message.id} className="flex justify-start">
								<div className="bg-neutral-100 rounded-lg rounded-tl-none px-3 py-2 text-sm text-neutral-500">
									<div className="flex items-center gap-2">
										<div className="animate-spin text-neutral-400">
											<LoadingIcon />
										</div>
										<span>Generating...</span>
									</div>
								</div>
							</div>
						);
					}

					return (
						<div key={message.id} className="flex flex-col items-start">
							{meta?.crisis && <CrisisCard />}
							{text && (
								<div className="bg-neutral-100 rounded-lg rounded-tl-none px-3 py-2 max-w-[85%] text-sm text-neutral-800">
									<div className="chat-md text-sm text-neutral-800 leading-relaxed">
										<Streamdown>{text}</Streamdown>
									</div>
								</div>
							)}
							{/* Skeleton covers both the tool running AND the reply streaming, so
							    the space is reserved and the cards don't shift the text when
							    they land. */}
							{(searchPending || (searchResult && isStreamingThisMessage)) && (
								<ResourceCardsSkeleton />
							)}
							{searchResult && !isStreamingThisMessage && (
								<ResourceCards
									result={searchResult}
									accentColor={accentColor}
									onShowMore={() => submitText("Show me more options")}
									disabled={isAwaitingResponse}
								/>
							)}
							<Sources sources={meta?.sources ?? []} />
							{meta?.turnId && <FeedbackButtons key={meta.turnId} turnId={meta.turnId} />}
						</div>
					);
				})}

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

			{/* Location sharing. Referral-enabled widgets only (a school district Q&A bot
			    has no use for it), AND only once the conversation has actually reached
			    for the directory — asking someone for their location before they've
			    asked for help reads as surveillance, not service. */}
			{widget.enableResourceSearch && isSeekingResources && (
				<div className="border-t border-neutral-200 bg-white px-3 pt-2">
					{locationState === "on" ? (
						<div className="flex items-center gap-2 text-xs text-neutral-600">
							<span className="font-medium text-emerald-700">● Using your location</span>
							<span className="text-neutral-400">to show the closest options</span>
							<button
								type="button"
								onClick={clearLocation}
								className="ml-auto rounded px-1.5 py-0.5 text-neutral-500 underline hover:bg-neutral-100"
							>
								Stop
							</button>
						</div>
					) : (
						<button
							type="button"
							onClick={requestLocation}
							disabled={locationState === "asking"}
							className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-2.5 py-1.5 text-left text-xs text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-60"
						>
							<span aria-hidden>📍</span>
							{locationState === "asking"
								? "Waiting for permission…"
								: locationState === "denied"
									? "Location unavailable — type your city instead"
									: "Use my location to find the closest help"}
						</button>
					)}
				</div>
			)}

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
