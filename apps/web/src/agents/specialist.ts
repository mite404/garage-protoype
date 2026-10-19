"use agent";
import { useInitialData, useModel, useTool, type AgentProps } from "@flue/runtime";
import * as v from "valibot";
import { z } from "zod";
import { approvedSalesTool, draftCommand } from "@signal-desk/contracts/assistance-schema";
import { createDraft, renderCardCall } from "../server/assistance";
import { proposeSourcingFact, renderSourcingCard, sourcingView } from "../server/sourcing";
import { streamContext } from "../server/streaming";
import { AppError } from "../server/errors";

const seed = z.object({ instruction: z.string() });

// Each turn has exactly one subject; tools for the other subject refuse rather than guess.
const dealOnly = () => {
  throw new AppError(409, "WRONG_SUBJECT", "This tool applies to deal conversations only.");
};
const sourcingOnly = () => {
  throw new AppError(409, "WRONG_SUBJECT", "This tool applies to sourcing cases only.");
};

/** Assists one authorized specialist turn with evidence cards, unsent drafts and unapproved
 * sourcing proposals only. */
export function SpecialistStream({ id }: AgentProps) {
  const initial = seed.parse(useInitialData());
  useModel("signal-desk/moonshotai/kimi-k3", { compaction: false });
  useTool({
    name: approvedSalesTool.enum.show_card,
    description:
      'Show a complete reference-only card. Deals: {tool:"review"|"answer"|"handoff",props:{inquiryId}} with the current inquiry ID, or {tool:"draft",props:{draftId}} with the ID returned by prepare_draft. Sourcing cases: {tool:"source_change"|"fit"|"information_request"|"reply_review"|"decision",props:{}}. Never supply factual values or invent IDs.',
    input: v.strictObject({
      tool: v.picklist(["review", "answer", "handoff", "draft", ...sourcingView.options]),
      props: v.union([
        v.strictObject({ inquiryId: v.string() }),
        v.strictObject({ draftId: v.string() }),
        v.strictObject({}),
      ]),
    }),
    run: async ({ data, toolCallId }) => {
      const { actor, row } = await streamContext(id);
      if (row.sourcingCaseId)
        return {
          output: await renderSourcingCard(actor, row.sourcingCaseId, id, toolCallId, data.tool),
        };
      return {
        output: await renderCardCall(actor, row.opportunityId ?? dealOnly(), id, toolCallId, data),
      };
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
            row.opportunityId ?? dealOnly(),
            draftCommand.parse({ ...data, inquiryId: row.inquiryId, revision: row.revision }),
            `flue-draft:${id}:${data.kind}`,
          );
        }),
      };
    },
  });
  useTool({
    name: approvedSalesTool.enum.propose_fact,
    description:
      "Sourcing cases only. Propose one answer read from an original reply or note in the case record, citing its id as sourceRef. field is saleStatus (available|maybe_later|not_selling), authority (who can authorize), heightIn, priceCents, transportCents or feesCents (whole numbers). The proposal stays unapproved until the specialist accepts it.",
    input: v.strictObject({
      sourceRef: v.string(),
      field: v.picklist([
        "saleStatus",
        "authority",
        "heightIn",
        "priceCents",
        "transportCents",
        "feesCents",
      ]),
      value: v.union([v.string(), v.number()]),
    }),
    durable: true,
    run: async ({ data, step }) => {
      await streamContext(id);
      return {
        output: await step.do("propose-fact", async () => {
          const { actor, row } = await streamContext(id);
          const factId = await proposeSourcingFact(
            actor,
            row.sourcingCaseId ?? sourcingOnly(),
            row.revision,
            { sourceRef: data.sourceRef, answer: { field: data.field, value: data.value } },
          );
          return { factId, status: "proposed, awaiting specialist review" };
        }),
      };
    },
  });
  return initial.instruction;
}
SpecialistStream.agentName = "SpecialistStream";
SpecialistStream.durability = { maxAttempts: 2, timeoutMs: 180000 };
