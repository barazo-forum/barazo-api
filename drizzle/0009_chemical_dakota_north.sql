CREATE TABLE "moderation_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"target_uri" text,
	"target_did" text,
	"moderator_did" text NOT NULL,
	"community_did" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporter_did" text NOT NULL,
	"target_uri" text NOT NULL,
	"target_did" text NOT NULL,
	"reason_type" text NOT NULL,
	"description" text,
	"community_did" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolution_type" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "is_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "is_mod_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community_settings" ADD COLUMN "moderation_thresholds" jsonb DEFAULT '{"autoBlockReportCount":5,"warnThreshold":3}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "community_settings" ADD COLUMN "word_filter" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "mod_actions_moderator_did_idx" ON "moderation_actions" USING btree ("moderator_did");--> statement-breakpoint
CREATE INDEX "mod_actions_community_did_idx" ON "moderation_actions" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "mod_actions_created_at_idx" ON "moderation_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mod_actions_target_uri_idx" ON "moderation_actions" USING btree ("target_uri");--> statement-breakpoint
CREATE INDEX "mod_actions_target_did_idx" ON "moderation_actions" USING btree ("target_did");--> statement-breakpoint
CREATE INDEX "reports_reporter_did_idx" ON "reports" USING btree ("reporter_did");--> statement-breakpoint
CREATE INDEX "reports_target_uri_idx" ON "reports" USING btree ("target_uri");--> statement-breakpoint
CREATE INDEX "reports_target_did_idx" ON "reports" USING btree ("target_did");--> statement-breakpoint
CREATE INDEX "reports_community_did_idx" ON "reports" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reports_created_at_idx" ON "reports" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_unique_reporter_target_idx" ON "reports" USING btree ("reporter_did","target_uri","community_did");