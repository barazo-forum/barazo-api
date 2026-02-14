CREATE TABLE "cross_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"topic_uri" text NOT NULL,
	"service" text NOT NULL,
	"cross_post_uri" text NOT NULL,
	"cross_post_cid" text NOT NULL,
	"author_did" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cross_posts_topic_uri_idx" ON "cross_posts" USING btree ("topic_uri");--> statement-breakpoint
CREATE INDEX "cross_posts_author_did_idx" ON "cross_posts" USING btree ("author_did");