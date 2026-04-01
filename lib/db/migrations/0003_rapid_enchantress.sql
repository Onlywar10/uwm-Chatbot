CREATE TABLE "widget_configs" (
	"id" varchar(191) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"greeting" text,
	"accent_color" varchar(9),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
