ALTER TABLE "topics" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "pinned_scope" text;--> statement-breakpoint
CREATE INDEX "topics_pinned_scope_idx" ON "topics" USING btree ("pinned_scope");