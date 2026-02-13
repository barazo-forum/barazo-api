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
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://barazo:barazo_dev@localhost:5432/barazo",
  },
});
