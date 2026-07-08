"use client";

import type { DirectoryHours } from "@/lib/db/schema/directoryPrograms";
import type { DirectoryMatch, DirectorySearchResult } from "@/lib/directory/search";

/**
 * Referral result cards rendered from a `tool-searchResources` output part.
 * Cards own the facts (phones, addresses, hours) — the model's text is
 * instructed never to restate them, so what the user taps is always verbatim
 * directory data, never LLM-transcribed.
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

function hoursToday(hours: DirectoryHours | null): string | null {
	if (!hours) return null;
	if (hours.days.length === 0) {
		return hours.note ? hours.note.split(/\r?\n/)[0].slice(0, 80) : null;
	}
	const now = new Date();
	const todayKey = DAY_KEYS[now.getDay()];
	const today = hours.days.find((d) => d.dayOfWeek === todayKey);
	const minutes = now.getHours() * 60 + now.getMinutes();

	if (today) {
		const opens = parseTime(today.opens);
		const closes = parseTime(today.closes);
		if (opens !== null && closes !== null) {
			if (minutes >= opens && minutes < closes) return `Open now · until ${today.closes}`;
			if (minutes < opens) return `Closed · opens ${today.opens} today`;
		} else {
			return `Today: ${today.opens ?? "?"} – ${today.closes ?? "?"}`;
		}
	}
	// Closed today (or already closed): find the next listed day.
	for (let i = 1; i <= 7; i++) {
		const key = DAY_KEYS[(now.getDay() + i) % 7];
		const day = hours.days.find((d) => d.dayOfWeek === key);
		if (day?.opens) return `Closed · opens ${key} ${day.opens}`;
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

// ---- Address helpers ----

function addressLine(match: DirectoryMatch): string | null {
	const a = match.address;
	if (!a) return null;
	const street = [a.line1, a.line2].filter(Boolean).join(", ");
	const cityState = [a.city, a.stateProvince, a.zipPostalCode].filter(Boolean).join(" ");
	const full = [street, cityState].filter(Boolean).join(", ");
	return full || null;
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

// ---- Cards ----

function ResourceCard({ match, accentColor }: { match: DirectoryMatch; accentColor: string }) {
	const phone = match.phones[0];
	const address = addressLine(match);
	const openLine = hoursToday(match.hours);
	const verified = formatVerified(match.lastVerifiedOn);
	const hourLines = fullHours(match.hours);

	return (
		<div className="w-full rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-sm">
			<div className="font-medium text-neutral-900">{match.programName}</div>
			{match.agencyName && <div className="text-xs text-neutral-500">{match.agencyName}</div>}

			<div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-neutral-600">
				{match.coverageDisplay && <span>{match.coverageDisplay}</span>}
				{match.otherLocations > 0 && (
					<span>
						+{match.otherLocations} other location{match.otherLocations > 1 ? "s" : ""}
					</span>
				)}
			</div>
			{openLine && <div className="mt-1 text-xs text-neutral-700">⏰ {openLine}</div>}

			<div className="mt-2 flex flex-wrap gap-2">
				{phone && (
					<a
						href={`tel:${phone.number.replace(/[^\d+]/g, "")}`}
						className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
						style={{ backgroundColor: accentColor }}
					>
						📞 Call {phone.number}
					</a>
				)}
				{match.website && (
					<a
						href={match.website}
						target="_blank"
						rel="noopener noreferrer"
						className="rounded-md border px-3 py-1.5 text-xs font-medium"
						style={{ borderColor: accentColor, color: accentColor }}
					>
						Website
					</a>
				)}
				{address && (
					<a
						href={mapsUrl(address)}
						target="_blank"
						rel="noopener noreferrer"
						className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700"
					>
						Directions
					</a>
				)}
			</div>

			{!address && (
				<div className="mt-1.5 text-xs text-neutral-500">
					{match.addressIsPrivate ? "Location not published — call to confirm." : null}
				</div>
			)}

			<details className="mt-2">
				<summary className="cursor-pointer text-xs text-neutral-500 select-none">
					More details
				</summary>
				<div className="mt-1.5 space-y-1.5 text-xs text-neutral-700">
					{match.description && <p>{match.description}</p>}
					{address && <p>📍 {address}</p>}
					{match.eligibility && (
						<p>
							<span className="font-medium">Eligibility:</span> {match.eligibility}
						</p>
					)}
					{match.fees && (
						<p>
							<span className="font-medium">Fees:</span> {match.fees}
						</p>
					)}
					{match.requiredDocumentation && (
						<p>
							<span className="font-medium">Bring:</span> {match.requiredDocumentation}
						</p>
					)}
					{match.applicationProcess && (
						<p>
							<span className="font-medium">How to apply:</span> {match.applicationProcess}
						</p>
					)}
					{match.languages && (
						<p>
							<span className="font-medium">Languages:</span> {match.languages}
						</p>
					)}
					{match.phones.length > 1 && (
						<div>
							{match.phones.slice(1).map((p) => (
								<p key={p.number}>
									{p.label}:{" "}
									<a className="underline" href={`tel:${p.number.replace(/[^\d+]/g, "")}`}>
										{p.number}
									</a>
									{p.description ? ` — ${p.description}` : ""}
								</p>
							))}
						</div>
					)}
					{hourLines.length > 0 && (
						<div>
							<span className="font-medium">Hours:</span>
							{hourLines.map((line) => (
								<div key={line}>{line}</div>
							))}
						</div>
					)}
					{verified && <p className="text-neutral-400">{verified}</p>}
				</div>
			</details>
		</div>
	);
}

/** Hardcoded fallback when the search found nothing good — never model-generated. */
function Call211Card() {
	return (
		<div className="w-full rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
			<div className="font-medium text-neutral-900">Talk to a 211 specialist</div>
			<p className="mt-0.5 text-xs text-neutral-600">
				A live person can search beyond this chat, day or night, in your language.
			</p>
			<a
				href="tel:211"
				className="mt-2 inline-block rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white"
			>
				📞 Dial 2-1-1
			</a>
		</div>
	);
}

export function ResourceCardsSkeleton() {
	return (
		<output className="mt-2 block w-full space-y-2" aria-label="Searching resources">
			{[0, 1].map((i) => (
				<div key={i} className="w-full animate-pulse rounded-lg border border-neutral-200 p-3">
					<div className="h-3.5 w-2/3 rounded bg-neutral-200" />
					<div className="mt-2 h-3 w-1/3 rounded bg-neutral-100" />
					<div className="mt-3 h-6 w-24 rounded bg-neutral-200" />
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
					className="w-full rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Show more options ({result.moreCount})
				</button>
			)}
		</div>
	);
}
