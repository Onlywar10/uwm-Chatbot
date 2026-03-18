CREATE TYPE "public"."feedback_reason" AS ENUM('incorrect-information', 'not-relevant', 'too-vague', 'missing-information', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_sentiment" AS ENUM('positive', 'negative');--> statement-breakpoint
CREATE TABLE "chat_feedback" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"chat_turn_id" varchar(191) NOT NULL,
	"sentiment" "feedback_sentiment" NOT NULL,
	"reason" "feedback_reason",
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_chat_turn_id_chat_turns_id_fk" FOREIGN KEY ("chat_turn_id") REFERENCES "public"."chat_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_feedback_turn_idx" ON "chat_feedback" USING btree ("chat_turn_id");--> statement-breakpoint
CREATE INDEX "chat_feedback_sentiment_idx" ON "chat_feedback" USING btree ("sentiment");--> statement-breakpoint
CREATE INDEX "chat_feedback_created_idx" ON "chat_feedback" USING btree ("created_at");