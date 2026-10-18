import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { beginLocked, database, orm } from "./db";
import {
  claims as claimTable,
  evidenceBlockers,
  evidenceReviews,
  identities,
  importJobs,
  importSources,
  opportunities,
  opportunityMembers,
  publicFacts,
  sourceClassifications,
  sources as sourceTable,
  vehicles,
} from "./db-schema";
import {
  type AccessCheck,
  type Actor,
  type Role,
  refreshActor,
  requireOpportunity,
  requireOpportunityAccess,
  requireSession,
} from "./access";
import { getSource } from "./records";
import { AppError } from "./errors";
import { parseInput } from "./validation";
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
  droppedClaims: z.number(),
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
const blockerProjection = {
  id: evidenceBlockers.id,
  key: evidenceBlockers.blocker_key,
  question: evidenceBlockers.question,
  field: evidenceBlockers.field,
  assigneeId: evidenceBlockers.assignee_id,
  nextAction: evidenceBlockers.next_action,
  state: evidenceBlockers.state,
};
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
    await beginLocked(db, sql`select signal_desk.lock_evidence_access()`);
    const order: AccessCheck[] =
      permission === "write" ? ["write", "opportunity"] : ["opportunity"];
    const { opportunity } = await requireOpportunityAccess(actor, opportunityId, order, role, db);
    await orm(db)
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, opportunity.vehicle_id))
      .for(permission === "read" ? "share" : "update");
    await orm(db)
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .for(permission === "read" ? "share" : "update");
    await requireOpportunity(actor, opportunityId, role, db);
    const result = await action(db, opportunity.vehicle_id);
    await orm(db).execute(sql`commit`);
    return result;
  } catch (error) {
    await orm(db).execute(sql`rollback`);
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
  const input = parseInput(sourceInput, raw);
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
      const blocker = await orm(db)
        .select({ id: evidenceBlockers.id })
        .from(evidenceBlockers)
        .where(
          and(
            eq(evidenceBlockers.id, input.blockerId),
            eq(evidenceBlockers.opportunity_id, opportunityId),
          ),
        );
      if (!blocker.length) throw new AppError(404, "NOT_FOUND", "Blocker not found.");
    }
    const hash = createHash("sha256").update(input.content).digest("hex");
    const prior = await orm(db)
      .select({ id: sourceTable.id })
      .from(sourceTable)
      .where(
        and(
          eq(sourceTable.opportunity_id, opportunityId),
          eq(sourceTable.sha256, hash),
          eq(sourceTable.owner_id, actor.userId),
          eq(sourceTable.kind, input.kind),
          eq(sourceTable.audience, input.audience),
          eq(sourceTable.shareable, input.shareable),
          input.blockerId
            ? eq(sourceTable.blocker_id, input.blockerId)
            : isNull(sourceTable.blocker_id),
          eq(sourceTable.provenance, input.provenance),
          eq(sourceTable.permission, input.permission),
          eq(sourceTable.media_type, input.mediaType),
        ),
      );
    if (prior[0]) return { id: prior[0].id, sha256: hash };
    const id = randomUUID();
    await orm(db)
      .insert(sourceTable)
      .values({
        id,
        opportunity_id: opportunityId,
        owner_id: actor.userId,
        audience: input.audience,
        name: input.name,
        media_type: input.mediaType,
        content: input.content,
        kind: input.kind,
        pages,
        shareable: input.shareable,
        permission: input.permission,
        provenance: input.provenance,
        blocker_id: input.blockerId ?? null,
      });
    await orm(db)
      .update(vehicles)
      .set({ revision: sql`${vehicles.revision}+1` })
      .where(eq(vehicles.id, vehicleId));
    if (!["private_note", "inquiry", "photo"].includes(input.kind)) {
      await orm(db).delete(publicFacts).where(eq(publicFacts.vehicle_id, vehicleId));
      await orm(db)
        .update(evidenceBlockers)
        .set({ state: "needs_review" })
        .where(
          inArray(
            evidenceBlockers.opportunity_id,
            orm(db)
              .select({ id: opportunities.id })
              .from(opportunities)
              .where(eq(opportunities.vehicle_id, vehicleId)),
          ),
        );
    }
    if (input.blockerId)
      await orm(db)
        .update(evidenceBlockers)
        .set({ state: "needs_review" })
        .where(eq(evidenceBlockers.id, input.blockerId));
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
  const store = orm(db);
  const processed = store
    .select({ id: importSources.source_id })
    .from(importSources)
    .innerJoin(importJobs, eq(importJobs.id, importSources.job_id))
    .where(and(eq(importSources.source_id, sourceTable.id), eq(importJobs.state, "ready")));
  const visible = and(
    eq(sourceTable.opportunity_id, opportunityId),
    or(eq(sourceTable.owner_id, actor.userId), eq(sourceTable.audience, "sales")),
  );
  const sourceRows = await store
    .select({
      id: sourceTable.id,
      name: sourceTable.name,
      kind: sourceTable.kind,
      audience: sourceTable.audience,
      sha256: sourceTable.sha256,
      shareable: sourceTable.shareable,
      permission: sourceTable.permission,
      provenance: sourceTable.provenance,
      blockerId: sourceTable.blocker_id,
      pages: sourceTable.pages,
      processed: exists(processed),
    })
    .from(sourceTable)
    .where(visible)
    .orderBy(sourceTable.created_at, sourceTable.id);
  const sources = z.array(sourceView).parse(sourceRows);
  const result = await store
    .select({
      id: claimTable.id,
      sourceId: claimTable.source_id,
      field: claimTable.field,
      value: claimTable.value,
      unit: claimTable.unit,
      page: claimTable.page,
      start: claimTable.start_offset,
      end: claimTable.end_offset,
      excerpt: claimTable.excerpt,
      sourceName: sourceTable.name,
      sourceKind: sourceTable.kind,
      shareable: sourceTable.shareable,
      visible: sql<boolean>`${visible}`,
    })
    .from(claimTable)
    .innerJoin(sourceTable, eq(sourceTable.id, claimTable.source_id))
    .where(eq(claimTable.vehicle_id, vehicleId))
    .orderBy(claimTable.id);
  const claims = z.array(claimView).parse(result);
  const decisions = await store
    .select({
      id: evidenceReviews.id,
      field: evidenceReviews.field,
      kind: evidenceReviews.kind,
      claimId: evidenceReviews.claim_id,
      value: evidenceReviews.value,
      unit: evidenceReviews.unit,
      reason: evidenceReviews.reason,
      basis: evidenceReviews.basis,
      shareable: evidenceReviews.shareable,
      revision: evidenceReviews.revision,
      actorId: evidenceReviews.actor_id,
    })
    .from(evidenceReviews)
    .where(
      and(
        eq(evidenceReviews.vehicle_id, vehicleId),
        or(ne(evidenceReviews.kind, "unknown"), eq(evidenceReviews.opportunity_id, opportunityId)),
      ),
    )
    .orderBy(desc(evidenceReviews.revision));
  const reviews = z.array(reviewView).parse(decisions);
  const pending = await store
    .select({
      pending: exists(
        store
          .select({ id: sourceTable.id })
          .from(sourceTable)
          .innerJoin(opportunities, eq(opportunities.id, sourceTable.opportunity_id))
          .where(
            and(
              eq(opportunities.vehicle_id, vehicleId),
              notInArray(sourceTable.kind, ["private_note", "inquiry", "photo"]),
              notExists(processed),
            ),
          ),
      ),
    })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId));
  return {
    sources,
    claims,
    reviews,
    facts: factsFor(claims, reviews, z.boolean().parse(pending[0]?.pending ?? true)),
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
            await orm(db)
              .select({
                title: vehicles.title,
                revision: vehicles.revision,
                nextAction: opportunities.next_action,
                assigneeId: opportunities.assignee_id,
              })
              .from(vehicles)
              .innerJoin(opportunities, eq(opportunities.vehicle_id, vehicles.id))
              .where(eq(opportunities.id, opportunityId))
          )[0],
        );
      const jobs = z.array(jobView).parse(
        await orm(db)
          .select({
            id: importJobs.id,
            state: importJobs.state,
            error: importJobs.error,
            attempt: importJobs.attempt,
            mode: importJobs.mode,
            model: importJobs.model,
            droppedClaims: importJobs.dropped_claims,
          })
          .from(importJobs)
          .where(
            and(
              eq(importJobs.opportunity_id, opportunityId),
              notExists(
                orm(db)
                  .select({ id: importSources.source_id })
                  .from(importSources)
                  .innerJoin(sourceTable, eq(sourceTable.id, importSources.source_id))
                  .where(
                    and(
                      eq(importSources.job_id, importJobs.id),
                      ne(sourceTable.owner_id, actor.userId),
                      eq(sourceTable.audience, "private"),
                    ),
                  ),
              ),
            ),
          )
          .orderBy(desc(importJobs.created_at)),
      );
      const blockers = z
        .array(blockerView)
        .parse(
          await orm(db)
            .select(blockerProjection)
            .from(evidenceBlockers)
            .where(eq(evidenceBlockers.opportunity_id, opportunityId))
            .orderBy(evidenceBlockers.id),
        );
      const classifications = z.array(classificationView).parse(
        await orm(db)
          .select({
            id: sourceClassifications.id,
            sourceId: sourceClassifications.source_id,
            kind: sourceClassifications.kind,
            basis: sourceClassifications.basis,
            nextAction: sourceClassifications.next_action,
            revision: sourceClassifications.revision,
            reviewed: isNotNull(sourceClassifications.actor_id),
          })
          .from(sourceClassifications)
          .where(
            inArray(
              sourceClassifications.source_id,
              evidence.sources.map((s) => s.id),
            ),
          )
          .orderBy(
            desc(isNotNull(sourceClassifications.actor_id)),
            desc(sourceClassifications.revision),
            sourceClassifications.id,
          ),
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
  await orm(db).delete(publicFacts).where(eq(publicFacts.vehicle_id, vehicleId));
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
    await orm(db)
      .insert(publicFacts)
      .values({
        vehicle_id: vehicleId,
        field: fact.field,
        value: `${fact.value} ${fact.unit}`.trim(),
        citation_excerpt: `Page ${claim.page}, characters ${claim.start}-${claim.end}: ${excerpt}`,
        source_label: label,
        approved_at: sql`clock_timestamp()`,
        shareable: true,
        review_id: review.id,
      });
  }
  // A response resolves only its linked question, never every blocker on the vehicle.
  const resolved = orm(db)
    .select({ id: sourceTable.id })
    .from(sourceTable)
    .innerJoin(claimTable, eq(claimTable.source_id, sourceTable.id))
    .innerJoin(
      publicFacts,
      and(
        eq(publicFacts.vehicle_id, claimTable.vehicle_id),
        eq(publicFacts.field, claimTable.field),
      ),
    )
    .innerJoin(
      evidenceReviews,
      and(
        eq(evidenceReviews.id, publicFacts.review_id),
        eq(evidenceReviews.claim_id, claimTable.id),
      ),
    )
    .where(
      and(
        eq(sourceTable.blocker_id, evidenceBlockers.id),
        eq(claimTable.field, evidenceBlockers.field),
      ),
    );
  await orm(db)
    .update(evidenceBlockers)
    .set({ state: sql`case when ${exists(resolved)} then 'resolved' else 'needs_review' end` })
    .where(
      and(
        isNotNull(evidenceBlockers.field),
        inArray(
          evidenceBlockers.opportunity_id,
          orm(db)
            .select({ id: opportunities.id })
            .from(opportunities)
            .where(eq(opportunities.vehicle_id, vehicleId)),
        ),
      ),
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
  const command = parseInput(reviewSchema, raw);
  await evidenceTransaction(actor, opportunityId, async (db, vehicleId) => {
    const current = await orm(db)
      .select({ revision: vehicles.revision })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId));
    if (current[0]?.revision !== revision)
      throw new AppError(412, "STALE_REVIEW", "Evidence changed. Reload before reviewing.");
    const evidence = await packet(db, actor, opportunityId, vehicleId);
    if (command.kind === "reviewPhoto") {
      await appendPhotoReview(db, actor, opportunityId, revision, command);
      await refreshPhotoBlockers(db, actor, opportunityId);
    } else if (command.kind === "classify") {
      const source = evidence.sources.find((s) => s.id === command.sourceId);
      if (!source) throw new AppError(404, "NOT_FOUND", "Source not found.");
      await orm(db)
        .insert(sourceClassifications)
        .values({
          id: randomUUID(),
          source_id: command.sourceId,
          actor_id: actor.userId,
          kind: command.classification,
          basis: command.reason,
          next_action: command.nextAction,
          revision: revision + 1,
        });
      // Private classification text stays with its source, never in shared routing fields.
      if (source.audience === "sales") {
        await orm(db)
          .update(opportunities)
          .set({ assignee_id: actor.userId, next_action: command.nextAction })
          .where(eq(opportunities.id, opportunityId));
        await orm(db)
          .update(evidenceBlockers)
          .set({
            assignee_id: actor.userId,
            next_action: command.nextAction,
            state: ["supported", "private_context"].includes(command.classification)
              ? "resolved"
              : "needs_review",
          })
          .where(
            and(
              eq(evidenceBlockers.opportunity_id, opportunityId),
              eq(evidenceBlockers.blocker_key, `classification:${source.id}`),
            ),
          );
      }
    } else {
      const decision = factDecision(command, evidence);
      await orm(db)
        .insert(evidenceReviews)
        .values({
          id: randomUUID(),
          vehicle_id: vehicleId,
          actor_id: actor.userId,
          field: command.field,
          kind: command.kind,
          claim_id: decision.claimId,
          value: decision.value,
          unit: decision.unit,
          reason: decision.reason,
          basis: decision.basis,
          shareable: decision.shareable,
          revision: revision + 1,
          opportunity_id: opportunityId,
        });
    }
    await orm(db)
      .update(vehicles)
      .set({ revision: sql`${vehicles.revision}+1` })
      .where(eq(vehicles.id, vehicleId));
    await refreshEvidenceProjection(db, actor, opportunityId, vehicleId);
  });
  return getWorkbench(actor, opportunityId);
}

/** Records an existing buyer question without creating another opportunity or sending a draft.
 * A reused key must have the same question, field and assignee.
 * @throws {AppError} For denied access, key conflicts, or an ineligible assignee.
 */
export async function recordEvidenceBlocker(actor: Actor, opportunityId: string, raw: unknown) {
  const input = parseInput(
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
    const eligible = await orm(db)
      .select({ user_id: opportunityMembers.user_id })
      .from(opportunityMembers)
      .innerJoin(identities, eq(identities.userId, opportunityMembers.user_id))
      .where(
        and(
          eq(opportunityMembers.opportunity_id, opportunityId),
          eq(opportunityMembers.user_id, input.assigneeId),
          eq(identities.role, "specialist"),
          isNull(identities.revokedAt),
        ),
      );
    if (!eligible.length)
      throw new AppError(422, "INVALID_ASSIGNEE", "Assign a current opportunity specialist.");
    const prior = await orm(db)
      .select(blockerProjection)
      .from(evidenceBlockers)
      .where(
        and(
          eq(evidenceBlockers.opportunity_id, opportunityId),
          eq(evidenceBlockers.blocker_key, input.key),
        ),
      );
    if (prior.length) {
      const blocker = blockerView.parse(prior[0]);
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
    await orm(db).insert(evidenceBlockers).values({
      id,
      opportunity_id: opportunityId,
      blocker_key: input.key,
      question: input.question,
      field: input.field,
      assignee_id: input.assigneeId,
      next_action: input.nextAction,
    });
    await orm(db)
      .update(opportunities)
      .set({ assignee_id: input.assigneeId, next_action: input.nextAction })
      .where(eq(opportunities.id, opportunityId));
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
  const result = await orm()
    .select({ id: opportunities.id, title: vehicles.title, nextAction: opportunities.next_action })
    .from(opportunities)
    .innerJoin(vehicles, eq(vehicles.id, opportunities.vehicle_id))
    .innerJoin(opportunityMembers, eq(opportunityMembers.opportunity_id, opportunities.id))
    .where(and(eq(opportunityMembers.user_id, current.userId), gt(opportunities.id, cursor)))
    .orderBy(opportunities.id)
    .limit(100);
  return z
    .array(z.object({ id: z.string(), title: z.string(), nextAction: z.string() }))
    .parse(result);
}
