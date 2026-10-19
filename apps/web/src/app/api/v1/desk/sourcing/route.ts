import { z } from "zod";
import { requireHttpActor } from "@/server/auth";
import { failure, success } from "@/server/errors";
import { listSourcingCases } from "@/server/sourcing";
import { seedSourcing } from "@/server/sourcing-seed";
import { parseInput } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const command = z.object({ kind: z.literal("seed_synthetic") }).strict();

/** Lists the specialist's own sourcing cases. */
export async function GET(request: Request) {
  try {
    return success(await listSourcingCases(await requireHttpActor(request)));
  } catch (error) {
    return failure(error);
  }
}

/** Creates the synthetic Pine Brook walkthrough for the current specialist. Sends nothing. */
export async function POST(request: Request) {
  try {
    const actor = await requireHttpActor(request, true);
    parseInput(command, await request.json());
    return success({ caseId: await seedSourcing(actor) });
  } catch (error) {
    return failure(error);
  }
}
