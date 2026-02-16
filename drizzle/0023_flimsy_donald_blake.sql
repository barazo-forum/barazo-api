CREATE TABLE "community_profiles" (
	"did" text NOT NULL,
	"community_did" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"banner_url" text,
	"bio" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_profiles_did_community_did_pk" PRIMARY KEY("did","community_did")
);
--> statement-breakpoint
CREATE INDEX "community_profiles_did_idx" ON "community_profiles" USING btree ("did");--> statement-breakpoint
CREATE INDEX "community_profiles_community_idx" ON "community_profiles" USING btree ("community_did");