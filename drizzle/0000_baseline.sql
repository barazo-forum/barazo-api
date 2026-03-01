CREATE ROLE "barazo_app";--> statement-breakpoint
CREATE TABLE "users" (
	"did" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"banner_url" text,
	"bio" text,
	"role" text DEFAULT 'user' NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"reputation_score" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"declared_age" integer,
	"maturity_pref" text DEFAULT 'safe' NOT NULL,
	"account_created_at" timestamp with time zone,
	"followers_count" integer DEFAULT 0 NOT NULL,
	"follows_count" integer DEFAULT 0 NOT NULL,
	"atproto_posts_count" integer DEFAULT 0 NOT NULL,
	"has_bluesky_profile" boolean DEFAULT false NOT NULL,
	"atproto_labels" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firehose_cursor" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"cursor" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"uri" text PRIMARY KEY NOT NULL,
	"rkey" text NOT NULL,
	"author_did" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_format" text,
	"category" text NOT NULL,
	"tags" jsonb,
	"community_did" text NOT NULL,
	"cid" text NOT NULL,
	"labels" jsonb,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_mod_deleted" boolean DEFAULT false NOT NULL,
	"is_author_deleted" boolean DEFAULT false NOT NULL,
	"moderation_status" text DEFAULT 'approved' NOT NULL,
	"trust_status" text DEFAULT 'trusted' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "replies" (
	"uri" text PRIMARY KEY NOT NULL,
	"rkey" text NOT NULL,
	"author_did" text NOT NULL,
	"content" text NOT NULL,
	"content_format" text,
	"root_uri" text NOT NULL,
	"root_cid" text NOT NULL,
	"parent_uri" text NOT NULL,
	"parent_cid" text NOT NULL,
	"community_did" text NOT NULL,
	"cid" text NOT NULL,
	"labels" jsonb,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_author_deleted" boolean DEFAULT false NOT NULL,
	"is_mod_deleted" boolean DEFAULT false NOT NULL,
	"moderation_status" text DEFAULT 'approved' NOT NULL,
	"trust_status" text DEFAULT 'trusted' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reactions" (
	"uri" text PRIMARY KEY NOT NULL,
	"rkey" text NOT NULL,
	"author_did" text NOT NULL,
	"subject_uri" text NOT NULL,
	"subject_cid" text NOT NULL,
	"type" text NOT NULL,
	"community_did" text NOT NULL,
	"cid" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_author_subject_type_uniq" UNIQUE("author_did","subject_uri","type")
);
--> statement-breakpoint
ALTER TABLE "reactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "votes" (
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
CREATE TABLE "tracked_repos" (
	"did" text PRIMARY KEY NOT NULL,
	"tracked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_settings" (
	"community_did" text PRIMARY KEY NOT NULL,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"initialized" boolean DEFAULT false NOT NULL,
	"admin_did" text,
	"community_name" text DEFAULT 'Barazo Community' NOT NULL,
	"maturity_rating" text DEFAULT 'safe' NOT NULL,
	"reaction_set" jsonb DEFAULT '["like"]'::jsonb NOT NULL,
	"moderation_thresholds" jsonb DEFAULT '{"autoBlockReportCount":5,"warnThreshold":3,"firstPostQueueCount":3,"newAccountDays":7,"newAccountWriteRatePerMin":3,"establishedWriteRatePerMin":10,"linkHoldEnabled":true,"topicCreationDelayEnabled":true,"burstPostCount":5,"burstWindowMinutes":10,"trustedPostThreshold":10}'::jsonb NOT NULL,
	"word_filter" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"jurisdiction_country" text,
	"age_threshold" integer DEFAULT 16 NOT NULL,
	"require_login_for_mature" boolean DEFAULT true NOT NULL,
	"community_description" text,
	"handle" text,
	"service_endpoint" text,
	"signing_key" text,
	"rotation_key" text,
	"community_logo_url" text,
	"primary_color" text,
	"accent_color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"target_uri" text,
	"target_did" text,
	"moderator_did" text NOT NULL,
	"community_did" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moderation_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporter_did" text NOT NULL,
	"target_uri" text NOT NULL,
	"target_did" text NOT NULL,
	"reason_type" text NOT NULL,
	"description" text,
	"community_did" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolution_type" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"appeal_reason" text,
	"appealed_at" timestamp with time zone,
	"appeal_status" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_did" text NOT NULL,
	"type" text NOT NULL,
	"subject_uri" text NOT NULL,
	"actor_did" text NOT NULL,
	"community_did" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_community_preferences" (
	"did" text NOT NULL,
	"community_did" text NOT NULL,
	"maturity_override" text,
	"muted_words" jsonb,
	"blocked_dids" jsonb,
	"muted_dids" jsonb,
	"notification_prefs" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_community_preferences_did_community_did_pk" PRIMARY KEY("did","community_did")
);
--> statement-breakpoint
ALTER TABLE "user_community_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"did" text PRIMARY KEY NOT NULL,
	"maturity_level" text DEFAULT 'sfw' NOT NULL,
	"declared_age" integer,
	"muted_words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_dids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"muted_dids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cross_post_bluesky" boolean DEFAULT false NOT NULL,
	"cross_post_frontpage" boolean DEFAULT false NOT NULL,
	"cross_post_scopes_granted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "community_onboarding_fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_onboarding_responses" (
	"did" text NOT NULL,
	"community_did" text NOT NULL,
	"field_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_onboarding_responses_did_community_did_field_id_pk" PRIMARY KEY("did","community_did","field_id")
);
--> statement-breakpoint
ALTER TABLE "user_onboarding_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "moderation_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_uri" text NOT NULL,
	"content_type" text NOT NULL,
	"author_did" text NOT NULL,
	"community_did" text NOT NULL,
	"queue_reason" text NOT NULL,
	"matched_words" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "moderation_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account_trust" (
	"id" serial PRIMARY KEY NOT NULL,
	"did" text NOT NULL,
	"community_did" text NOT NULL,
	"approved_post_count" integer DEFAULT 0 NOT NULL,
	"is_trusted" boolean DEFAULT false NOT NULL,
	"trusted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account_trust" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "community_filters" (
	"community_did" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"admin_did" text,
	"reason" text,
	"report_count" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"filtered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_filters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account_filters" (
	"id" serial PRIMARY KEY NOT NULL,
	"did" text NOT NULL,
	"community_did" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"report_count" integer DEFAULT 0 NOT NULL,
	"ban_count" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"filtered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_filters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ozone_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"src" text NOT NULL,
	"uri" text NOT NULL,
	"val" text NOT NULL,
	"neg" boolean DEFAULT false NOT NULL,
	"cts" timestamp with time zone NOT NULL,
	"exp" timestamp with time zone,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "community_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interaction_graph" (
	"source_did" text NOT NULL,
	"target_did" text NOT NULL,
	"community_id" text NOT NULL,
	"interaction_type" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"first_interaction_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_interaction_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interaction_graph_source_did_target_did_community_id_interaction_type_pk" PRIMARY KEY("source_did","target_did","community_id","interaction_type")
);
--> statement-breakpoint
CREATE TABLE "trust_seeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"did" text NOT NULL,
	"community_id" text DEFAULT '' NOT NULL,
	"added_by" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_scores" (
	"did" text NOT NULL,
	"community_id" text DEFAULT '' NOT NULL,
	"score" real NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_scores_did_community_id_pk" PRIMARY KEY("did","community_id")
);
--> statement-breakpoint
CREATE TABLE "sybil_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_hash" text NOT NULL,
	"internal_edge_count" integer NOT NULL,
	"external_edge_count" integer NOT NULL,
	"member_count" integer NOT NULL,
	"status" text DEFAULT 'flagged' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sybil_cluster_members" (
	"cluster_id" integer NOT NULL,
	"did" text NOT NULL,
	"role_in_cluster" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sybil_cluster_members_cluster_id_did_pk" PRIMARY KEY("cluster_id","did")
);
--> statement-breakpoint
CREATE TABLE "behavioral_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"flag_type" text NOT NULL,
	"affected_dids" jsonb NOT NULL,
	"details" text NOT NULL,
	"community_did" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pds_trust_factors" (
	"id" serial PRIMARY KEY NOT NULL,
	"pds_host" text NOT NULL,
	"trust_factor" real NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sybil_cluster_members" ADD CONSTRAINT "sybil_cluster_members_cluster_id_sybil_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."sybil_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_role_elevated_idx" ON "users" USING btree ("role") WHERE role IN ('moderator', 'admin');--> statement-breakpoint
CREATE INDEX "users_handle_idx" ON "users" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "users_account_created_at_idx" ON "users" USING btree ("account_created_at");--> statement-breakpoint
CREATE INDEX "topics_author_did_idx" ON "topics" USING btree ("author_did");--> statement-breakpoint
CREATE INDEX "topics_category_idx" ON "topics" USING btree ("category");--> statement-breakpoint
CREATE INDEX "topics_created_at_idx" ON "topics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "topics_last_activity_at_idx" ON "topics" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "topics_community_did_idx" ON "topics" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "topics_moderation_status_idx" ON "topics" USING btree ("moderation_status");--> statement-breakpoint
CREATE INDEX "topics_trust_status_idx" ON "topics" USING btree ("trust_status");--> statement-breakpoint
CREATE INDEX "topics_community_category_activity_idx" ON "topics" USING btree ("community_did","category","last_activity_at");--> statement-breakpoint
CREATE INDEX "replies_author_did_idx" ON "replies" USING btree ("author_did");--> statement-breakpoint
CREATE INDEX "replies_root_uri_idx" ON "replies" USING btree ("root_uri");--> statement-breakpoint
CREATE INDEX "replies_parent_uri_idx" ON "replies" USING btree ("parent_uri");--> statement-breakpoint
CREATE INDEX "replies_created_at_idx" ON "replies" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "replies_community_did_idx" ON "replies" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "replies_moderation_status_idx" ON "replies" USING btree ("moderation_status");--> statement-breakpoint
CREATE INDEX "replies_trust_status_idx" ON "replies" USING btree ("trust_status");--> statement-breakpoint
CREATE INDEX "replies_root_uri_created_at_idx" ON "replies" USING btree ("root_uri","created_at");--> statement-breakpoint
CREATE INDEX "reactions_author_did_idx" ON "reactions" USING btree ("author_did");--> statement-breakpoint
CREATE INDEX "reactions_subject_uri_idx" ON "reactions" USING btree ("subject_uri");--> statement-breakpoint
CREATE INDEX "reactions_community_did_idx" ON "reactions" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "reactions_subject_uri_type_idx" ON "reactions" USING btree ("subject_uri","type");--> statement-breakpoint
CREATE INDEX "votes_author_did_idx" ON "votes" USING btree ("author_did");--> statement-breakpoint
CREATE INDEX "votes_subject_uri_idx" ON "votes" USING btree ("subject_uri");--> statement-breakpoint
CREATE INDEX "votes_community_did_idx" ON "votes" USING btree ("community_did");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_community_did_idx" ON "categories" USING btree ("slug","community_did");--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "categories_community_did_idx" ON "categories" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "categories_maturity_rating_idx" ON "categories" USING btree ("maturity_rating");--> statement-breakpoint
CREATE INDEX "mod_actions_moderator_did_idx" ON "moderation_actions" USING btree ("moderator_did");--> statement-breakpoint
CREATE INDEX "mod_actions_community_did_idx" ON "moderation_actions" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "mod_actions_created_at_idx" ON "moderation_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mod_actions_target_uri_idx" ON "moderation_actions" USING btree ("target_uri");--> statement-breakpoint
CREATE INDEX "mod_actions_target_did_idx" ON "moderation_actions" USING btree ("target_did");--> statement-breakpoint
CREATE INDEX "reports_reporter_did_idx" ON "reports" USING btree ("reporter_did");--> statement-breakpoint
CREATE INDEX "reports_target_uri_idx" ON "reports" USING btree ("target_uri");--> statement-breakpoint
CREATE INDEX "reports_target_did_idx" ON "reports" USING btree ("target_did");--> statement-breakpoint
CREATE INDEX "reports_community_did_idx" ON "reports" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reports_created_at_idx" ON "reports" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_unique_reporter_target_idx" ON "reports" USING btree ("reporter_did","target_uri","community_did");--> statement-breakpoint
CREATE INDEX "notifications_recipient_did_idx" ON "notifications" USING btree ("recipient_did");--> statement-breakpoint
CREATE INDEX "notifications_recipient_read_idx" ON "notifications" USING btree ("recipient_did","read");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_community_prefs_did_idx" ON "user_community_preferences" USING btree ("did");--> statement-breakpoint
CREATE INDEX "user_community_prefs_community_idx" ON "user_community_preferences" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "cross_posts_topic_uri_idx" ON "cross_posts" USING btree ("topic_uri");--> statement-breakpoint
CREATE INDEX "cross_posts_author_did_idx" ON "cross_posts" USING btree ("author_did");--> statement-breakpoint
CREATE INDEX "onboarding_fields_community_idx" ON "community_onboarding_fields" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "onboarding_responses_did_community_idx" ON "user_onboarding_responses" USING btree ("did","community_did");--> statement-breakpoint
CREATE INDEX "mod_queue_author_did_idx" ON "moderation_queue" USING btree ("author_did");--> statement-breakpoint
CREATE INDEX "mod_queue_community_did_idx" ON "moderation_queue" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "mod_queue_status_idx" ON "moderation_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mod_queue_created_at_idx" ON "moderation_queue" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mod_queue_content_uri_idx" ON "moderation_queue" USING btree ("content_uri");--> statement-breakpoint
CREATE UNIQUE INDEX "account_trust_did_community_idx" ON "account_trust" USING btree ("did","community_did");--> statement-breakpoint
CREATE INDEX "account_trust_did_idx" ON "account_trust" USING btree ("did");--> statement-breakpoint
CREATE INDEX "community_filters_status_idx" ON "community_filters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "community_filters_admin_did_idx" ON "community_filters" USING btree ("admin_did");--> statement-breakpoint
CREATE INDEX "community_filters_updated_at_idx" ON "community_filters" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_filters_did_community_idx" ON "account_filters" USING btree ("did","community_did");--> statement-breakpoint
CREATE INDEX "account_filters_did_idx" ON "account_filters" USING btree ("did");--> statement-breakpoint
CREATE INDEX "account_filters_community_did_idx" ON "account_filters" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "account_filters_status_idx" ON "account_filters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "account_filters_updated_at_idx" ON "account_filters" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ozone_labels_src_uri_val_idx" ON "ozone_labels" USING btree ("src","uri","val");--> statement-breakpoint
CREATE INDEX "ozone_labels_uri_idx" ON "ozone_labels" USING btree ("uri");--> statement-breakpoint
CREATE INDEX "ozone_labels_val_idx" ON "ozone_labels" USING btree ("val");--> statement-breakpoint
CREATE INDEX "ozone_labels_indexed_at_idx" ON "ozone_labels" USING btree ("indexed_at");--> statement-breakpoint
CREATE INDEX "community_profiles_did_idx" ON "community_profiles" USING btree ("did");--> statement-breakpoint
CREATE INDEX "community_profiles_community_idx" ON "community_profiles" USING btree ("community_did");--> statement-breakpoint
CREATE INDEX "interaction_graph_source_target_community_idx" ON "interaction_graph" USING btree ("source_did","target_did","community_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trust_seeds_did_community_idx" ON "trust_seeds" USING btree ("did","community_id");--> statement-breakpoint
CREATE INDEX "trust_scores_did_community_idx" ON "trust_scores" USING btree ("did","community_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sybil_clusters_hash_idx" ON "sybil_clusters" USING btree ("cluster_hash");--> statement-breakpoint
CREATE INDEX "behavioral_flags_flag_type_idx" ON "behavioral_flags" USING btree ("flag_type");--> statement-breakpoint
CREATE INDEX "behavioral_flags_status_idx" ON "behavioral_flags" USING btree ("status");--> statement-breakpoint
CREATE INDEX "behavioral_flags_detected_at_idx" ON "behavioral_flags" USING btree ("detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pds_trust_factors_pds_host_idx" ON "pds_trust_factors" USING btree ("pds_host");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "topics" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "replies" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reactions" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "community_settings" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "categories" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "moderation_actions" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reports" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "user_community_preferences" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "community_onboarding_fields" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "user_onboarding_responses" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "moderation_queue" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account_trust" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "community_filters" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "account_filters" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "community_profiles" AS PERMISSIVE FOR ALL TO "barazo_app" USING (community_did = current_setting('app.current_community_did', true)) WITH CHECK (community_did = current_setting('app.current_community_did', true));