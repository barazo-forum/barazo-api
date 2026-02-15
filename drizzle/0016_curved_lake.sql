ALTER TABLE "users" ADD COLUMN "declared_age" integer;--> statement-breakpoint
ALTER TABLE "community_settings" ADD COLUMN "jurisdiction_country" text;--> statement-breakpoint
ALTER TABLE "community_settings" ADD COLUMN "age_threshold" integer DEFAULT 16 NOT NULL;--> statement-breakpoint
ALTER TABLE "community_settings" ADD COLUMN "require_login_for_mature" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "declared_age" integer;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "age_declared_at";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP COLUMN "age_declaration_at";