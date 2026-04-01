CREATE TABLE "crawl_jobs" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"url" varchar(255) NOT NULL,
	"depth" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"file_type" text,
	"time" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"crawl_setting_id" varchar(191) NOT NULL,
	"resource_id" varchar(191),
	CONSTRAINT "crawl_jobs_url_crawl_setting_id_unique" UNIQUE("url","crawl_setting_id")
);
--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD COLUMN "pages_processed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_crawl_setting_id_crawl_settings_id_fk" FOREIGN KEY ("crawl_setting_id") REFERENCES "public"."crawl_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_feedback" DROP COLUMN "comment";--> statement-breakpoint
ALTER TABLE "chat_turns" DROP COLUMN "translation";