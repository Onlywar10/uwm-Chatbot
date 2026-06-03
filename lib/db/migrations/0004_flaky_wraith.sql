CREATE TYPE "public"."analytics_turn_status" AS ENUM('answered', 'clarify', 'no-data', 'error');--> statement-breakpoint
CREATE TABLE "analytics_turns" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"status" "analytics_turn_status" NOT NULL,
	"question" text NOT NULL,
	"response" text NOT NULL,
	"tool_calls" jsonb NOT NULL,
	"coverage_flags" jsonb,
	"model" varchar(100) NOT NULL,
	"latency_ms" integer NOT NULL,
	"tokens" jsonb NOT NULL,
	"estimated_cost" numeric(10, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"call_report_num" varchar(32) PRIMARY KEY NOT NULL,
	"report_version" varchar(128),
	"call_length" integer,
	"entered_on" timestamp NOT NULL,
	"city" varchar(128),
	"county" varchar(128),
	"postal_code" varchar(16),
	"language_raw" varchar(64),
	"language_canonical" varchar(64),
	"tele_interpretation_used" boolean,
	"ethnicity_raw" varchar(64),
	"ethnicity_canonical" varchar(64),
	"gender_raw" varchar(32),
	"gender_canonical" varchar(32),
	"age_raw" varchar(32),
	"age_numeric" integer,
	"health_insurance" varchar(64),
	"has_children_0_5" boolean,
	"children_under_5_count" integer,
	"seniors_60_plus_count" integer
);
--> statement-breakpoint
CREATE TABLE "field_coverage" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"table_name" varchar(64) NOT NULL,
	"field" varchar(128) NOT NULL,
	"min_date" timestamp,
	"max_date" timestamp,
	"non_null_count" integer NOT NULL,
	"total_count" integer NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "field_coverage_table_field_unique" UNIQUE("table_name","field")
);
--> statement-breakpoint
CREATE TABLE "needs" (
	"report_need_num" varchar(32) PRIMARY KEY NOT NULL,
	"call_report_num" varchar(32) NOT NULL,
	"date_of_call" timestamp NOT NULL,
	"taxonomy_code" varchar(32),
	"taxonomy_name" varchar(256),
	"level1_name" varchar(128),
	"level2_code" varchar(32),
	"level2_name" varchar(256),
	"level3_code" varchar(32),
	"level3_name" varchar(256),
	"level4_code" varchar(32),
	"level4_name" varchar(256),
	"level5_code" varchar(32),
	"level5_name" varchar(256),
	"airs_need_category" varchar(128),
	"need_was_unmet" boolean NOT NULL,
	"reason_if_unmet" varchar(128)
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"report_need_num" varchar(32) NOT NULL,
	"resource_agency_num" varchar(32),
	"agency_name_public" varchar(512),
	"parent_resource_num" varchar(32),
	"parent_agency_name" varchar(512)
);
--> statement-breakpoint
ALTER TABLE "needs" ADD CONSTRAINT "needs_call_report_num_calls_call_report_num_fk" FOREIGN KEY ("call_report_num") REFERENCES "public"."calls"("call_report_num") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_report_need_num_needs_report_need_num_fk" FOREIGN KEY ("report_need_num") REFERENCES "public"."needs"("report_need_num") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_turns_timestamp_idx" ON "analytics_turns" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "calls_entered_on_idx" ON "calls" USING btree ("entered_on");--> statement-breakpoint
CREATE INDEX "calls_county_idx" ON "calls" USING btree ("county");--> statement-breakpoint
CREATE INDEX "calls_ethnicity_canonical_idx" ON "calls" USING btree ("ethnicity_canonical");--> statement-breakpoint
CREATE INDEX "calls_gender_canonical_idx" ON "calls" USING btree ("gender_canonical");--> statement-breakpoint
CREATE INDEX "calls_language_canonical_idx" ON "calls" USING btree ("language_canonical");--> statement-breakpoint
CREATE INDEX "needs_call_report_num_idx" ON "needs" USING btree ("call_report_num");--> statement-breakpoint
CREATE INDEX "needs_date_of_call_idx" ON "needs" USING btree ("date_of_call");--> statement-breakpoint
CREATE INDEX "needs_airs_category_idx" ON "needs" USING btree ("airs_need_category");--> statement-breakpoint
CREATE INDEX "needs_unmet_idx" ON "needs" USING btree ("need_was_unmet");--> statement-breakpoint
CREATE INDEX "needs_taxonomy_name_idx" ON "needs" USING btree ("taxonomy_name");--> statement-breakpoint
CREATE INDEX "referrals_report_need_num_idx" ON "referrals" USING btree ("report_need_num");--> statement-breakpoint
CREATE INDEX "referrals_agency_name_idx" ON "referrals" USING btree ("agency_name_public");