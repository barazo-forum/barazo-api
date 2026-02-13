CREATE TABLE "community_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"initialized" boolean DEFAULT false NOT NULL,
	"community_did" text,
	"community_name" text DEFAULT 'ATgora Community' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
