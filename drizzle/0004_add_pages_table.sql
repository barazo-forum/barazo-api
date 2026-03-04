CREATE TABLE "pages" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"meta_description" text,
	"parent_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"community_did" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pages_slug_community_did_idx" ON "pages" USING btree ("slug","community_did");--> statement-breakpoint
CREATE INDEX "pages_community_did_idx" ON "pages" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "pages_parent_id_idx" ON "pages" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "pages_status_community_did_idx" ON "pages" USING btree ("status","community_did");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pages" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));