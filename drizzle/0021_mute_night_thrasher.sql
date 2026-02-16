ALTER TABLE "reports" ADD COLUMN "appeal_reason" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "appealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "appeal_status" text DEFAULT 'none' NOT NULL;