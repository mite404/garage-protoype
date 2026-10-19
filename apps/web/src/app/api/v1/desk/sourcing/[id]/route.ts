import { requireHttpActor } from "@/server/auth";
import { boundedBody } from "@/server/evidence-http";
import { failure, success } from "@/server/errors";
import { getSourcingAccount, runSourcingCommand } from "@/server/sourcing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const caseId = async (context: Context) => (await context.params).id;

/** Reads one owned sourcing case from saved, authorized records. */
export async function GET(request: Request, context: Context) {
  try {
    return success(
      await getSourcingAccount(await requireHttpActor(request), await caseId(context)),
    );
  } catch (error) {
    return failure(error);
  }
}

/** Applies one reviewed specialist command. No command sends a message or commits a sale. */
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireHttpActor(request, true);
    const body = await (await boundedBody(request, 16000)).json();
    return success(await runSourcingCommand(actor, await caseId(context), body));
  } catch (error) {
    return failure(error);
  }
}
