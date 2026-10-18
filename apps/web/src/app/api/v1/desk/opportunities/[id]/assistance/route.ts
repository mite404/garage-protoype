import { z } from "zod";
import { requireHttpActor } from "@/server/auth";
import { boundedBody } from "@/server/evidence-http";
import { parseInput } from "@/server/validation";
import {
  beginChatTurn,
  getAssistance,
  submitInquiry,
  createDraft,
  correctInquiry,
  acceptSuggestion,
  renderCardCall,
} from "@/server/assistance";
import { requireOpportunity } from "@/server/access";
import { success, failure } from "@/server/errors";

const command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), message: z.string().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("inquiry"), input: z.unknown() }).strict(),
  z.object({ kind: z.literal("draft"), input: z.unknown() }).strict(),
  z.object({ kind: z.literal("correct"), inquiryId: z.string(), input: z.unknown() }).strict(),
  z
    .object({
      kind: z.literal("accept_suggestion"),
      inquiryId: z.string(),
      revision: z.number().int().min(0),
    })
    .strict(),
  z
    .object({ kind: z.literal("card"), turnId: z.string(), callId: z.string(), call: z.unknown() })
    .strict(),
]);

/** Returns private assistance only to a currently assigned specialist. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireHttpActor(request);
    const { id } = await context.params;
    await requireOpportunity(actor, id, "specialist");
    return success(await getAssistance(actor, id));
  } catch (error) {
    return failure(error);
  }
}

/** Executes bounded shared sales operations. Card parsing never authorizes a business operation. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireHttpActor(request, true);
    const { id } = await context.params;
    await requireOpportunity(actor, id, "specialist");
    const input = parseInput(command, await (await boundedBody(request, 20000)).json());
    const key = request.headers.get("Idempotency-Key") ?? "";
    switch (input.kind) {
      case "chat": {
        const turn = await beginChatTurn(actor, id, input.message, key);
        const view = await getAssistance(actor, id);
        const inquiry = view.inquiries.find((q) => q.id === turn.inquiryId);
        if (inquiry)
          await renderCardCall(actor, id, turn.id, `initial:${inquiry.card.kind}`, {
            tool: inquiry.card.kind,
            props: { inquiryId: inquiry.id },
          });
        return success(await getAssistance(actor, id));
      }
      case "inquiry":
        return success(await submitInquiry(actor, id, input.input, key));
      case "draft":
        return success(await createDraft(actor, id, input.input, key));
      case "correct":
        return success(await correctInquiry(actor, id, input.inquiryId, input.input));
      case "accept_suggestion":
        return success(await acceptSuggestion(actor, id, input.inquiryId, input.revision));
      case "card":
        return success(await renderCardCall(actor, id, input.turnId, input.callId, input.call));
    }
  } catch (error) {
    return failure(error);
  }
}
