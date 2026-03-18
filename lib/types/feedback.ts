export type FeedbackSentiment = "positive" | "negative";

export const FEEDBACK_REASONS = [
	{ value: "incorrect-information", label: "Incorrect information" },
	{ value: "not-relevant", label: "Not relevant to my question" },
	{ value: "too-vague", label: "Too vague" },
	{ value: "missing-information", label: "Missing information" },
	{ value: "other", label: "Other" },
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]["value"];

export type ChatFeedback = {
	id: string;
	chatTurnId: string;
	sentiment: FeedbackSentiment;
	reason: FeedbackReason | null;
	createdAt: Date;
};

export type FeedbackFilters = {
	domain?: string;
	from?: string;
	to?: string;
};

export type FeedbackWithTurn = ChatFeedback & {
	domain: string;
	userMessage: string;
	response: string;
};

export type FeedbackStats = {
	total: number;
	positive: number;
	negative: number;
	reasonBreakdown: { reason: string; count: number }[];
};
