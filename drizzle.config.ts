import { defineConfig } from "drizzle-kit";

// The application schema in db-schema.ts is the source of table shape. Functions, grants, row
// security and data changes it cannot express are custom SQL migrations in the same history.
export default defineConfig({
  dialect: "postgresql",
  schema: "./apps/web/src/server/db-schema.ts",
  out: "./db/migrations",
  schemaFilter: ["signal_desk"],
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? "" },
});
