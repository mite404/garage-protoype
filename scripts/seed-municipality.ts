import { Pool } from "pg";
import { z } from "zod";
import { seedMunicipality } from "../apps/web/src/server/municipality-seed";

const config = z
  .object({
    MUNICIPALITY_DATABASE_URL: z.string().min(1),
    DEMO_BUYER_ID: z.uuid(),
    DEMO_OPPORTUNITY_ID: z.string().min(1),
  })
  .parse(process.env);
const pool = new Pool({ connectionString: config.MUNICIPALITY_DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await seedMunicipality(client, {
    buyerId: config.DEMO_BUYER_ID,
    opportunityId: config.DEMO_OPPORTUNITY_ID,
  });
  process.stdout.write(
    "Synthetic municipality example is ready. No external actions were performed.\n",
  );
} finally {
  client.release();
  await pool.end();
}
