import "server-only";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import { z } from "zod";
import { refreshActor, type Actor } from "./access";
import { database } from "./db";
import { evidenceTransaction, getWorkbench, parseEvidence } from "./evidence";
import { fieldSchema } from "./evidence-schema";
import { getPublicVehicle, getSource } from "./records";
import { AppError } from "./errors";
import {
  cardCall,
  inlineCard,
  inquiryInput,
  routeQuestion,
  type InlineCard,
} from "./assistance-schema";

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
const correction = z
  .object({
    field: fieldSchema.nullable(),
    reason: z.string().trim().min(1).max(2000),
    nextAction: z.string().trim().min(1).max(500),
    revision: z.number().int().min(0),
  })
  .strict();
const draftCommand = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("seller_request"),
      inquiryId: keySchema,
      revision: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("buyer_followup"),
      inquiryId: keySchema,
      revision: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("photo_request"),
      revision: z.number().int().min(0),
      recipientLabel: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(10000),
    })
    .strict(),
]);

function sameInput(a: unknown, b: unknown) {
  if (!isDeepStrictEqual(a, b))
    throw new AppError(409, "IDEMPOTENCY_CONFLICT", "This key identifies different input.");
}

async function header(db: PoolClient, opportunityId: string) {
  const result = await db.query(
    `select v.revision,o.assignee_id as "assigneeId" from signal_desk.opportunities o
    join signal_desk.vehicles v on v.id=o.vehicle_id where o.id=$1`,
    [opportunityId],
  );
  return z
    .object({ revision: z.number(), assigneeId: z.string().nullable() })
    .parse(result.rows[0]);
}

async function assignee(db: PoolClient, opportunityId: string) {
  const result = await db.query(
    `select m.user_id as id from signal_desk.opportunity_members m
    join signal_desk.identities i on i.user_id=m.user_id join signal_desk.opportunities o on o.id=m.opportunity_id
    where m.opportunity_id=$1 and i.role='specialist' and i.revoked_at is null
    order by (m.user_id=o.assignee_id) desc nulls last,m.user_id limit 1`,
    [opportunityId],
  );
  if (!result.rowCount)
    throw new AppError(409, "ASSIGNEE_REQUIRED", "Assign a current opportunity specialist first.");
  return z.object({ id: z.string() }).parse(result.rows[0]).id;
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
  const result = await db.query(
    `select count(distinct (c.value,c.unit))::int as n from signal_desk.claims c
    join signal_desk.sources s on s.id=c.source_id where c.vehicle_id=$1 and c.field=$2
    and s.audience='sales' and s.shareable and s.kind not in ('private_note','inquiry')`,
    [vehicleId, field],
  );
  const count = z.object({ n: z.number() }).parse(result.rows[0]).n;
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
  await db.query(
    `insert into signal_desk.evidence_blockers(id,opportunity_id,blocker_key,question,field,assignee_id,next_action)
    values ($1,$2,$3,$4,$5,$6,$7) on conflict(opportunity_id,blocker_key) do nothing`,
    [randomUUID(), opportunityId, `inquiry:${inquiryId}`, question, field, owner, nextAction],
  );
  return blockerRow.parse(
    (
      await db.query(
        `select id,question,assignee_id as "assigneeId",next_action as "nextAction"
    from signal_desk.evidence_blockers where opportunity_id=$1 and blocker_key=$2`,
        [opportunityId, `inquiry:${inquiryId}`],
      )
    ).rows[0],
  );
}

async function readInquiry(db: PoolClient, opportunityId: string, vehicleId: string, id: string) {
  const result = await db.query(
    "select id,input from signal_desk.inquiries where id=$1 and opportunity_id=$2",
    [id, opportunityId],
  );
  if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Inquiry not found.");
  const inquiry = inquiryRow.parse(result.rows[0]);
  const history = z.array(routingRow).parse(
    (
      await db.query(
        `select kind,field,basis,revision from signal_desk.inquiry_routing
    where inquiry_id=$1 order by revision desc`,
        [id],
      )
    ).rows,
  );
  const routing = history[0];
  if (!routing) throw new AppError(409, "REVIEW_REQUIRED", "Inquiry requires review.");
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
  await db.query("update signal_desk.evidence_blockers set state=$2 where id=$1", [
    blocker.id,
    state.kind === "supported" && inquiry.input.kind !== "offer" ? "resolved" : "needs_review",
  ]);
  let card: InlineCard;
  if (inquiry.input.kind === "offer") {
    card = {
      kind: "handoff",
      inquiryId: id,
      amountMinor: inquiry.input.amountMinor,
      currency: inquiry.input.currency,
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
    };
  }
  return {
    ...inquiry,
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
) {
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    `inquiry:${actor.userId}:${key}`,
  ]);
  const prior = await db.query(
    "select id,input,opportunity_id from signal_desk.inquiries where actor_id=$1 and request_key=$2",
    [actor.userId, key],
  );
  if (prior.rowCount) {
    const row = z
      .object({ id: z.string(), input: inquiryInput, opportunity_id: z.string() })
      .parse(prior.rows[0]);
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
  await db.query(
    "insert into signal_desk.inquiries(id,opportunity_id,actor_id,request_key,input) values ($1,$2,$3,$4,$5)",
    [id, opportunityId, actor.userId, key, JSON.stringify(input)],
  );
  await db.query(
    `insert into signal_desk.inquiry_routing(id,inquiry_id,actor_id,kind,field,basis,revision) values ($1,$2,$3,$4,$5,$6,0)`,
    [
      randomUUID(),
      id,
      actor.userId,
      input.kind === "offer" ? "conditional_offer" : state.kind,
      field,
      input.kind === "offer"
        ? "Buyer explicitly supplied structured offer terms; recorded, not accepted."
        : field
          ? "Exact single-field request; answer checked against current approved public evidence."
          : "Intent is outside the bounded question catalog. Human interpretation required.",
    ],
  );
  return id;
}

/** Records a question or explicit offer on an existing permitted opportunity, without inference or sending.
 * @throws {AppError} For denied access, invalid terms, idempotency conflicts or missing assignee.
 */
export async function submitInquiry(
  actor: Actor,
  opportunityId: string,
  raw: unknown,
  requestKey: string,
) {
  const input = parseEvidence(inquiryInput, raw);
  const key = parseEvidence(keySchema, requestKey);
  return evidenceTransaction(
    actor,
    opportunityId,
    async (db, vehicleId) => {
      const id = await insertInquiry(db, actor, opportunityId, vehicleId, input, key);
      const inquiry = await readInquiry(db, opportunityId, vehicleId, id);
      await db.query(
        "update signal_desk.opportunities set assignee_id=$2,next_action=$3 where id=$1",
        [
          opportunityId,
          await assignee(db, opportunityId),
          inquiry.card.kind === "answer"
            ? "Review the cited answer. No message has been sent."
            : "nextAction" in inquiry.card
              ? inquiry.card.nextAction
              : "Review inquiry",
        ],
      );
      return actor.role === "buyer" ? buyerInquiry(inquiry) : inquiry;
    },
    actor.role,
  );
}

async function readDrafts(db: PoolClient, opportunityId: string, revision: number) {
  const drafts = z.array(draftRow).parse(
    (
      await db.query(
        `select id,purpose,recipient_label as "recipientLabel",body,basis_revision as "basisRevision"
    from signal_desk.assistance_drafts where opportunity_id=$1 order by created_at,id`,
        [opportunityId],
      )
    ).rows,
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

function buyerInquiry(inquiry: Awaited<ReturnType<typeof readInquiry>>) {
  return {
    ...inquiry,
    history: [],
    card:
      inquiry.card.kind === "review"
        ? {
            ...inquiry.card,
            nextAction:
              "An assigned specialist will review the evidence and clarify the next step.",
          }
        : inquiry.card,
  };
}

async function readTurns(db: PoolClient, actor: Actor, opportunityId: string, vehicleId: string) {
  const turns = z.array(turnRow).parse(
    (
      await db.query(
        `select id,inquiry_id as "inquiryId",message from signal_desk.chat_turns
    where opportunity_id=$1 and actor_id=$2 order by created_at,id`,
        [opportunityId, actor.userId],
      )
    ).rows,
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
        (
          await db.query(
            "select input,status from signal_desk.card_calls where turn_id=$1 order by call_id",
            [turn.id],
          )
        ).rows,
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
        (
          await db.query(
            `select q.id from signal_desk.inquiries q where q.opportunity_id=$1
              and ($2='specialist' or not exists(select 1 from signal_desk.chat_turns t where t.inquiry_id=q.id)) order by q.created_at,q.id`,
            [opportunityId, actor.role],
          )
        ).rows,
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
  );
}

/** Appends a specialist routing correction without rewriting input or converting ambiguous prose into an offer.
 * @throws {AppError} For stale corrections, invalid fields or denied access.
 */
export async function correctInquiry(
  actor: Actor,
  opportunityId: string,
  id: string,
  raw: unknown,
) {
  const input = parseEvidence(correction, raw);
  return evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    const inquiry = await readInquiry(db, opportunityId, vehicleId, id);
    if (inquiry.history[0]?.revision !== input.revision)
      throw new AppError(412, "STALE_REVIEW", "Routing changed. Reload before correcting.");
    if (inquiry.input.kind === "offer")
      throw new AppError(
        409,
        "REVIEW_REQUIRED",
        "Preserve the explicit offer terms; request a new buyer clarification instead.",
      );
    const state = await answerState(db, vehicleId, input.field);
    await db.query(
      `insert into signal_desk.inquiry_routing(id,inquiry_id,actor_id,kind,field,basis,revision) values ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), id, actor.userId, state.kind, input.field, input.reason, input.revision + 1],
    );
    await ensureBlocker(db, opportunityId, id, inquiry.input.text, input.field, input.nextAction);
    await db.query(
      `update signal_desk.evidence_blockers set field=$3,next_action=$4
      where opportunity_id=$1 and blocker_key=$2`,
      [opportunityId, `inquiry:${id}`, input.field, input.nextAction],
    );
    await db.query("update signal_desk.opportunities set next_action=$2 where id=$1", [
      opportunityId,
      input.nextAction,
    ]);
    return { id, revision: input.revision + 1 };
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
      await db.query(
        `select id,question,assignee_id as "assigneeId",next_action as "nextAction" from signal_desk.evidence_blockers where opportunity_id=$1 and blocker_key=$2`,
        [opportunityId, `inquiry:${inquiry.id}`],
      )
    ).rows[0],
  );
  if (input.kind === "seller_request")
    return {
      blockerId: blocker.id,
      reviewId: null,
      recipientLabel: "Vehicle seller (recipient to be confirmed)",
      body: `Please provide permissioned evidence for this buyer question:\n${inquiry.input.text}\nThe specialist will review any response before preparing a buyer reply. No delivery or commercial commitment is requested.`,
    };
  const result = await db.query(
    `select f.review_id from signal_desk.public_facts f
    join signal_desk.evidence_reviews r on r.id=f.review_id join signal_desk.claims c on c.id=r.claim_id
    join signal_desk.sources s on s.id=c.source_id
    where f.vehicle_id=$1 and f.field=$2 and s.blocker_id=$3 and s.kind='seller_response' and s.shareable and s.audience='sales'`,
    [vehicleId, inquiry.history[0]?.field, blocker.id],
  );
  if (inquiry.card.kind !== "answer" || !result.rowCount)
    throw new AppError(
      409,
      "REVIEW_REQUIRED",
      "A reviewed, shareable response linked to this question is required.",
    );
  return {
    blockerId: blocker.id,
    reviewId: z.object({ review_id: z.string() }).parse(result.rows[0]).review_id,
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
  const input = parseEvidence(draftCommand, raw);
  const key = parseEvidence(keySchema, requestKey);
  const workbench =
    input.kind === "photo_request" ? await getWorkbench(actor, opportunityId) : null;
  return evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    const h = await header(db, opportunityId);
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `draft:${actor.userId}:${key}`,
    ]);
    const prior = await db.query(
      `select id,input,opportunity_id from signal_desk.assistance_drafts where actor_id=$1 and request_key=$2`,
      [actor.userId, key],
    );
    if (prior.rowCount) {
      const row = z
        .object({ id: z.string(), input: z.unknown(), opportunity_id: z.string() })
        .parse(prior.rows[0]);
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
    await db.query(
      `insert into signal_desk.assistance_drafts(id,opportunity_id,actor_id,request_key,input,purpose,recipient_label,body,basis_revision,blocker_id,review_id,evidence_basis)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        opportunityId,
        actor.userId,
        key,
        JSON.stringify(input),
        input.kind,
        draft.recipientLabel,
        draft.body,
        h.revision,
        draft.blockerId,
        draft.reviewId,
        JSON.stringify(
          workbench?.photoRequest ?? {
            inquiryId: input.kind !== "photo_request" ? input.inquiryId : null,
            blockerId: draft.blockerId,
            reviewId: draft.reviewId,
          },
        ),
      ],
    );
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

/** Persists a bounded specialist-language turn atomically with its inquiry and review outcome.
 * No provider is installed or called. Disconnects retry with the same key and do not duplicate work.
 * @throws {AppError} For denied access, invalid text or key conflicts.
 */
export async function beginChatTurn(
  actor: Actor,
  opportunityId: string,
  raw: unknown,
  requestKey: string,
) {
  const message = parseEvidence(z.string().trim().min(1).max(2000), raw);
  const key = parseEvidence(keySchema, requestKey);
  return evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `turn:${actor.userId}:${key}`,
    ]);
    const prior = await db.query(
      `select id,inquiry_id as "inquiryId",message,opportunity_id from signal_desk.chat_turns where actor_id=$1 and request_key=$2`,
      [actor.userId, key],
    );
    if (prior.rowCount) {
      const turn = turnRow.extend({ opportunity_id: z.string() }).parse(prior.rows[0]);
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
    );
    await readInquiry(db, opportunityId, vehicleId, inquiryId);
    const id = randomUUID();
    await db.query(
      "insert into signal_desk.chat_turns(id,opportunity_id,actor_id,request_key,message,inquiry_id) values ($1,$2,$3,$4,$5,$6)",
      [id, opportunityId, actor.userId, key, message, inquiryId],
    );
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
  const exists = await db.query(
    "select id from signal_desk.inquiries where id=$1 and opportunity_id=$2",
    [call.props.inquiryId, opportunityId],
  );
  if (!exists.rowCount) return null;
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
  const callId = parseEvidence(keySchema, rawCallId);
  const envelope = parseEvidence(z.object({ tool: z.string().min(1).max(80) }).passthrough(), raw);
  return evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    const turn = await db.query(
      "select id from signal_desk.chat_turns where id=$1 and opportunity_id=$2 and actor_id=$3",
      [turnId, opportunityId, actor.userId],
    );
    if (!turn.rowCount) throw new AppError(404, "NOT_FOUND", "Turn not found.");
    const prior = await db.query(
      "select input,status from signal_desk.card_calls where turn_id=$1 and call_id=$2",
      [turnId, callId],
    );
    const parsed = cardCall.safeParse(envelope);
    if (prior.rowCount) {
      const row = z
        .object({
          input: z.unknown(),
          status: z.enum(["accepted", "malformed", "retired", "unavailable"]),
        })
        .parse(prior.rows[0]);
      sameInput(row.input, envelope);
      const card =
        row.status === "accepted" && parsed.success
          ? await resolveCard(db, opportunityId, vehicleId, parsed.data)
          : null;
      return { status: row.status, card };
    }
    const count = z
      .object({ n: z.number() })
      .parse(
        (
          await db.query(
            "select count(*)::int as n from signal_desk.card_calls where turn_id=$1 and tool=$2 and status='malformed'",
            [turnId, envelope.tool],
          )
        ).rows[0],
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
    await db.query(
      "insert into signal_desk.card_calls(turn_id,call_id,tool,input,status) values ($1,$2,$3,$4,$5)",
      [turnId, callId, envelope.tool, JSON.stringify(envelope), status],
    );
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
  return z
    .array(z.object({ id: z.string() }))
    .parse(
      (
        await database().query(
          "select id from signal_desk.opportunities where vehicle_id=$1 and buyer_id=$2 order by id",
          [vehicleId, current.userId],
        )
      ).rows,
    );
}
