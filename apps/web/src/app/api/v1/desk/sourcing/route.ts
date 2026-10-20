import { z } from "zod";
import { requireHttpActor } from "@/server/auth";
import { boundedBody } from "@/server/evidence-http";
import { failure, success } from "@/server/errors";
import { createBuyerNeed, listSourcingCases, openConnection } from "@/server/sourcing";
import { seedSourcing } from "@/server/sourcing-seed";
import { parseInput } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("seed_synthetic") }).strict(),
  z.object({ kind: z.literal("create_need"), input: z.unknown() }).strict(),
  z.object({ kind: z.literal("open_connection"), input: z.unknown() }).strict(),
]);

/** Lists the specialist's own buyer-seller connections. */
export async function GET(request: Request) {
  try {
    return success(await listSourcingCases(await requireHttpActor(request)));
  } catch (error) {
    return failure(error);
  }
}

/** Records a buyer need, opens a connection from either side, or creates the synthetic
 * walkthrough. No command sends a message or commits a sale. */
export async function POST(request: Request) {
  try {
    const actor = await requireHttpActor(request, true);
    const parsed = parseInput(command, await (await boundedBody(request, 16000)).json());
    if (parsed.kind === "create_need")
      return success({ needId: await createBuyerNeed(actor, parsed.input) });
    if (parsed.kind === "open_connection")
      return success({ caseId: await openConnection(actor, parsed.input) });
    return success({ caseId: await seedSourcing(actor) });
  } catch (error) {
    return failure(error);
  }
}
