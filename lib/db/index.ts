import { env } from "@/lib/env.mjs";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

const sql = neon(env.DATABASE_URL);
export const db = drizzle(sql);
