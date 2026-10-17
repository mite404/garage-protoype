"use agent";
import { useInitialData, useModel, useTool, type AgentProps } from "@flue/runtime";
import * as v from "valibot";
import { z } from "zod";
import { approvedSalesTool, draftCommand } from "@signal-desk/contracts/assistance-schema";
import { createDraft, renderCardCall } from "../server/assistance";
import { streamContext } from "../server/streaming";

const seed = z.object({ instruction: z.string() });

/** Assists one authorized specialist turn with evidence cards and unsent drafts only. */
export function SpecialistStream({ id }: AgentProps) {
  const initial = seed.parse(useInitialData());
  useModel("signal-desk/moonshotai/kimi-k3", { compaction: false });
  useTool({
    name: approvedSalesTool.enum.show_card,
    description:
      'Show a complete evidence-checked card. Use {tool:"review"|"answer"|"handoff",props:{inquiryId}} with the current inquiry ID, or {tool:"draft",props:{draftId}} with the ID returned by prepare_draft. Never supply factual values or invent IDs.',
    input: v.strictObject({
      tool: v.picklist(["review", "answer", "handoff", "draft"]),
      props: v.union([
        v.strictObject({ inquiryId: v.string() }),
        v.strictObject({ draftId: v.string() }),
      ]),
    }),
    run: async ({ data, toolCallId }) => {
      const { actor, row } = await streamContext(id);
      return { output: await renderCardCall(actor, row.opportunityId, id, toolCallId, data) };
    },
  });
  useTool({
    name: approvedSalesTool.enum.prepare_draft,
    description:
      "Prepare one unsent draft for the already-bound opportunity and current inquiry. Only kind is required: seller_request asks for missing evidence even when facts are unknown; buyer_followup requires reviewed evidence. Do not ask for listing IDs, recipient details, or missing test results to prepare a seller request: the server resolves references and writes the request. Returns a draft card including draftId for show_card. Never sends messages.",
    input: v.strictObject({ kind: v.picklist(["seller_request", "buyer_followup"]) }),
    durable: true,
    run: async ({ data, step }) => {
      await streamContext(id);
      return {
        output: await step.do("save-draft", async () => {
          const { actor, row } = await streamContext(id);
          return createDraft(
            actor,
            row.opportunityId,
            draftCommand.parse({ ...data, inquiryId: row.inquiryId, revision: row.revision }),
            `flue-draft:${id}:${data.kind}`,
          );
        }),
      };
    },
  });
  return initial.instruction;
}
SpecialistStream.agentName = "SpecialistStream";
SpecialistStream.durability = { maxAttempts: 2, timeoutMs: 180000 };
