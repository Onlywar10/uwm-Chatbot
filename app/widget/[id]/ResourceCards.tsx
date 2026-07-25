"use client";

import { useState } from "react";
import type { DirectoryHours } from "@/lib/db/schema/directoryPrograms";
import type { DirectoryMatch, DirectorySearchResult } from "@/lib/directory/search";

/**
 * Referral result cards rendered from a `tool-searchResources` output part.
 *
 * Cards own the facts (phones, addresses, hours) — the model's text is instructed
 * never to restate them, so what the user taps is always verbatim directory data,
 * never LLM-transcribed.
 *
 * Design: collapsed cards carry only what someone needs to choose between options —
 * name, who runs it, how close it is, whether it is open, and one tap to call.
 * Everything else (eligibility, documents, fees, full hours, application process)
 * lives behind an expansion, because in a 400px-wide panel a wall of detail on three
 * cards is what made the previous version hard to scan.
 */

// ---- Hours ("8am", "8:30am", "10:00 am" …) ----

function parseTime(raw: string | undefined): number | null {
	if (!raw) return null;
	const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
	if (!m) return null;
	let h = Number(m[1]) % 12;
	if (m[3].toLowerCase() === "pm") h += 12;
	return h * 60 + Number(m[2] ?? 0);
}

const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type OpenState = { label: string; tone: "open" | "closed" | "neutral" };

function hoursToday(hours: DirectoryHours | null): OpenState | null {
	if (!hours) return null;
	if (hours.days.length === 0) {
		return hours.note
			? { label: hours.note.split(/\r?\n/)[0].slice(0, 60), tone: "neutral" }
			: null;
	}
	const now = new Date();
	const todayKey = DAY_KEYS[now.getDay()];
	const today = hours.days.find((d) => d.dayOfWeek === todayKey);
	const minutes = now.getHours() * 60 + now.getMinutes();

	if (today) {
		const opens = parseTime(today.opens);
		const closes = parseTime(today.closes);
		if (opens !== null && closes !== null) {
			if (minutes >= opens && minutes < closes) {
				return { label: `Open until ${today.closes}`, tone: "open" };
			}
			if (minutes < opens) return { label: `Opens ${today.opens} today`, tone: "closed" };
		} else {
			return { label: `Today ${today.opens ?? "?"}–${today.closes ?? "?"}`, tone: "neutral" };
		}
	}
	for (let i = 1; i <= 7; i++) {
		const key = DAY_KEYS[(now.getDay() + i) % 7];
		const day = hours.days.find((d) => d.dayOfWeek === key);
		if (day?.opens) return { label: `Opens ${key} ${day.opens}`, tone: "closed" };
	}
	return null;
}

function fullHours(hours: DirectoryHours | null): string[] {
	if (!hours) return [];
	const lines = hours.days
		.filter((d) => d.opens || d.closes)
		.map((d) => `${d.dayOfWeek}: ${d.opens ?? "?"} – ${d.closes ?? "?"}`);
	if (hours.note) lines.push(hours.note);
	return lines;
}

// ---- Location + address ----

/**
 * Short, human phrasing of why this result is location-appropriate. Uses the
 * locality tier the ranker already computed, so the card explains the same signal
 * that decided the ordering.
 */
function localityLabel(match: DirectoryMatch): string | null {
	const city = match.address?.city;
	switch (match.locality) {
		case "in_city":
			return city ? `In ${city}` : "In your city";
		case "covers_city":
			return "Serves your area";
		case "in_county":
			return city ? `In ${city}` : "Serves your county";
		case "statewide":
			return "Statewide program";
		case "remote":
			return city ? `Based in ${city}` : "Outside the area";
		default:
			return city ?? null;
	}
}

function addressLine(match: DirectoryMatch): string | null {
	const a = match.address;
	if (!a) return null;
	const street = [a.line1, a.line2].filter(Boolean).join(", ");
	const cityState = [a.city, a.stateProvince, a.zipPostalCode].filter(Boolean).join(" ");
	return [street, cityState].filter(Boolean).join(", ") || null;
}

function mapsUrl(address: string): string {
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function formatVerified(iso: string | null): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return `Verified ${d.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<span className="font-medium text-neutral-800">{label}</span>{" "}
			<span className="text-neutral-600">{value}</span>
		</div>
	);
}

// ---- Cards ----

function ResourceCard({ match, accentColor }: { match: DirectoryMatch; accentColor: string }) {
	const [open, setOpen] = useState(false);
	const phone = match.phones[0];
	const address = addressLine(match);
	const openState = hoursToday(match.hours);
	const place = localityLabel(match);
	const hourLines = fullHours(match.hours);
	const verified = formatVerified(match.lastVerifiedOn);
	const panelId = `resource-detail-${match.id}`;

	const hasDetail =
		match.description ||
		address ||
		match.eligibility ||
		match.fees ||
		match.requiredDocumentation ||
		match.applicationProcess ||
		match.languages ||
		match.phones.length > 1 ||
		hourLines.length > 0;

	return (
		<div className="w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
			<div className="p-3">
				<div className="text-[15px] leading-snug font-semibold text-neutral-900">
					{match.programName}
				</div>

				<div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-neutral-500">
					{match.agencyName && <span className="truncate">{match.agencyName}</span>}
					{match.agencyName && place && <span aria-hidden>·</span>}
					{place && <span>{place}</span>}
				</div>

				{(openState || match.otherLocations > 0) && (
					<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
						{openState && (
							<span
								className={
									openState.tone === "open"
										? "font-medium text-emerald-700"
										: openState.tone === "closed"
											? "text-neutral-500"
											: "text-neutral-600"
								}
							>
								{openState.tone === "open" ? "● " : ""}
								{openState.label}
							</span>
						)}
						{match.otherLocations > 0 && (
							<span className="text-neutral-500">
								+{match.otherLocations} other location{match.otherLocations > 1 ? "s" : ""}
							</span>
						)}
					</div>
				)}

				<div className="mt-2.5 flex items-center gap-2">
					{phone ? (
						<a
							href={`tel:${phone.number.replace(/[^\d+]/g, "")}`}
							className="rounded-lg px-3 py-2 text-xs font-semibold text-white"
							style={{ backgroundColor: accentColor }}
						>
							Call {phone.number}
						</a>
					) : (
						match.website && (
							<a
								href={match.website}
								target="_blank"
								rel="noopener noreferrer"
								className="rounded-lg px-3 py-2 text-xs font-semibold text-white"
								style={{ backgroundColor: accentColor }}
							>
								Visit website
							</a>
						)
					)}
					{hasDetail && (
						<button
							type="button"
							onClick={() => setOpen((v) => !v)}
							aria-expanded={open}
							aria-controls={panelId}
							className="ml-auto rounded-lg px-2 py-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100"
						>
							{open ? "Less" : "Details"}
							<span aria-hidden className="ml-1 inline-block">
								{open ? "▲" : "▼"}
							</span>
						</button>
					)}
				</div>

				{!address && match.addressIsPrivate && (
					<p className="mt-1.5 text-xs text-neutral-500">
						Location not published — call to confirm.
					</p>
				)}
			</div>

			{open && (
				<div
					id={panelId}
					className="space-y-2 border-t border-neutral-150 bg-neutral-50 px-3 py-2.5 text-xs"
				>
					{match.description && <p className="text-neutral-700">{match.description}</p>}

					{address && (
						<div className="text-neutral-700">
							{address}
							<a
								href={mapsUrl(address)}
								target="_blank"
								rel="noopener noreferrer"
								className="ml-1.5 font-medium underline"
								style={{ color: accentColor }}
							>
								Directions
							</a>
						</div>
					)}

					{match.eligibility && <DetailRow label="Who qualifies:" value={match.eligibility} />}
					{match.requiredDocumentation && (
						<DetailRow label="Bring:" value={match.requiredDocumentation} />
					)}
					{match.applicationProcess && (
						<DetailRow label="How to apply:" value={match.applicationProcess} />
					)}
					{match.fees && <DetailRow label="Cost:" value={match.fees} />}
					{match.languages && <DetailRow label="Languages:" value={match.languages} />}
					{match.coverageDisplay && <DetailRow label="Area served:" value={match.coverageDisplay} />}

					{match.phones.length > 1 && (
						<div>
							<span className="font-medium text-neutral-800">Other numbers</span>
							{match.phones.slice(1).map((p) => (
								<div key={p.number} className="text-neutral-600">
									{p.label}:{" "}
									<a
										className="underline"
										href={`tel:${p.number.replace(/[^\d+]/g, "")}`}
										style={{ color: accentColor }}
									>
										{p.number}
									</a>
									{p.description ? ` — ${p.description}` : ""}
								</div>
							))}
						</div>
					)}

					{hourLines.length > 0 && (
						<div>
							<span className="font-medium text-neutral-800">Hours</span>
							{hourLines.map((line) => (
								<div key={line} className="text-neutral-600">
									{line}
								</div>
							))}
						</div>
					)}

					<div className="flex flex-wrap items-center gap-x-3 pt-0.5 text-neutral-400">
						{match.website && phone && (
							<a
								href={match.website}
								target="_blank"
								rel="noopener noreferrer"
								className="underline"
								style={{ color: accentColor }}
							>
								Website
							</a>
						)}
						{verified && <span>{verified}</span>}
					</div>
				</div>
			)}
		</div>
	);
}

/** Hardcoded fallback when the search found nothing good — never model-generated. */
function Call211Card() {
	return (
		<div className="w-full rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
			<div className="font-semibold text-neutral-900">Talk to a 211 specialist</div>
			<p className="mt-0.5 text-xs text-neutral-600">
				A live person can search beyond this chat, day or night, in your language.
			</p>
			<a
				href="tel:211"
				className="mt-2 inline-block rounded-lg bg-neutral-800 px-3 py-2 text-xs font-semibold text-white"
			>
				Dial 2-1-1
			</a>
		</div>
	);
}

export function ResourceCardsSkeleton() {
	return (
		<output className="mt-2 block w-full space-y-2" aria-label="Searching resources">
			{[0, 1].map((i) => (
				<div key={i} className="w-full animate-pulse rounded-xl border border-neutral-200 p-3">
					<div className="h-3.5 w-2/3 rounded bg-neutral-200" />
					<div className="mt-2 h-3 w-1/3 rounded bg-neutral-100" />
					<div className="mt-3 h-8 w-28 rounded-lg bg-neutral-200" />
				</div>
			))}
		</output>
	);
}

export function ResourceCards({
	result,
	accentColor,
	onShowMore,
	disabled,
}: {
	result: DirectorySearchResult;
	accentColor: string;
	onShowMore: () => void;
	disabled: boolean;
}) {
	if (result.noGoodMatch) return <Call211Card />;
	if (result.matches.length === 0) return null;

	return (
		<div className="mt-2 w-full space-y-2">
			{result.matches.map((match) => (
				<ResourceCard key={match.id} match={match} accentColor={accentColor} />
			))}
			{result.moreCount > 0 && (
				<button
					type="button"
					onClick={onShowMore}
					disabled={disabled}
					className="w-full rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Show more options
				</button>
			)}
		</div>
	);
}
