"use client";

import { FeedbackButtons } from "@/components/FeedbackButtons";
import { Sources } from "@/components/Sources";
import type { DirectorySearchResult } from "@/lib/directory/search";
import type { ChatSource } from "@/lib/types/chat";
import { type UIMessage, useChat } from "@ai-sdk/react";
import { ArrowUp, MapPin } from "lucide-react";
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

/**
 * Sample questions shown on the welcome screen when the widget row has none
 * configured. One per thing the bot can actually do: search the 211 directory,
 * answer from the crawled sites (free tax help), and explain the organisation.
 */
const DEFAULT_SUGGESTIONS = [
	"I need help with food, rent, or utilities",
	"Where can I get my taxes done for free?",
	"What does United Way of Merced do?",
];

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

function TypingBubble({ label }: { label: string }) {
	return (
		<div className="wc-rise flex justify-start">
			<output aria-label={label} className="wc-bubble-bot flex items-center gap-1.5 px-3.5 py-3">
				<span className="wc-dot" />
				<span className="wc-dot" />
				<span className="wc-dot" />
			</output>
		</div>
	);
}

export default function WidgetChat({ widget }: { widget: WidgetConfig }) {
	const { messages, status, sendMessage } = useChat({
		onError: () => {
			toast.error("Something went wrong, please try again.");
		},
	});

	const [input, setInput] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

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

	/**
	 * A sample question fills the box rather than sending straight away, so the
	 * visitor can add their city or a detail ("...in Atwater") before it goes.
	 */
	const fillWithSuggestion = (question: string) => {
		setInput(question);
		inputRef.current?.focus();
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
	const suggestions =
		widget.suggestedQuestions.length > 0 ? widget.suggestedQuestions : DEFAULT_SUGGESTIONS;
	const canSend = input.trim().length >= 3 && !isAwaitingResponse;

	return (
		<div
			className="wc-root flex h-full flex-col"
			style={{ "--wc-accent": accentColor } as React.CSSProperties}
		>
			<div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-3">
				{messages.length === 0 ? (
					<div className="flex min-h-full flex-col justify-end gap-5">
						{/* Welcome */}
						<div className="wc-rise">
							<h1 className="text-[21px] font-bold leading-tight tracking-[-0.02em] text-[var(--wc-ink)]">
								Hi there, how can we help?
							</h1>
							<p className="mt-1.5 max-w-[34ch] text-[14px] leading-relaxed text-[var(--wc-ink-2)]">
								{widget.greeting ||
									"Ask about local resources, free tax help, or what United Way of Merced does."}
							</p>
						</div>

						{/* Sample questions: tap one to fill the box below. */}
						<div className="wc-rise wc-rise-1">
							<div className="mb-1.5 px-0.5 text-[12px] font-medium text-[var(--wc-ink-2)]">
								Try asking
							</div>
							<ul className="wc-suggest-list">
								{suggestions.map((question) => (
									<li key={question}>
										<button
											type="button"
											onClick={() => fillWithSuggestion(question)}
											disabled={isAwaitingResponse}
											className="wc-suggest"
										>
											{question}
										</button>
									</li>
								))}
							</ul>
						</div>
					</div>
				) : (
					<div className="space-y-3">
						{messages.map((message, index) => {
							// Cards are held back until the reply has finished streaming. The
							// tool resolves early in the turn, so rendering on tool completion
							// dropped three cards in while the model was still explaining them —
							// the user read an explanation for options that had already
							// appeared above it.
							const isStreamingThisMessage =
								index === messages.length - 1 && (status === "streaming" || status === "submitted");

							if (message.role === "user") {
								return (
									<div key={message.id} className="wc-rise flex justify-end">
										<div className="wc-bubble-user max-w-[85%] px-3.5 py-2.5 text-[14px] leading-relaxed">
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
								// Assistant message exists (sources/metadata may have arrived)
								// but no text has streamed yet — keep showing the typing
								// indicator instead of an empty bubble, right up until the
								// first text token renders.
								return <TypingBubble key={message.id} label="Generating reply" />;
							}

							return (
								<div key={message.id} className="wc-rise flex flex-col items-start">
									{meta?.crisis && <CrisisCard />}
									{text && (
										<div className="wc-bubble-bot max-w-[88%] px-3.5 py-2.5">
											<div className="chat-md text-[14px] leading-relaxed">
												<Streamdown>{text}</Streamdown>
											</div>
										</div>
									)}
									{/* Skeleton covers both the tool running AND the reply
									    streaming, so the space is reserved and the cards don't
									    shift the text when they land. */}
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
							<TypingBubble label="Thinking" />
						)}
					</div>
				)}
			</div>

			{/* Location sharing. Referral-enabled widgets only (a school district Q&A bot
			    has no use for it), AND only once the conversation has actually reached
			    for the directory — asking someone for their location before they've
			    asked for help reads as surveillance, not service. */}
			{widget.enableResourceSearch && isSeekingResources && (
				<div className="px-3 pt-1">
					{locationState === "on" ? (
						<div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
							<MapPin size={13} aria-hidden />
							<span className="font-medium">Using your location</span>
							<span className="text-emerald-700/70">for the closest options</span>
							<button
								type="button"
								onClick={clearLocation}
								className="ml-auto rounded-md px-1.5 py-0.5 font-medium text-emerald-900 underline underline-offset-2 hover:bg-emerald-100"
							>
								Stop
							</button>
						</div>
					) : (
						<button
							type="button"
							onClick={requestLocation}
							disabled={locationState === "asking"}
							className="wc-chip"
						>
							<MapPin size={14} aria-hidden />
							{locationState === "asking"
								? "Waiting for permission…"
								: locationState === "denied"
									? "Location unavailable — type your city instead"
									: "Use my location to find the closest help"}
						</button>
					)}
				</div>
			)}

			<form onSubmit={handleSubmit} className="wc-composer-wrap">
				<label htmlFor="wc-input" className="sr-only">
					Your message
				</label>
				<div className="wc-composer">
					<input
						id="wc-input"
						ref={inputRef}
						minLength={3}
						required
						value={input}
						placeholder="Type your question…"
						onChange={(e) => setInput(e.target.value)}
						disabled={isAwaitingResponse}
					/>
					<button type="submit" disabled={!canSend} className="wc-send">
						<span>Send</span>
						<ArrowUp size={15} strokeWidth={2.5} aria-hidden />
					</button>
				</div>
			</form>

			<div className="px-3 pb-2 pt-1.5 text-center text-[10.5px] text-neutral-500">
				Powered by United Way of Merced County · 211 Community Resources
			</div>
		</div>
	);
}
