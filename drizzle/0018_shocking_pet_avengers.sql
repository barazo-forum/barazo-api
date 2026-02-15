CREATE TABLE "moderation_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_uri" text NOT NULL,
	"content_type" text NOT NULL,
	"author_did" text NOT NULL,
	"community_did" text NOT NULL,
	"queue_reason" text NOT NULL,
	"matched_words" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account_trust" (
	"id" serial PRIMARY KEY NOT NULL,
	"did" text NOT NULL,
	"community_did" text NOT NULL,
	"approved_post_count" integer DEFAULT 0 NOT NULL,
	"is_trusted" boolean DEFAULT false NOT NULL,
	"trusted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "community_settings" ALTER COLUMN "moderation_thresholds" SET DEFAULT '{"autoBlockReportCount":5,"warnThreshold":3,"firstPostQueueCount":3,"newAccountDays":7,"newAccountWriteRatePerMin":3,"establishedWriteRatePerMin":10,"linkHoldEnabled":true,"topicCreationDelayEnabled":true,"burstPostCount":5,"burstWindowMinutes":10,"trustedPostThreshold":10}'::jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "moderation_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "moderation_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
CREATE INDEX "mod_queue_author_did_idx" ON "moderation_queue" USING btree ("author_did");--> statement-breakpoint
CREATE INDEX "mod_queue_community_did_idx" ON "moderation_queue" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "mod_queue_status_idx" ON "moderation_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mod_queue_created_at_idx" ON "moderation_queue" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mod_queue_content_uri_idx" ON "moderation_queue" USING btree ("content_uri");--> statement-breakpoint
CREATE UNIQUE INDEX "account_trust_did_community_idx" ON "account_trust" USING btree ("did","community_did");--> statement-breakpoint
CREATE INDEX "account_trust_did_idx" ON "account_trust" USING btree ("did");--> statement-breakpoint
CREATE INDEX "topics_moderation_status_idx" ON "topics" USING btree ("moderation_status");--> statement-breakpoint
CREATE INDEX "replies_moderation_status_idx" ON "replies" USING btree ("moderation_status");