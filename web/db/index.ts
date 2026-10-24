import postgres from "postgres";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

dotenv.config({ path: ".env.local" });
dotenv.config();

const connectionString = process.env.DATABASE_URL;
export const client = connectionString ? postgres(connectionString) : null;
export const db = client ? drizzle(client, { schema }) : null;
