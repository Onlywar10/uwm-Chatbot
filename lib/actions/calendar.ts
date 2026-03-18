import { env } from "../env.mjs";
import type { calendar_v3 } from "googleapis";

const googleCalendarApiUrl = env.GOOGLE_CALENDAR_API_URL;
const apiKey = env.GOOGLE_CALENDAR_API_KEY;

type CalendarEvent = {
	title: string;
	desc?: string;
	location?: string;
	date?: string;
	startTime?: string;
	endTime?: string;
	attachments: { url: string; content: string }[];
};

async function getCalendarEvents(id: string): Promise<calendar_v3.Schema$Event[] | undefined> {
	const now = new Date();
	const timeMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
	const timeMax = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

	const URL = `${googleCalendarApiUrl}${id}/events?key=${apiKey}&singleEvents=true&orderBy=startTime&timeMin=${timeMin}&timeMax=${timeMax}`;

	const response = await fetch(URL);
	const events = (await response.json()) as calendar_v3.Schema$Events;

	return events.items;
}

function convertToDateString(
	input: calendar_v3.Schema$EventDateTime | undefined,
): string | undefined {
	if (input) {
		let inputDate: string | null = null;

		if (input.date) {
			inputDate = input.date;
		} else if (input.dateTime) {
			inputDate = input.dateTime;
		}

		if (!inputDate) {
			return "";
		}

		const [year, month, day] = inputDate.split("T")[0].split("-").map(Number);
		return new Date(year, month - 1, day).toLocaleDateString("en", {
			weekday: "long",
			month: "long",
			day: "numeric",
			year: "numeric",
		});
	} else {
		return "";
	}
}

async function getEventDetails(event: calendar_v3.Schema$Event): Promise<CalendarEvent> {
	const title = event.summary?.trim() ?? "";

	const attachments: { url: string; content: string; title?: string }[] = [];
	const desc = event.description?.trim() ?? "";

	const location = event.location?.trim() ?? "";
	const date = convertToDateString(event.start);

	const startTime = event.start?.dateTime
		? new Date(event.start.dateTime).toLocaleTimeString("en", {
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			})
		: "";
	const endTime = event.end?.dateTime
		? new Date(event.end.dateTime).toLocaleTimeString("en", {
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			})
		: "";

	return {
		title,
		desc,
		location,
		date,
		startTime,
		endTime,
		attachments,
	};
}

function stripHtml(html: string | undefined): string {
	if (!html) return "";

	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function formatEventDetails(details: CalendarEvent): string {
	let formatted = "";

	let formattedEvent = "";

	formattedEvent += `An event titled ${details.title}`;
	if (details.date) {
		formattedEvent += ` is happening on ${details.date}${details.startTime && details.endTime ? ` from ${details.startTime} - ${details.endTime}` : ""}`;
	}
	if (details.location) formattedEvent += ` at ${details.location}`;
	if (details.desc) formattedEvent += ` where ${stripHtml(details.desc)}`;

	formatted += `${formattedEvent}.\n`;

	return formatted;
}

export function extractGoogleCalendarId(html: string): string | null {
	var calendarId: string | null = null;

	const match = html.match(/ccmsGCalendarInitializeCalendar\([^[]*\[([^\]]+)\]/);

	if (match) {
		const calendarData = match[1];

		const calendarIds = calendarData.matchAll(/googleCalendarId:\s*['"]([^'"]+)['"]/g);
		calendarIds.forEach((id) => {
			if (!id[1].includes("holiday")) {
				calendarId = id[1];
			}
		});
	}

	return calendarId;
}

export async function formatEventsforEmbedding(calendarId: string) {
	const currentMonth = new Date().toLocaleString("en", { month: "long", year: "numeric" });
	const events = await getCalendarEvents(calendarId);

	let content = "";

	content += `School Calendar for ${currentMonth}. These are upcoming events, meetings, holidays, and activities.\n`;

	if (events) {
		for (const event of events) {
			const details = await getEventDetails(event);
			content += `${formatEventDetails(details)}\n`;
		}
	}

	return content;
}
