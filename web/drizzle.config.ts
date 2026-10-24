import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

export default defineConfig({ schema: "./db/schema.ts", out: "./db/migrations", dialect: "postgresql", dbCredentials: { url: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/resassistant" } });
