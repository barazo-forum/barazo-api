CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"community_did" text NOT NULL,
	"maturity_rating" text DEFAULT 'safe' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "age_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_settings" ADD COLUMN "maturity_rating" text DEFAULT 'safe' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_community_did_idx" ON "categories" USING btree ("slug","community_did");--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "categories_community_did_idx" ON "categories" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "categories_maturity_rating_idx" ON "categories" USING btree ("maturity_rating");
