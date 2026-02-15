CREATE TABLE "community_onboarding_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"community_did" text NOT NULL,
	"field_type" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_onboarding_responses" (
	"did" text NOT NULL,
	"community_did" text NOT NULL,
	"field_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_onboarding_responses_did_community_did_field_id_pk" PRIMARY KEY("did","community_did","field_id")
);
--> statement-breakpoint
CREATE INDEX "onboarding_fields_community_idx" ON "community_onboarding_fields" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "onboarding_responses_did_community_idx" ON "user_onboarding_responses" USING btree ("did","community_did");