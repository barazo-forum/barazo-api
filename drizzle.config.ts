import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./src/db/schema/users.ts",
    "./src/db/schema/firehose.ts",
    "./src/db/schema/topics.ts",
    "./src/db/schema/replies.ts",
    "./src/db/schema/reactions.ts",
    "./src/db/schema/tracked-repos.ts",
    "./src/db/schema/community-settings.ts",
    "./src/db/schema/categories.ts",
    "./src/db/schema/moderation-actions.ts",
    "./src/db/schema/reports.ts",
    "./src/db/schema/notifications.ts",
    "./src/db/schema/user-preferences.ts",
    "./src/db/schema/cross-posts.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://barazo:barazo_dev@localhost:5432/barazo",
  },
});
