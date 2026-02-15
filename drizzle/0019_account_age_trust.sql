-- Migration: Add account age heuristic for new account trust scoring
-- Adds account_created_at to users (resolved from PLC directory on first encounter)
-- Adds trust_status to topics and replies (set based on account age at indexing time)

ALTER TABLE "users" ADD COLUMN "account_created_at" timestamp with time zone;

ALTER TABLE "topics" ADD COLUMN "trust_status" text NOT NULL DEFAULT 'trusted';

ALTER TABLE "replies" ADD COLUMN "trust_status" text NOT NULL DEFAULT 'trusted';

CREATE INDEX "topics_trust_status_idx" ON "topics" USING btree ("trust_status");

CREATE INDEX "replies_trust_status_idx" ON "replies" USING btree ("trust_status");
