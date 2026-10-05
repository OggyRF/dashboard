import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Not required for `prisma generate` (Docker build, npm install); migrate
  // commands fail clearly if it is missing.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
