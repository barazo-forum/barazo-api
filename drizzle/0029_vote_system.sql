CREATE TABLE IF NOT EXISTS "votes" (
	"uri" text PRIMARY KEY NOT NULL,
	"rkey" text NOT NULL,
	"author_did" text NOT NULL,
	"subject_uri" text NOT NULL,
	"subject_cid" text NOT NULL,
	"direction" text NOT NULL,
	"community_did" text NOT NULL,
	"cid" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_author_subject_uniq" UNIQUE("author_did","subject_uri")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "votes_author_did_idx" ON "votes" USING btree ("author_did");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "votes_subject_uri_idx" ON "votes" USING btree ("subject_uri");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "votes_community_did_idx" ON "votes" USING btree ("community_did");
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "vote_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "vote_count" integer DEFAULT 0 NOT NULL;
