import "server-only";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import { z } from "zod";
import { refreshActor, type Actor } from "./access";
import { and, desc, eq, isNull, notExists, notInArray, sql } from "drizzle-orm";
import { orm } from "./db";
import {
  assistanceDrafts,
  cardCalls,
  chatTurns,
  claims,
  evidenceBlockers,
  evidenceReviews,
  identities,
  inquiries as inquiryTable,
  inquiryRouting,
  inquirySuggestions,
  opportunities,
  opportunityDealTerms,
  opportunityMembers,
  publicFacts,
  sources,
  vehicles,
} from "./db-schema";
import { evidenceTransaction, getWorkbench } from "./evidence";
import { parseInput } from "./validation";
import { fieldLabels, fieldSchema } from "@signal-desk/contracts/evidence-schema";
import { getPublicVehicle, getSource } from "./records";
import { AppError } from "./errors";
import { suggestRoute } from "./jev-routing";
import type { Provider } from "./model";
import {
  inquiryInput,
  routeQuestion,
  draftCommand,
  cardCall,
  inlineCard,
  routingSuggestion,
  type RoutingSuggestion,
  type InlineCard,
} from "@signal-desk/contracts/assistance-schema";

const keySchema = z.string().trim().min(1).max(160);
const inquiryRow = z.object({ id: z.string(), input: inquiryInput });
const routingRow = z.object({
  kind: z.enum(["supported", "missing_evidence", "conflict", "human_review", "conditional_offer"]),
  field: fieldSchema.nullable(),
  basis: z.string(),
  revision: z.number(),
});
const blockerRow = z.object({
  id: z.string(),
  question: z.string(),
  assigneeId: z.string(),
  nextAction: z.string(),
});
const draftRow = z.object({
  id: z.string(),
  purpose: z.string(),
  recipientLabel: z.string(),
  body: z.string(),
  basisRevision: z.number(),
});
const turnRow = z.object({ id: z.string(), inquiryId: z.string(), message: z.string() });
const blockerProjection = {
  id: evidenceBlockers.id,
  question: evidenceBlockers.question,
  assigneeId: evidenceBlockers.assignee_id,
  nextAction: evidenceBlockers.next_action,
};
const correction = z
  .object({
    field: fieldSchema.nullable(),
    reason: z.string().trim().min(1).max(2000),
    nextAction: z.string().trim().min(1).max(500),
    revision: z.number().int().min(0),
  })
  .strict();

function sameInput(a: unknown, b: unknown) {
  if (!isDeepStrictEqual(a, b))
    throw new AppError(409, "IDEMPOTENCY_CONFLICT", "This key identifies different input.");
}

async function header(db: PoolClient, opportunityId: string) {
  const result = await orm(db)
    .select({ revision: vehicles.revision, assigneeId: opportunities.assignee_id })
    .from(opportunities)
    .innerJoin(vehicles, eq(vehicles.id, opportunities.vehicle_id))
    .where(eq(opportunities.id, opportunityId));
  return z.object({ revision: z.number(), assigneeId: z.string().nullable() }).parse(result[0]);
}

async function assignee(db: PoolClient, opportunityId: string) {
  const result = await orm(db)
    .select({ id: opportunityMembers.user_id })
    .from(opportunityMembers)
    .innerJoin(identities, eq(identities.userId, opportunityMembers.user_id))
    .innerJoin(opportunities, eq(opportunities.id, opportunityMembers.opportunity_id))
    .where(
      and(
        eq(opportunityMembers.opportunity_id, opportunityId),
        eq(identities.role, "specialist"),
        isNull(identities.revokedAt),
      ),
    )
    .orderBy(
      sql`${eq(opportunityMembers.user_id, opportunities.assignee_id)} desc nulls last`,
      opportunityMembers.user_id,
    )
    .limit(1);
  if (!result.length)
    throw new AppError(409, "ASSIGNEE_REQUIRED", "Assign a current opportunity specialist first.");
  return z.object({ id: z.string() }).parse(result[0]).id;
}

async function answerState(
  db: PoolClient,
  vehicleId: string,
  field: z.infer<typeof fieldSchema> | null,
) {
  if (!field) return { kind: "human_review" as const };
  const published = await getPublicVehicle(vehicleId, db);
  const fact = published.facts.find((f) => f.field === field);
  if (fact) return { kind: "supported" as const, fact };
  const result = await orm(db)
    .select({ n: sql<number>`count(distinct (${claims.value},${claims.unit}))::int` })
    .from(claims)
    .innerJoin(sources, eq(sources.id, claims.source_id))
    .where(
      and(
        eq(claims.vehicle_id, vehicleId),
        eq(claims.field, field),
        eq(sources.audience, "sales"),
        eq(sources.shareable, true),
        notInArray(sources.kind, ["private_note", "inquiry"]),
      ),
    );
  const count = z.object({ n: z.number() }).parse(result[0]).n;
  return { kind: count > 1 ? ("conflict" as const) : ("missing_evidence" as const) };
}

async function ensureBlocker(
  db: PoolClient,
  opportunityId: string,
  inquiryId: string,
  question: string,
  field: string | null,
  nextAction: string,
) {
  const owner = await assignee(db, opportunityId);
  await orm(db)
    .insert(evidenceBlockers)
    .values({
      id: randomUUID(),
      opportunity_id: opportunityId,
      blocker_key: `inquiry:${inquiryId}`,
      question,
      field,
      assignee_id: owner,
      next_action: nextAction,
    })
    .onConflictDoNothing({
      target: [evidenceBlockers.opportunity_id, evidenceBlockers.blocker_key],
    });
  return blockerRow.parse(
    (
      await orm(db)
        .select(blockerProjection)
        .from(evidenceBlockers)
        .where(
          and(
            eq(evidenceBlockers.opportunity_id, opportunityId),
            eq(evidenceBlockers.blocker_key, `inquiry:${inquiryId}`),
          ),
        )
    )[0],
  );
}

// Current proposed deal terms, the reference an incoming offer is read against.
async function dealTermsAmount(db: PoolClient, opportunityId: string) {
  const [terms] = await orm(db)
    .select({ amountCents: opportunityDealTerms.amountCents })
    .from(opportunityDealTerms)
    .where(eq(opportunityDealTerms.opportunityId, opportunityId));
  return terms?.amountCents ?? null;
}

async function readInquiry(db: PoolClient, opportunityId: string, vehicleId: string, id: string) {
  const result = await orm(db)
    .select({ id: inquiryTable.id, input: inquiryTable.input })
    .from(inquiryTable)
    .where(and(eq(inquiryTable.id, id), eq(inquiryTable.opportunity_id, opportunityId)));
  if (!result.length) throw new AppError(404, "NOT_FOUND", "Inquiry not found.");
  const inquiry = inquiryRow.parse(result[0]);
  const history = z.array(routingRow).parse(
    await orm(db)
      .select({
        kind: inquiryRouting.kind,
        field: inquiryRouting.field,
        basis: inquiryRouting.basis,
        revision: inquiryRouting.revision,
      })
      .from(inquiryRouting)
      .where(eq(inquiryRouting.inquiry_id, id))
      .orderBy(desc(inquiryRouting.revision)),
  );
  const routing = history[0];
  if (!routing) throw new AppError(409, "REVIEW_REQUIRED", "Inquiry requires review.");
  const savedSuggestion = await orm(db)
    .select({ suggestion: inquirySuggestions.suggestion })
    .from(inquirySuggestions)
    .where(eq(inquirySuggestions.inquiry_id, id));
  const suggestion = routingSuggestion.optional().parse(savedSuggestion[0]?.suggestion);
  const state = await answerState(db, vehicleId, routing.field);
  const nextAction =
    inquiry.input.kind === "offer"
      ? "Specialist to review stated terms with seller. No offer is accepted."
      : routing.field
        ? "Request and review shareable evidence before preparing a buyer reply."
        : "Clarify the buyer's intent with the assigned specialist.";
  const blocker = await ensureBlocker(
    db,
    opportunityId,
    id,
    inquiry.input.text,
    routing.field,
    nextAction,
  );
  await orm(db)
    .update(evidenceBlockers)
    .set({
      state:
        state.kind === "supported" && inquiry.input.kind !== "offer" ? "resolved" : "needs_review",
    })
    .where(eq(evidenceBlockers.id, blocker.id));
  let card: InlineCard;
  if (inquiry.input.kind === "offer") {
    card = {
      kind: "handoff",
      inquiryId: id,
      amountMinor: inquiry.input.amountMinor,
      currency: inquiry.input.currency,
      termsAmountMinor: await dealTermsAmount(db, opportunityId),
      timingText: inquiry.input.timingText,
      conditions: inquiry.input.conditions,
      unansweredQuestions: inquiry.input.unansweredQuestions,
      assigneeId: blocker.assigneeId,
      nextAction: blocker.nextAction,
      status: "recorded_not_accepted",
    };
  } else if (state.kind === "supported") {
    card = {
      kind: "answer",
      inquiryId: id,
      field: fieldSchema.parse(routing.field),
      value: state.fact.value,
      citation: state.fact.citation,
    };
  } else {
    card = {
      kind: "review",
      inquiryId: id,
      state: state.kind === "missing_evidence" ? "unknown" : state.kind,
      ...blocker,
      blockerId: blocker.id,
      routingRevision: routing.revision,
      suggestion: routing.field === null ? suggestion : undefined,
    };
  }
  return {
    ...inquiry,
    suggestion,
    classification: inquiry.input.kind === "offer" ? "conditional_offer" : state.kind,
    history,
    card: inlineCard.parse(card),
  };
}

async function insertInquiry(
  db: PoolClient,
  actor: Actor,
  opportunityId: string,
  vehicleId: string,
  input: z.infer<typeof inquiryInput>,
  key: string,
  suggestion: RoutingSuggestion | null,
) {
  await orm(db).execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`inquiry:${actor.userId}:${key}`},0))`,
  );
  const prior = await orm(db)
    .select({
      id: inquiryTable.id,
      input: inquiryTable.input,
      opportunity_id: inquiryTable.opportunity_id,
    })
    .from(inquiryTable)
    .where(and(eq(inquiryTable.actor_id, actor.userId), eq(inquiryTable.request_key, key)));
  if (prior.length) {
    const row = z
      .object({ id: z.string(), input: inquiryInput, opportunity_id: z.string() })
      .parse(prior[0]);
    sameInput({ input, opportunityId }, { input: row.input, opportunityId: row.opportunity_id });
    return row.id;
  }
  const id = randomUUID();
  const field =
    input.kind === "fact"
      ? input.field
      : input.kind === "question"
        ? routeQuestion(input.text)
        : null;
  const state = await answerState(db, vehicleId, field);
  await orm(db)
    .insert(inquiryTable)
    .values({ id, opportunity_id: opportunityId, actor_id: actor.userId, request_key: key, input });
  if (suggestion) await orm(db).insert(inquirySuggestions).values({ inquiry_id: id, suggestion });
  await orm(db)
    .insert(inquiryRouting)
    .values({
      id: randomUUID(),
      inquiry_id: id,
      actor_id: actor.userId,
      kind: input.kind === "offer" ? "conditional_offer" : state.kind,
      field,
      revision: 0,
      basis:
        input.kind === "offer"
          ? "Buyer explicitly supplied structured offer terms; recorded, not accepted."
          : field
            ? "Exact single-field request; answer checked against current approved public evidence."
            : "Intent is outside the bounded question catalog. Human interpretation required.",
    });
  return id;
}

/** Records an inquiry; unmatched specialist questions may receive advisory routing, never sending.
 * @throws {AppError} For denied access, invalid terms, idempotency conflicts or missing assignee.
 */
export async function submitInquiry(
  actor: Actor,
  opportunityId: string,
  raw: unknown,
  requestKey: string,
  provider?: Provider,
) {
  const input = parseInput(inquiryInput, raw);
  const key = parseInput(keySchema, requestKey);
  const suggestion =
    input.kind === "question"
      ? await suggestRoute(actor, opportunityId, input.text, key, provider)
      : null;
  return evidenceTransaction(
    actor,
    opportunityId,
    async (db, vehicleId) => {
      const id = await insertInquiry(db, actor, opportunityId, vehicleId, input, key, suggestion);
      const inquiry = await readInquiry(db, opportunityId, vehicleId, id);
      await orm(db)
        .update(opportunities)
        .set({
          assignee_id: await assignee(db, opportunityId),
          next_action:
            inquiry.card.kind === "answer"
              ? "Review the cited answer. No message has been sent."
              : "nextAction" in inquiry.card
                ? inquiry.card.nextAction
                : "Review inquiry",
        })
        .where(eq(opportunities.id, opportunityId));
      return actor.role === "buyer" ? buyerInquiry(inquiry) : inquiry;
    },
    actor.role,
  );
}

async function readDrafts(db: PoolClient, opportunityId: string, revision: number) {
  const drafts = z.array(draftRow).parse(
    await orm(db)
      .select({
        id: assistanceDrafts.id,
        purpose: assistanceDrafts.purpose,
        recipientLabel: assistanceDrafts.recipient_label,
        body: assistanceDrafts.body,
        basisRevision: assistanceDrafts.basis_revision,
      })
      .from(assistanceDrafts)
      .where(eq(assistanceDrafts.opportunity_id, opportunityId))
      .orderBy(assistanceDrafts.created_at, assistanceDrafts.id),
  );
  return drafts.map((d) =>
    inlineCard.parse({
      kind: "draft",
      draftId: d.id,
      purpose: d.purpose,
      recipientLabel: d.recipientLabel,
      body: d.body,
      status: "unsent",
      reviewState: d.basisRevision === revision ? "current" : "stale",
    }),
  );
}

function buyerInquiry(
  inquiry: Awaited<ReturnType<typeof readInquiry>>,
): Omit<Awaited<ReturnType<typeof readInquiry>>, "suggestion"> {
  const { suggestion: _suggestion, ...visible } = inquiry;
  // Buyers see their own offer, not the specialist's comparison against current deal terms.
  const card =
    inquiry.card.kind === "review"
      ? (({ suggestion: _cardSuggestion, ...review }) => review)(inquiry.card)
      : inquiry.card.kind === "handoff"
        ? { ...inquiry.card, termsAmountMinor: null }
        : inquiry.card;
  return {
    ...visible,
    history: [],
    card:
      card.kind === "review"
        ? {
            ...card,
            nextAction:
              "An assigned specialist will review the evidence and clarify the next step.",
          }
        : card,
  };
}

async function readTurns(db: PoolClient, actor: Actor, opportunityId: string, vehicleId: string) {
  const turns = z.array(turnRow).parse(
    await orm(db)
      .select({ id: chatTurns.id, inquiryId: chatTurns.inquiry_id, message: chatTurns.message })
      .from(chatTurns)
      .where(and(eq(chatTurns.opportunity_id, opportunityId), eq(chatTurns.actor_id, actor.userId)))
      .orderBy(chatTurns.created_at, chatTurns.id),
  );
  const resolved = [];
  for (const turn of turns) {
    const calls = z
      .array(
        z.object({
          input: z.unknown(),
          status: z.enum(["accepted", "malformed", "retired", "unavailable"]),
        }),
      )
      .parse(
        await orm(db)
          .select({ input: cardCalls.input, status: cardCalls.status })
          .from(cardCalls)
          .where(eq(cardCalls.turn_id, turn.id))
          .orderBy(cardCalls.call_id),
      );
    const cards: InlineCard[] = [];
    for (const call of calls) {
      if (call.status !== "accepted") continue;
      const card = await resolveCard(db, opportunityId, vehicleId, cardCall.parse(call.input));
      if (card) cards.push(card);
    }
    resolved.push({ ...turn, cards, statuses: calls.map((c) => c.status) });
  }
  return resolved;
}

/** Revalidates answers on every read; buyer projections never contain specialist drafts or routing notes.
 * @throws {AppError} For revoked access or cross-buyer records.
 */
export async function getAssistance(actor: Actor, opportunityId: string) {
  return evidenceTransaction(
    actor,
    opportunityId,
    async (db, vehicleId) => {
      const ids = z.array(z.object({ id: z.string() })).parse(
        await orm(db)
          .select({ id: inquiryTable.id })
          .from(inquiryTable)
          .where(
            and(
              eq(inquiryTable.opportunity_id, opportunityId),
              actor.role === "specialist"
                ? undefined
                : notExists(
                    orm(db)
                      .select({ id: chatTurns.id })
                      .from(chatTurns)
                      .where(eq(chatTurns.inquiry_id, inquiryTable.id)),
                  ),
            ),
          )
          .orderBy(inquiryTable.created_at, inquiryTable.id),
      );
      const inquiries = [];
      for (const i of ids) inquiries.push(await readInquiry(db, opportunityId, vehicleId, i.id));
      const h = await header(db, opportunityId);
      const turns =
        actor.role === "specialist" ? await readTurns(db, actor, opportunityId, vehicleId) : [];
      return {
        opportunityId,
        vehicleId,
        revision: h.revision,
        inquiries: inquiries.map((q) => (actor.role === "specialist" ? q : buyerInquiry(q))),
        drafts: actor.role === "specialist" ? await readDrafts(db, opportunityId, h.revision) : [],
        turns,
      };
    },
    actor.role,
    "read",
  );
}

async function appendRouting(
  db: PoolClient,
  actor: Actor,
  opportunityId: string,
  vehicleId: string,
  inquiry: Awaited<ReturnType<typeof readInquiry>>,
  input: z.infer<typeof correction>,
) {
  const id = inquiry.id;
  if (inquiry.history[0]?.revision !== input.revision)
    throw new AppError(412, "STALE_REVIEW", "Routing changed. Reload before correcting.");
  if (inquiry.input.kind === "offer")
    throw new AppError(
      409,
      "REVIEW_REQUIRED",
      "Preserve the explicit offer terms; request a new buyer clarification instead.",
    );
  const state = await answerState(db, vehicleId, input.field);
  await orm(db)
    .insert(inquiryRouting)
    .values({
      id: randomUUID(),
      inquiry_id: id,
      actor_id: actor.userId,
      kind: state.kind,
      field: input.field,
      basis: input.reason,
      revision: input.revision + 1,
    });
  await ensureBlocker(db, opportunityId, id, inquiry.input.text, input.field, input.nextAction);
  await orm(db)
    .update(evidenceBlockers)
    .set({ field: input.field, next_action: input.nextAction })
    .where(
      and(
        eq(evidenceBlockers.opportunity_id, opportunityId),
        eq(evidenceBlockers.blocker_key, `inquiry:${id}`),
      ),
    );
  await orm(db)
    .update(opportunities)
    .set({ next_action: input.nextAction })
    .where(eq(opportunities.id, opportunityId));
  return { id, revision: input.revision + 1 };
}

/** Reads only the current evidence revision, with the same access checks and shared locks as
 * getAssistance, for staleness checks that do not need inquiries, turns or drafts.
 * @throws {AppError} For revoked access or an inaccessible record.
 */
export async function getAssistanceRevision(actor: Actor, opportunityId: string) {
  return evidenceTransaction(
    actor,
    opportunityId,
    async (db) => (await header(db, opportunityId)).revision,
    actor.role,
    "read",
  );
}

/** Appends a specialist routing correction without rewriting input or converting prose into an offer.
 * @throws {AppError} For stale corrections, invalid fields or denied access.
 */
export async function correctInquiry(
  actor: Actor,
  opportunityId: string,
  id: string,
  raw: unknown,
) {
  const input = parseInput(correction, raw);
  return evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    const inquiry = await readInquiry(db, opportunityId, vehicleId, id);
    return appendRouting(db, actor, opportunityId, vehicleId, inquiry, input);
  });
}

/** Records a specialist's acceptance of an advisory field without approving evidence.
 * @throws {AppError} For stale routing, absent suggestions, already-routed inquiries or denied access.
 */
export async function acceptSuggestion(
  actor: Actor,
  opportunityId: string,
  inquiryId: string,
  revision: number,
) {
  const expected = parseInput(z.number().int().min(0), revision);
  return evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    const inquiry = await readInquiry(db, opportunityId, vehicleId, inquiryId);
    if (inquiry.history[0]?.revision !== expected)
      throw new AppError(412, "STALE_REVIEW", "Routing changed. Reload before accepting.");
    const suggestion = inquiry.suggestion;
    if (suggestion?.state !== "suggested" || inquiry.history[0]?.field !== null)
      throw new AppError(409, "REVIEW_REQUIRED", "No pending field suggestion is available.");
    return appendRouting(db, actor, opportunityId, vehicleId, inquiry, {
      field: suggestion.field,
      reason: `Specialist accepted Jev suggestion: ${fieldLabels[suggestion.field]} (confidence ${suggestion.confidence.toFixed(2)}, ${suggestion.modelVersion}).`,
      nextAction: "Request and review shareable evidence before preparing a buyer reply.",
      revision: expected,
    });
  });
}

async function inquiryDraft(
  db: PoolClient,
  opportunityId: string,
  vehicleId: string,
  input: Exclude<z.infer<typeof draftCommand>, { kind: "photo_request" }>,
) {
  const inquiry = await readInquiry(db, opportunityId, vehicleId, input.inquiryId);
  const blocker = blockerRow.parse(
    (
      await orm(db)
        .select(blockerProjection)
        .from(evidenceBlockers)
        .where(
          and(
            eq(evidenceBlockers.opportunity_id, opportunityId),
            eq(evidenceBlockers.blocker_key, `inquiry:${inquiry.id}`),
          ),
        )
    )[0],
  );
  if (input.kind === "seller_request")
    return {
      blockerId: blocker.id,
      reviewId: null,
      recipientLabel: "Vehicle seller (recipient to be confirmed)",
      body: `Please provide permissioned evidence for this buyer question:\n${inquiry.input.text}\nThe specialist will review any response before preparing a buyer reply. No delivery or commercial commitment is requested.`,
    };
  const result = await orm(db)
    .select({ review_id: publicFacts.review_id })
    .from(publicFacts)
    .innerJoin(evidenceReviews, eq(evidenceReviews.id, publicFacts.review_id))
    .innerJoin(claims, eq(claims.id, evidenceReviews.claim_id))
    .innerJoin(sources, eq(sources.id, claims.source_id))
    .where(
      and(
        eq(publicFacts.vehicle_id, vehicleId),
        sql`${publicFacts.field} = ${inquiry.history[0]?.field ?? null}`,
        eq(sources.blocker_id, blocker.id),
        eq(sources.kind, "seller_response"),
        eq(sources.shareable, true),
        eq(sources.audience, "sales"),
      ),
    );
  if (inquiry.card.kind !== "answer" || !result.length)
    throw new AppError(
      409,
      "REVIEW_REQUIRED",
      "A reviewed, shareable response linked to this question is required.",
    );
  return {
    blockerId: blocker.id,
    reviewId: z.object({ review_id: z.string() }).parse(result[0]).review_id,
    recipientLabel: "Opportunity buyer (recipient to be confirmed)",
    body: `Regarding: ${inquiry.input.text}\n${inquiry.card.value}\n${inquiry.card.citation.sourceLabel}: ${inquiry.card.citation.excerpt}\nUnsent draft for specialist review. Other offer conditions and timing remain unresolved.`,
  };
}

/** Saves an unsent seller request, reviewed cited follow-up or edited photo request at the current evidence revision.
 * @throws {AppError} For stale evidence, unsupported follow-up, denied references or key conflicts.
 */
export async function createDraft(
  actor: Actor,
  opportunityId: string,
  raw: unknown,
  requestKey: string,
) {
  const input = parseInput(draftCommand, raw);
  const key = parseInput(keySchema, requestKey);
  const workbench =
    input.kind === "photo_request" ? await getWorkbench(actor, opportunityId) : null;
  return evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    const h = await header(db, opportunityId);
    await orm(db).execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`draft:${actor.userId}:${key}`},0))`,
    );
    const prior = await orm(db)
      .select({
        id: assistanceDrafts.id,
        input: assistanceDrafts.input,
        opportunity_id: assistanceDrafts.opportunity_id,
      })
      .from(assistanceDrafts)
      .where(
        and(eq(assistanceDrafts.actor_id, actor.userId), eq(assistanceDrafts.request_key, key)),
      );
    if (prior.length) {
      const row = z
        .object({ id: z.string(), input: z.unknown(), opportunity_id: z.string() })
        .parse(prior[0]);
      sameInput({ input, opportunityId }, { input: row.input, opportunityId: row.opportunity_id });
      const drafts = await readDrafts(db, opportunityId, h.revision);
      return inlineCard.options[3].parse(
        drafts.find((d) => d.kind === "draft" && d.draftId === row.id),
      );
    }
    if (h.revision !== input.revision || (workbench && workbench.revision !== h.revision))
      throw new AppError(412, "STALE_REVIEW", "Evidence changed. Reload before saving the draft.");
    if (workbench)
      for (const sourceId of workbench.photoRequest.evidenceSourceIds)
        await getSource(actor, sourceId, db);
    const draft =
      input.kind === "photo_request"
        ? {
            blockerId: null,
            reviewId: null,
            recipientLabel: input.recipientLabel,
            body: input.body,
          }
        : await inquiryDraft(db, opportunityId, vehicleId, input);
    const id = randomUUID();
    await orm(db)
      .insert(assistanceDrafts)
      .values({
        id,
        opportunity_id: opportunityId,
        actor_id: actor.userId,
        request_key: key,
        input,
        purpose: input.kind,
        recipient_label: draft.recipientLabel,
        body: draft.body,
        basis_revision: h.revision,
        blocker_id: draft.blockerId,
        review_id: draft.reviewId,
        evidence_basis: workbench?.photoRequest ?? {
          inquiryId: input.kind !== "photo_request" ? input.inquiryId : null,
          blockerId: draft.blockerId,
          reviewId: draft.reviewId,
        },
      });
    return inlineCard.options[3].parse({
      kind: "draft",
      draftId: id,
      purpose: input.kind,
      recipientLabel: draft.recipientLabel,
      body: draft.body,
      status: "unsent",
      reviewState: "current",
    });
  });
}

/** Persists a specialist turn with advisory routing computed before the inquiry transaction.
 * Jev may suggest a field; routing awaits human acceptance. Retries reuse the inference report.
 * @throws {AppError} For denied access, invalid text or key conflicts.
 */
export async function beginChatTurn(
  actor: Actor,
  opportunityId: string,
  raw: unknown,
  requestKey: string,
  provider?: Provider,
) {
  const message = parseInput(z.string().trim().min(1).max(2000), raw);
  const key = parseInput(keySchema, requestKey);
  const suggestion = await suggestRoute(actor, opportunityId, message, `chat:${key}`, provider);
  return evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    await orm(db).execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`turn:${actor.userId}:${key}`},0))`,
    );
    const prior = await orm(db)
      .select({
        id: chatTurns.id,
        inquiryId: chatTurns.inquiry_id,
        message: chatTurns.message,
        opportunity_id: chatTurns.opportunity_id,
      })
      .from(chatTurns)
      .where(and(eq(chatTurns.actor_id, actor.userId), eq(chatTurns.request_key, key)));
    if (prior.length) {
      const turn = turnRow.extend({ opportunity_id: z.string() }).parse(prior[0]);
      sameInput(
        { message, opportunityId },
        { message: turn.message, opportunityId: turn.opportunity_id },
      );
      return { id: turn.id, inquiryId: turn.inquiryId, message };
    }
    const inquiryId = await insertInquiry(
      db,
      actor,
      opportunityId,
      vehicleId,
      { kind: "question", text: message },
      `chat:${key}`,
      suggestion,
    );
    await readInquiry(db, opportunityId, vehicleId, inquiryId);
    const id = randomUUID();
    await orm(db).insert(chatTurns).values({
      id,
      opportunity_id: opportunityId,
      actor_id: actor.userId,
      request_key: key,
      message,
      inquiry_id: inquiryId,
    });
    return { id, inquiryId, message };
  });
}

async function resolveCard(
  db: PoolClient,
  opportunityId: string,
  vehicleId: string,
  call: z.infer<typeof cardCall>,
): Promise<InlineCard | null> {
  if (call.tool === "draft") {
    const h = await header(db, opportunityId);
    return (
      (await readDrafts(db, opportunityId, h.revision)).find(
        (d) => d.kind === "draft" && d.draftId === call.props.draftId,
      ) ?? null
    );
  }
  const exists = await orm(db)
    .select({ id: inquiryTable.id })
    .from(inquiryTable)
    .where(
      and(
        eq(inquiryTable.id, call.props.inquiryId),
        eq(inquiryTable.opportunity_id, opportunityId),
      ),
    );
  if (!exists.length) return null;
  const inquiry = await readInquiry(db, opportunityId, vehicleId, call.props.inquiryId);
  return inquiry.card.kind === call.tool ? inquiry.card : null;
}

/** Validates only inline presentation calls. Two distinct malformed calls retire one tool for this turn.
 * Retries reuse call IDs and counts survive process restarts. Business failures never count as malformed props.
 * @throws {AppError} For denied turn access or call-ID payload conflicts.
 */
export async function renderCardCall(
  actor: Actor,
  opportunityId: string,
  turnId: string,
  rawCallId: string,
  raw: unknown,
) {
  const callId = parseInput(keySchema, rawCallId);
  const envelope = parseInput(z.object({ tool: z.string().min(1).max(80) }).passthrough(), raw);
  return evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    const turn = await orm(db)
      .select({ id: chatTurns.id })
      .from(chatTurns)
      .where(
        and(
          eq(chatTurns.id, turnId),
          eq(chatTurns.opportunity_id, opportunityId),
          eq(chatTurns.actor_id, actor.userId),
        ),
      );
    if (!turn.length) throw new AppError(404, "NOT_FOUND", "Turn not found.");
    const prior = await orm(db)
      .select({ input: cardCalls.input, status: cardCalls.status })
      .from(cardCalls)
      .where(and(eq(cardCalls.turn_id, turnId), eq(cardCalls.call_id, callId)));
    const parsed = cardCall.safeParse(envelope);
    if (prior.length) {
      const row = z
        .object({
          input: z.unknown(),
          status: z.enum(["accepted", "malformed", "retired", "unavailable"]),
        })
        .parse(prior[0]);
      sameInput(row.input, envelope);
      const card =
        row.status === "accepted" && parsed.success
          ? await resolveCard(db, opportunityId, vehicleId, parsed.data)
          : null;
      return { status: row.status, card };
    }
    const count = z.object({ n: z.number() }).parse(
      (
        await orm(db)
          .select({ n: sql<number>`count(*)::int` })
          .from(cardCalls)
          .where(
            and(
              eq(cardCalls.turn_id, turnId),
              eq(cardCalls.tool, envelope.tool),
              eq(cardCalls.status, "malformed"),
            ),
          )
      )[0],
    ).n;
    const card =
      count < 2 && parsed.success
        ? await resolveCard(db, opportunityId, vehicleId, parsed.data)
        : null;
    const status =
      count >= 2
        ? ("retired" as const)
        : !parsed.success
          ? ("malformed" as const)
          : card
            ? ("accepted" as const)
            : ("unavailable" as const);
    await orm(db)
      .insert(cardCalls)
      .values({ turn_id: turnId, call_id: callId, tool: envelope.tool, input: envelope, status });
    return { status, card };
  });
}

/** Lists only this invited buyer's opportunities for a vehicle, without private sales context.
 * @throws {AppError} For revoked identity or a non-buyer actor.
 */
export async function listBuyerConversations(actor: Actor, vehicleId: string) {
  const current = await refreshActor(actor);
  if (current.role !== "buyer")
    throw new AppError(403, "FORBIDDEN", "Sign in with an invited buyer account.");
  return z.array(z.object({ id: z.string() })).parse(
    await orm()
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(eq(opportunities.vehicle_id, vehicleId), eq(opportunities.buyer_id, current.userId)),
      )
      .orderBy(opportunities.id),
  );
}
