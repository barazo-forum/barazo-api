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
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://barazo:barazo_dev@localhost:5432/barazo",
  },
});
