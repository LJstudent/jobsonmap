CREATE TABLE "job_discovery_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"method" text,
	"status" text,
	"found_url" text,
	"platform" text,
	"message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"status" text,
	"jobs_found" integer,
	"duration_ms" integer,
	"http_status" integer,
	"message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"title" text NOT NULL,
	"location_text" text,
	"city" text,
	"description" text,
	"url" text NOT NULL,
	"external_id" text,
	"source_platform" text,
	"first_seen_at" timestamp DEFAULT now(),
	"last_seen_at" timestamp DEFAULT now(),
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "jobs_url" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "jobs_platform" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "jobs_discovery_status" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "jobs_discovery_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "jobs_scrape_status" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "jobs_scrape_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_discovery_at" timestamp;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_scrape_at" timestamp;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "last_jobs_found_at" timestamp;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" DROP COLUMN "crawl_attempted";