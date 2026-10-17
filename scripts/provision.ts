import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { z } from "zod";
import { drizzle } from "drizzle-orm/node-postgres";
import { identities } from "../apps/web/src/server/db-schema";

const config = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(1),
    MIGRATION_DATABASE_URL: z.string().min(1),
    INVITE_EMAIL: z.email(),
    INVITE_PASSWORD: z.string().min(16),
    INVITE_ROLE: z.enum(["buyer", "specialist"]),
  })
  .parse(process.env);
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pool = new Pool({ connectionString: config.MIGRATION_DATABASE_URL, max: 1 });
try {
  const { data, error } = await supabase.auth.admin.createUser({
    email: config.INVITE_EMAIL,
    password: config.INVITE_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error("Identity creation failed. Inspect the prototype Auth dashboard.");
  await drizzle(pool).insert(identities).values({ userId: data.user.id, role: config.INVITE_ROLE });
  process.stdout.write(`Invited identity ${data.user.id}. Spending remains disabled.\n`);
} finally {
  await pool.end();
}
