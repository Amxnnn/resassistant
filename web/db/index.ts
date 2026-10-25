import postgres from "postgres";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

dotenv.config({ path: ".env.local" });
dotenv.config();

// One client per server process. Next.js dev evaluates this module once per route bundle and again
// on every hot reload; each client opened its own pool and the Supabase pooler (15 clients in session
// mode) ran out, failing the agent's requests with EMAXCONNSESSION.
// prepare: false lets DATABASE_URL use Supabase's transaction pooler (port 6543), which has no such
// client limit and is the one to use on Vercel.
const shared = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

const connectionString = process.env.DATABASE_URL;
export const client = connectionString
  ? (shared.pgClient ??= postgres(connectionString, { max: 5, idle_timeout: 20, prepare: false }))
  : null;
export const db = client ? drizzle(client, { schema }) : null;
