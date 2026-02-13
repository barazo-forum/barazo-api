CREATE TABLE "users" (
	"did" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"role" text DEFAULT 'user' NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"reputation_score" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firehose_cursor" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"cursor" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
