CREATE TYPE "public"."turn_status" AS ENUM('answered', 'no-answer', 'error');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'crawler');--> statement-breakpoint
CREATE TABLE "chat_turns" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"domain" varchar(255) NOT NULL,
	"status" "turn_status" NOT NULL,
	"latency" jsonb NOT NULL,
	"model" varchar(100) NOT NULL,
	"tokens" jsonb NOT NULL,
	"estimated_cost" numeric(10, 6) NOT NULL,
	"retrieval" jsonb NOT NULL,
	"prompt" jsonb NOT NULL,
	"response" text NOT NULL,
	"translation" jsonb
);
--> statement-breakpoint
CREATE TABLE "crawl_settings" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"domain" varchar(255) NOT NULL,
	"use_sitemaps" boolean NOT NULL,
	"ignore_robots" boolean NOT NULL,
	"drop_all_query" boolean NOT NULL,
	"max_crawl_depth" integer NOT NULL,
	"max_crawl_pages" integer NOT NULL,
	"max_chars_per_page" integer NOT NULL,
	"urls_to_ignore" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"school_id" varchar(191) NOT NULL,
	CONSTRAINT "crawl_settings_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"resource_id" varchar(191) NOT NULL,
	"domain" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"domain" varchar(255) NOT NULL,
	"url" varchar(1024) NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"crawl_setting_id" varchar(191) NOT NULL,
	"school_id" varchar(191) NOT NULL,
	CONSTRAINT "resources_domain_url_unique" UNIQUE("domain","url")
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"district_id" varchar(191) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_id" varchar(191) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'crawler' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "crawl_settings" ADD CONSTRAINT "crawl_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_crawl_setting_id_crawl_settings_id_fk" FOREIGN KEY ("crawl_setting_id") REFERENCES "public"."crawl_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_turns_domain_idx" ON "chat_turns" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "chat_turns_timestamp_idx" ON "chat_turns" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "embeddingIndex" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "embeddings_domain_idx" ON "embeddings" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "resources_domain_idx" ON "resources" USING btree ("domain");