"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitFeedback } from "@/lib/actions/feedback";
import { FEEDBACK_REASONS, type FeedbackReason } from "@/lib/types/feedback";
import { cn } from "@/lib/utils";

export function FeedbackButtons({ turnId }: { turnId: string }) {
	const [sentiment, setSentiment] = useState<"positive" | "negative" | null>(null);
	const [showReasons, setShowReasons] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	const handlePositive = async () => {
		if (submitting) return;
		setSubmitting(true);
		setShowReasons(false);
		setSentiment("positive");
		await submitFeedback({ chatTurnId: turnId, sentiment: "positive" });
		setSubmitting(false);
	};

	const handleNegative = () => {
		if (submitting) return;
		setShowReasons(true);
		setSentiment("negative");
	};

	const handleReasonSelect = async (reason: FeedbackReason) => {
		if (submitting) return;
		setSubmitting(true);
		await submitFeedback({ chatTurnId: turnId, sentiment: "negative", reason });
		setShowReasons(false);
		setSubmitting(false);
	};

	return (
		<div className="flex flex-col gap-2 mt-2">
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon-xs"
					onClick={handlePositive}
					disabled={submitting}
					className={cn(
						sentiment === "positive" && "text-green-500 dark:text-green-400",
					)}
				>
					<ThumbsUp className="size-3.5" />
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					onClick={handleNegative}
					disabled={submitting}
					className={cn(
						sentiment === "negative" && "text-red-500 dark:text-red-400",
					)}
				>
					<ThumbsDown className="size-3.5" />
				</Button>
			</div>

			{showReasons && (
				<div className="flex flex-wrap gap-1">
					{FEEDBACK_REASONS.map((r) => (
						<button
							key={r.value}
							type="button"
							onClick={() => handleReasonSelect(r.value)}
							disabled={submitting}
							className="px-2 py-1 text-xs rounded-full border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
						>
							{r.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
