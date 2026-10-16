import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import { z } from "zod";
import { database } from "./db";
import {
  refreshActor,
  requireOpportunity,
  requireSession,
  requireWrite,
  type Actor,
  type Role,
} from "./access";
import { getSource } from "./records";
import { AppError } from "./errors";
import { appendPhotoReview, readPhotos, refreshPhotoBlockers } from "./photos";
import { photoCoverage, suggestPhotoRequest } from "@signal-desk/contracts/photo-schema";
import {
  canonicalValue,
  classificationKind,
  extractedClaim,
  fieldSchema,
  reviewSchema,
} from "@signal-desk/contracts/evidence-schema";

const exec = promisify(execFile);
const sourceInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    mediaType: z.enum(["text/plain", "application/pdf", "image/png", "image/jpeg"]),
    content: z.instanceof(Buffer).refine((b) => b.length > 0 && b.length <= 10485760),
    kind: z.enum([
      "document",
      "seller_note",
      "private_note",
      "inquiry",
      "seller_response",
      "photo",
    ]),
    audience: z.enum(["private", "sales"]).default("private"),
    shareable: z.boolean().default(false),
    permission: z.enum(["synthetic", "permissioned"]),
    provenance: z.string().trim().min(1).max(1000),
    blockerId: z.string().min(1).max(200).optional(),
  })
  .strict();
const sourceView = z.object({
  id: z.string(),
  name: z.string(),
  kind: sourceInput.shape.kind,
  audience: sourceInput.shape.audience,
  sha256: z.string(),
  shareable: z.boolean(),
  permission: sourceInput.shape.permission,
  provenance: z.string(),
  blockerId: z.string().nullable(),
  pages: z.array(z.string()),
  processed: z.boolean(),
});
const claimView = extractedClaim.extend({
  id: z.string(),
  sourceName: z.string(),
  sourceKind: sourceInput.shape.kind,
  visible: z.boolean(),
  shareable: z.boolean(),
});
const reviewView = z.object({
  id: z.string(),
  field: fieldSchema,
  kind: z.enum(["select", "correct", "unknown"]),
  claimId: z.string().nullable(),
  value: z.string(),
  unit: z.string(),
  reason: z.string(),
  basis: z.string(),
  shareable: z.boolean(),
  revision: z.number(),
  actorId: z.string(),
});
const classificationView = z.object({
  id: z.string(),
  sourceId: z.string(),
  kind: classificationKind,
  basis: z.string(),
  nextAction: z.string(),
  revision: z.number(),
  reviewed: z.boolean(),
});
const jobView = z.object({
  id: z.string(),
  state: z.enum(["queued", "processing", "ready", "failed"]),
  error: z.string().nullable(),
  attempt: z.number(),
  mode: z.enum(["provider", "saved_example"]),
  model: z.string(),
});
const blockerView = z.object({
  id: z.string(),
  key: z.string(),
  question: z.string(),
  field: fieldSchema.nullable(),
  assigneeId: z.string(),
  nextAction: z.string(),
  state: z.enum(["needs_review", "resolved"]),
});
type Claim = z.infer<typeof claimView>;
type Decision = z.infer<typeof reviewView>;
type Fact = { field: z.infer<typeof fieldSchema>; basis: string } & (
  | { kind: "unknown" | "unreviewed" | "conflict" | "needs_review"; reason: string }
  | {
      kind: "reviewed";
      value: string;
      unit: string;
      claimId: string;
      shareable: boolean;
      sourceKind: z.infer<typeof sourceInput.shape.kind>;
    }
);

/** Validates untrusted operation input without leaking schema or source contents.
 * @throws {AppError} For malformed input.
 */
export function parseEvidence<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError(422, "INVALID_INPUT", "Evidence input is invalid.");
  return parsed.data;
}

/** Serializes evidence changes with fresh access and the vehicle revision.
 * @throws {AppError} For denied access; rolls back on any failure.
 */
export async function evidenceTransaction<T>(
  actor: Actor,
  opportunityId: string,
  action: (db: PoolClient, vehicleId: string) => Promise<T>,
  role: Role = "specialist",
  permission: "read" | "write" = "write",
) {
  const db = await database().connect();
  try {
    await db.query("begin");
    await db.query("set local lock_timeout='5s'");
    await db.query("select signal_desk.lock_evidence_access()");
    if (permission === "write") await requireWrite(actor, db);
    const opportunity = await requireOpportunity(actor, opportunityId, role, db);
    await db.query("select id from signal_desk.vehicles where id=$1 for update", [
      opportunity.vehicle_id,
    ]);
    await db.query("select id from signal_desk.opportunities where id=$1 for update", [
      opportunityId,
    ]);
    await requireOpportunity(actor, opportunityId, role, db);
    const result = await action(db, opportunity.vehicle_id);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}

async function pdfText(content: Buffer) {
  if (content.subarray(0, 5).toString() !== "%PDF-")
    throw new AppError(415, "INVALID_PDF", "Provide a text-based PDF.");
  const dir = await mkdtemp(join(tmpdir(), "signal-source-"));
  try {
    const path = join(dir, "source.pdf");
    await writeFile(path, content, { mode: 0o600 });
    return (
      await exec("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], {
        timeout: 10000,
        maxBuffer: 2097152,
      })
    ).stdout;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      throw new AppError(503, "PDF_UNAVAILABLE", "PDF text extraction is unavailable.");
    throw new AppError(
      422,
      "PDF_UNREADABLE",
      "PDF could not be read. Scanned PDF OCR is not supported.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function extractPages(content: Buffer, mediaType: string) {
  let text: string;
  if (mediaType === "application/pdf") text = await pdfText(content);
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new AppError(422, "INVALID_TEXT", "Provide UTF-8 text.");
    }
  }
  if (!text.trim() || text.includes("\0") || Buffer.byteLength(text) > 2097152)
    throw new AppError(422, "NO_TEXT", "Provide readable text; scanned PDF OCR is not supported.");
  const pages = text.split("\f");
  if (!pages.at(-1)?.trim()) pages.pop();
  if (pages.length > 500) throw new AppError(413, "TOO_LARGE", "Source exceeds 500 pages.");
  return pages;
}

/** Stores original bytes and immutable provenance; only the uploader grants excerpt sharing.
 * Deduplicates identical metadata/content in an opportunity. Never widens an existing source.
 * @throws {AppError} For denied access, unsupported bytes, or invalid blocker linkage.
 */
export async function addSource(actor: Actor, opportunityId: string, raw: unknown) {
  await requireOpportunity(actor, opportunityId, "specialist");
  const input = parseEvidence(sourceInput, raw);
  if (
    input.shareable &&
    (input.audience !== "sales" || ["private_note", "inquiry"].includes(input.kind))
  )
    throw new AppError(422, "PRIVATE_SOURCE", "Private context cannot authorize publication.");
  if (input.kind !== "photo" && (input.kind === "seller_response") !== Boolean(input.blockerId))
    throw new AppError(
      422,
      "BLOCKER_REQUIRED",
      "Seller responses must link to their originating blocker.",
    );
  const image = input.mediaType.startsWith("image/");
  if (image !== (input.kind === "photo"))
    throw new AppError(415, "INVALID_PHOTO", "Use photo source type for PNG or JPEG uploads.");
  if (image) {
    const png = input.content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = input.content[0] === 255 && input.content[1] === 216 && input.content[2] === 255;
    if ((input.mediaType === "image/png" ? !png : !jpeg) || input.content.length > 5242880)
      throw new AppError(
        415,
        "INVALID_PHOTO",
        "Provide a PNG or JPEG up to 5 MiB. The declared type must match its bytes.",
      );
  }
  const pages = image ? [] : await extractPages(input.content, input.mediaType);
  return evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    if (input.blockerId) {
      const blocker = await db.query(
        "select id from signal_desk.evidence_blockers where id=$1 and opportunity_id=$2",
        [input.blockerId, opportunityId],
      );
      if (!blocker.rowCount) throw new AppError(404, "NOT_FOUND", "Blocker not found.");
    }
    const hash = createHash("sha256").update(input.content).digest("hex");
    const prior = await db.query<{ id: string }>(
      `select id from signal_desk.sources where opportunity_id=$1 and sha256=$2 and owner_id=$3
      and kind=$4 and audience=$5 and shareable=$6 and blocker_id is not distinct from $7 and provenance=$8 and permission=$9 and media_type=$10`,
      [
        opportunityId,
        hash,
        actor.userId,
        input.kind,
        input.audience,
        input.shareable,
        input.blockerId ?? null,
        input.provenance,
        input.permission,
        input.mediaType,
      ],
    );
    if (prior.rows[0]) return { id: prior.rows[0].id, sha256: hash };
    const id = randomUUID();
    await db.query(
      `insert into signal_desk.sources(id,opportunity_id,owner_id,audience,name,media_type,content,kind,pages,shareable,permission,provenance,blocker_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        opportunityId,
        actor.userId,
        input.audience,
        input.name,
        input.mediaType,
        input.content,
        input.kind,
        JSON.stringify(pages),
        input.shareable,
        input.permission,
        input.provenance,
        input.blockerId ?? null,
      ],
    );
    await db.query("update signal_desk.vehicles set revision=revision+1 where id=$1", [vehicleId]);
    if (!["private_note", "inquiry", "photo"].includes(input.kind)) {
      await db.query("delete from signal_desk.public_facts where vehicle_id=$1", [vehicleId]);
      await db.query(
        "update signal_desk.evidence_blockers set state='needs_review' where opportunity_id in (select id from signal_desk.opportunities where vehicle_id=$1)",
        [vehicleId],
      );
    }
    if (input.blockerId)
      await db.query("update signal_desk.evidence_blockers set state='needs_review' where id=$1", [
        input.blockerId,
      ]);
    if (image) await refreshPhotoBlockers(db, actor, opportunityId);
    return { id, sha256: hash };
  });
}

function basis(claims: Claim[]) {
  return createHash("sha256")
    .update(JSON.stringify(claims.map((c) => c.id).sort()))
    .digest("hex");
}

function factsFor(claims: Claim[], reviews: Decision[], pending: boolean): Fact[] {
  return fieldSchema.options.map((field) => {
    const related = claims.filter((c) => c.field === field);
    const currentBasis = basis(related);
    const base = { field, basis: currentBasis };
    if (pending || related.some((c) => !c.visible))
      return {
        ...base,
        kind: "needs_review",
        reason: pending
          ? "Source processing is incomplete. Review the packet before approving."
          : "Restricted evidence requires an authorized owner review.",
      };
    const review = reviews.find((r) => r.field === field);
    if (review?.basis === currentBasis) {
      if (review.kind === "unknown") return { ...base, kind: "unknown", reason: review.reason };
      const claim = related.find((c) => c.id === review.claimId);
      if (claim)
        return {
          ...base,
          kind: "reviewed",
          value: review.value,
          unit: review.unit,
          claimId: claim.id,
          shareable: review.shareable,
          sourceKind: claim.sourceKind,
        };
    }
    if (!related.length)
      return {
        ...base,
        kind: "unknown",
        reason: "No supporting evidence supplied. Request the missing source.",
      };
    const distinct = new Set(related.map((c) => canonicalValue(c.field, c.value, c.unit)));
    return {
      ...base,
      kind: distinct.size > 1 ? "conflict" : "unreviewed",
      reason:
        distinct.size > 1
          ? "Sources disagree. A specialist must resolve the claims."
          : "Source assertion only. A specialist must review it.",
    };
  });
}

async function packet(db: PoolClient, actor: Actor, opportunityId: string, vehicleId: string) {
  const sourceRows = await db.query(
    `select s.id,s.name,s.kind,s.audience,s.sha256,s.shareable,s.permission,s.provenance,s.blocker_id as "blockerId",s.pages,
    exists(select 1 from signal_desk.import_sources js join signal_desk.import_jobs j on j.id=js.job_id where js.source_id=s.id and j.state='ready') as processed
    from signal_desk.sources s where s.opportunity_id=$1 and (s.owner_id=$2 or s.audience='sales') order by s.created_at,s.id`,
    [opportunityId, actor.userId],
  );
  const sources = z.array(sourceView).parse(sourceRows.rows);
  const result = await db.query(
    `select c.id,c.source_id as "sourceId",c.field,c.value,c.unit,c.page,c.start_offset as start,c.end_offset as end,c.excerpt,
    s.name as "sourceName",s.kind as "sourceKind",s.shareable,
    (s.opportunity_id=$2 and (s.owner_id=$3 or s.audience='sales')) as visible
    from signal_desk.claims c join signal_desk.sources s on s.id=c.source_id where c.vehicle_id=$1 order by c.id`,
    [vehicleId, opportunityId, actor.userId],
  );
  const claims = z.array(claimView).parse(result.rows);
  const decisions = await db.query(
    `select id,field,kind,claim_id as "claimId",value,unit,reason,basis,shareable,revision,actor_id as "actorId"
    from signal_desk.evidence_reviews where vehicle_id=$1 and (kind<>'unknown' or opportunity_id=$2) order by revision desc`,
    [vehicleId, opportunityId],
  );
  const reviews = z.array(reviewView).parse(decisions.rows);
  const pending = await db.query<{ pending: boolean }>(
    `select exists(select 1 from signal_desk.sources s join signal_desk.opportunities o on o.id=s.opportunity_id
    where o.vehicle_id=$1 and s.kind not in ('private_note','inquiry','photo') and not exists
    (select 1 from signal_desk.import_sources js join signal_desk.import_jobs j on j.id=js.job_id where js.source_id=s.id and j.state='ready')) as pending`,
    [vehicleId],
  );
  return {
    sources,
    claims,
    reviews,
    facts: factsFor(claims, reviews, pending.rows[0]?.pending ?? true),
  };
}

/** Reads one permitted opportunity with source-filtered evidence and explicit review states.
 * @throws {AppError} For revoked access or missing membership.
 */
export async function getWorkbench(actor: Actor, opportunityId: string) {
  return evidenceTransaction(
    actor,
    opportunityId,
    async (db, vehicleId) => {
      const evidence = await packet(db, actor, opportunityId, vehicleId);
      const photos = await readPhotos(db, actor, opportunityId);
      const coverage = photoCoverage(photos.filter((p) => p.audience === "sales"));
      const header = z
        .object({
          title: z.string(),
          revision: z.number(),
          nextAction: z.string(),
          assigneeId: z.string().nullable(),
        })
        .parse(
          (
            await db.query(
              `select v.title,v.revision,o.next_action as "nextAction",o.assignee_id as "assigneeId" from signal_desk.vehicles v join signal_desk.opportunities o on o.vehicle_id=v.id where o.id=$1`,
              [opportunityId],
            )
          ).rows[0],
        );
      const jobs = z.array(jobView).parse(
        (
          await db.query(
            `select j.id,j.state,j.error,j.attempt,j.mode,j.model from signal_desk.import_jobs j where j.opportunity_id=$1
      and not exists(select 1 from signal_desk.import_sources js join signal_desk.sources s on s.id=js.source_id where js.job_id=j.id and s.owner_id<>$2 and s.audience='private') order by j.created_at desc`,
            [opportunityId, actor.userId],
          )
        ).rows,
      );
      const blockers = z
        .array(blockerView)
        .parse(
          (
            await db.query(
              `select id,blocker_key as key,question,field,assignee_id as "assigneeId",next_action as "nextAction",state from signal_desk.evidence_blockers where opportunity_id=$1 order by id`,
              [opportunityId],
            )
          ).rows,
        );
      const classifications = z.array(classificationView).parse(
        (
          await db.query(
            `select c.id,c.source_id as "sourceId",c.kind,c.basis,c.next_action as "nextAction",c.revision,(c.actor_id is not null) as reviewed
      from signal_desk.source_classifications c where c.source_id=any($1::text[]) order by (c.actor_id is not null) desc,c.revision desc,c.id`,
            [evidence.sources.map((s) => s.id)],
          )
        ).rows,
      );
      return {
        opportunityId,
        vehicleId,
        ...header,
        sources: evidence.sources,
        claims: evidence.claims.filter((c) => c.visible),
        reviews: evidence.reviews.filter(
          (r) =>
            r.actorId === actor.userId ||
            evidence.claims.some((c) => c.id === r.claimId && c.visible),
        ),
        facts: evidence.facts,
        jobs,
        blockers,
        classifications: classifications.filter(
          (c, i, all) => all.findIndex((a) => a.sourceId === c.sourceId) === i,
        ),
        classificationHistory: classifications,
        photos,
        coverage,
        photoRequest: suggestPhotoRequest({
          opportunityId,
          vehicleId,
          revision: header.revision,
          coverage,
          evidenceSourceIds: photos.filter((p) => p.audience === "sales").map((p) => p.sourceId),
          blockers,
        }),
      };
    },
    "specialist",
    "read",
  );
}

/** Removes obsolete approvals atomically after evidence changes; never promotes model output.
 * Call only inside the vehicle's evidence transaction.
 */
export async function refreshEvidenceProjection(
  db: PoolClient,
  actor: Actor,
  opportunityId: string,
  vehicleId: string,
) {
  const evidence = await packet(db, actor, opportunityId, vehicleId);
  await db.query("delete from signal_desk.public_facts where vehicle_id=$1", [vehicleId]);
  for (const fact of evidence.facts) {
    if (fact.kind !== "reviewed" || !fact.shareable) continue;
    const claim = evidence.claims.find((c) => c.id === fact.claimId);
    const review = evidence.reviews.find((r) => r.field === fact.field);
    if (!claim || !review || !claim.shareable) continue;
    const source = await getSource(actor, claim.sourceId, db);
    if (source.audience !== "sales" || ["private_note", "inquiry"].includes(claim.sourceKind))
      continue;
    const label = ["seller_note", "seller_response"].includes(claim.sourceKind)
      ? `Seller-reported · ${claim.sourceName}`
      : claim.sourceName;
    const excerpt =
      review.kind === "correct"
        ? `Human correction: ${review.reason}. Original assertion: ${claim.excerpt}`
        : claim.excerpt;
    await db.query(
      `insert into signal_desk.public_facts(vehicle_id,field,value,citation_excerpt,source_label,approved_at,shareable,review_id)
      values ($1,$2,$3,$4,$5,clock_timestamp(),true,$6)`,
      [
        vehicleId,
        fact.field,
        `${fact.value} ${fact.unit}`.trim(),
        `Page ${claim.page}, characters ${claim.start}-${claim.end}: ${excerpt}`,
        label,
        review.id,
      ],
    );
  }
  // A response resolves only its linked question, never every blocker on the vehicle.
  await db.query(
    `update signal_desk.evidence_blockers b set state=case when exists(
    select 1 from signal_desk.sources s join signal_desk.claims c on c.source_id=s.id
    join signal_desk.public_facts f on f.vehicle_id=c.vehicle_id and f.field=c.field
    join signal_desk.evidence_reviews r on r.id=f.review_id and r.claim_id=c.id
    where s.blocker_id=b.id and c.field=b.field) then 'resolved' else 'needs_review' end
    where b.field is not null and b.opportunity_id in (select id from signal_desk.opportunities where vehicle_id=$1)`,
    [vehicleId],
  );
}

function factDecision(
  command: Exclude<z.infer<typeof reviewSchema>, { kind: "classify" | "reviewPhoto" }>,
  evidence: Awaited<ReturnType<typeof packet>>,
) {
  const fact = evidence.facts.find((f) => f.field === command.field);
  if (!fact) throw new AppError(422, "INVALID_INPUT", "Unsupported field.");
  if (command.kind === "unknown")
    return {
      claimId: null,
      value: "",
      unit: "",
      reason: command.reason,
      basis: fact.basis,
      shareable: false,
    };
  const claim = evidence.claims.find(
    (c) => c.id === command.claimId && c.field === command.field && c.visible,
  );
  if (!claim || fact.kind === "needs_review")
    throw new AppError(
      409,
      "EVIDENCE_INCOMPLETE",
      "Review requires accessible, processed evidence.",
    );
  if (
    command.shareable &&
    (!claim.shareable || ["private_note", "inquiry"].includes(claim.sourceKind))
  )
    throw new AppError(403, "DISCLOSURE_DENIED", "This source does not permit public excerpts.");
  const value = command.kind === "correct" ? command.value : claim.value;
  const unit = command.kind === "correct" ? command.unit : claim.unit;
  try {
    canonicalValue(command.field, value, unit);
  } catch {
    throw new AppError(422, "INVALID_INPUT", "Value or unit does not match this field.");
  }
  return {
    claimId: claim.id,
    value,
    unit,
    reason: "reason" in command ? command.reason : "Selected source assertion",
    basis: fact.basis,
    shareable: command.shareable,
  };
}

/** Appends a human selection, correction, unknown decision or classification correction.
 * @throws {AppError} For a stale revision, denied disclosure or unsupported evidence.
 */
export async function reviewEvidence(
  actor: Actor,
  opportunityId: string,
  revision: number,
  raw: unknown,
) {
  requireSession(actor);
  const command = parseEvidence(reviewSchema, raw);
  await evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    const current = await db.query<{ revision: number }>(
      "select revision from signal_desk.vehicles where id=$1",
      [vehicleId],
    );
    if (current.rows[0]?.revision !== revision)
      throw new AppError(412, "STALE_REVIEW", "Evidence changed. Reload before reviewing.");
    const evidence = await packet(db, actor, opportunityId, vehicleId);
    if (command.kind === "reviewPhoto") {
      await appendPhotoReview(db, actor, opportunityId, revision, command);
      await refreshPhotoBlockers(db, actor, opportunityId);
    } else if (command.kind === "classify") {
      const source = evidence.sources.find((s) => s.id === command.sourceId);
      if (!source) throw new AppError(404, "NOT_FOUND", "Source not found.");
      await db.query(
        `insert into signal_desk.source_classifications(id,source_id,actor_id,kind,basis,next_action,revision)
        values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          randomUUID(),
          command.sourceId,
          actor.userId,
          command.classification,
          command.reason,
          command.nextAction,
          revision + 1,
        ],
      );
      // Private classification text stays with its source, never in shared routing fields.
      if (source.audience === "sales") {
        await db.query(
          "update signal_desk.opportunities set assignee_id=$2,next_action=$3 where id=$1",
          [opportunityId, actor.userId, command.nextAction],
        );
        await db.query(
          `update signal_desk.evidence_blockers set assignee_id=$3,next_action=$4,state=$5
          where opportunity_id=$1 and blocker_key=$2`,
          [
            opportunityId,
            `classification:${source.id}`,
            actor.userId,
            command.nextAction,
            ["supported", "private_context"].includes(command.classification)
              ? "resolved"
              : "needs_review",
          ],
        );
      }
    } else {
      const decision = factDecision(command, evidence);
      await db.query(
        `insert into signal_desk.evidence_reviews(id,vehicle_id,actor_id,field,kind,claim_id,value,unit,reason,basis,shareable,revision,opportunity_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          randomUUID(),
          vehicleId,
          actor.userId,
          command.field,
          command.kind,
          decision.claimId,
          decision.value,
          decision.unit,
          decision.reason,
          decision.basis,
          decision.shareable,
          revision + 1,
          opportunityId,
        ],
      );
    }
    await db.query("update signal_desk.vehicles set revision=revision+1 where id=$1", [vehicleId]);
    await refreshEvidenceProjection(db, actor, opportunityId, vehicleId);
  });
  return getWorkbench(actor, opportunityId);
}

/** Records an existing buyer question without creating another opportunity or sending a draft.
 * A reused key must have the same question, field and assignee.
 * @throws {AppError} For denied access, key conflicts, or an ineligible assignee.
 */
export async function recordEvidenceBlocker(actor: Actor, opportunityId: string, raw: unknown) {
  const input = parseEvidence(
    z
      .object({
        key: z.string().min(1).max(200),
        question: z.string().trim().min(1).max(2000),
        field: fieldSchema,
        assigneeId: z.uuid(),
        nextAction: z.string().trim().min(1).max(500),
      })
      .strict(),
    raw,
  );
  return evidenceTransaction(actor, opportunityId, async (db) => {
    const eligible = await db.query(
      `select m.user_id from signal_desk.opportunity_members m join signal_desk.identities i on i.user_id=m.user_id
      where m.opportunity_id=$1 and m.user_id=$2 and i.role='specialist' and i.revoked_at is null`,
      [opportunityId, input.assigneeId],
    );
    if (!eligible.rowCount)
      throw new AppError(422, "INVALID_ASSIGNEE", "Assign a current opportunity specialist.");
    const prior = await db.query(
      `select id,blocker_key as key,question,field,assignee_id as "assigneeId",next_action as "nextAction",state from signal_desk.evidence_blockers where opportunity_id=$1 and blocker_key=$2`,
      [opportunityId, input.key],
    );
    if (prior.rowCount) {
      const blocker = blockerView.parse(prior.rows[0]);
      if (
        blocker.question !== input.question ||
        blocker.field !== input.field ||
        blocker.assigneeId !== input.assigneeId
      )
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Blocker key already identifies another question.",
        );
      return blocker;
    }
    const id = randomUUID();
    await db.query(
      `insert into signal_desk.evidence_blockers(id,opportunity_id,blocker_key,question,field,assignee_id,next_action) values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        opportunityId,
        input.key,
        input.question,
        input.field,
        input.assigneeId,
        input.nextAction,
      ],
    );
    await db.query(
      "update signal_desk.opportunities set assignee_id=$2,next_action=$3 where id=$1",
      [opportunityId, input.assigneeId, input.nextAction],
    );
    return { id, ...input, state: "needs_review" as const };
  });
}

export type Workbench = Awaited<ReturnType<typeof getWorkbench>>;

/** Lists only opportunities explicitly assigned to a current specialist.
 * @throws {AppError} For expired or revoked access.
 */
export async function listEvidenceOpportunities(actor: Actor, cursor = "") {
  const current = await refreshActor(actor);
  if (current.role !== "specialist") return [];
  const result = await database().query(
    `select o.id,v.title,o.next_action as "nextAction" from signal_desk.opportunities o
    join signal_desk.vehicles v on v.id=o.vehicle_id
    join signal_desk.opportunity_members m on m.opportunity_id=o.id
    where m.user_id=$1 and o.id>$2 order by o.id limit 100`,
    [current.userId, cursor],
  );
  return z
    .array(z.object({ id: z.string(), title: z.string(), nextAction: z.string() }))
    .parse(result.rows);
}
