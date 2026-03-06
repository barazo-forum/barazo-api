CREATE TABLE "plugin_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_permissions_plugin_id_permission_unique" UNIQUE("plugin_id","permission")
);
--> statement-breakpoint
ALTER TABLE "plugin_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plugin_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "plugin_settings_plugin_id_key_unique" UNIQUE("plugin_id","key")
);
--> statement-breakpoint
ALTER TABLE "plugin_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"version" text NOT NULL,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"category" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugins_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "plugins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plugin_permissions" ADD CONSTRAINT "plugin_permissions_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_settings" ADD CONSTRAINT "plugin_settings_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "plugin_permissions_instance_wide" ON "plugin_permissions" AS PERMISSIVE FOR ALL TO "barazo_app" USING (true);--> statement-breakpoint
CREATE POLICY "plugin_settings_instance_wide" ON "plugin_settings" AS PERMISSIVE FOR ALL TO "barazo_app" USING (true);--> statement-breakpoint
CREATE POLICY "plugins_instance_wide" ON "plugins" AS PERMISSIVE FOR ALL TO "barazo_app" USING (true);