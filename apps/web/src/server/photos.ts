import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { orm } from "./db";
import { evidenceBlockers, importJobs, photoReviews, photoSuggestions, sources } from "./db-schema";
import type { Actor } from "./access";
import { AppError } from "./errors";
import { photoView, photoReview, photoCoverage } from "@signal-desk/contracts/photo-schema";

const decision = z.object({
  view: photoView,
  readable: z.boolean(),
  reason: z.string(),
  revision: z.number(),
});
const photoRow = z.object({
  sourceId: z.string(),
  sha256: z.string(),
  name: z.string(),
  audience: z.enum(["private", "sales"]),
  shareable: z.boolean(),
  provenance: z.string(),
  suggestion: decision.extend({ jobId: z.string(), model: z.string() }).nullable(),
  review: decision.extend({ approved: z.boolean() }).nullable(),
});

/** Reads only source-authorized photos. Reviews take precedence without erasing suggestions. */
export async function readPhotos(db: PoolClient, actor: Actor, opportunityId: string) {
  const store = orm(db);
  const suggestion = store
    .select({
      value: sql`jsonb_build_object('view',${photoSuggestions.view},'readable',${photoSuggestions.readable},'reason',${photoSuggestions.reason},'revision',${photoSuggestions.revision},'jobId',${photoSuggestions.job_id},'model',${importJobs.model})`,
    })
    .from(photoSuggestions)
    .innerJoin(importJobs, eq(importJobs.id, photoSuggestions.job_id))
    .where(eq(photoSuggestions.source_id, sources.id))
    .orderBy(desc(photoSuggestions.revision))
    .limit(1);
  const review = store
    .select({
      value: sql`jsonb_build_object('view',${photoReviews.view},'readable',${photoReviews.readable},'reason',${photoReviews.reason},'revision',${photoReviews.revision},'approved',${photoReviews.approved})`,
    })
    .from(photoReviews)
    .where(eq(photoReviews.source_id, sources.id))
    .orderBy(desc(photoReviews.revision))
    .limit(1);
  const result = await store
    .select({
      sourceId: sources.id,
      sha256: sources.sha256,
      name: sources.name,
      audience: sources.audience,
      shareable: sources.shareable,
      provenance: sources.provenance,
      suggestion: sql`(${suggestion})`,
      review: sql`(${review})`,
    })
    .from(sources)
    .where(
      and(
        eq(sources.opportunity_id, opportunityId),
        eq(sources.kind, "photo"),
        or(eq(sources.owner_id, actor.userId), eq(sources.audience, "sales")),
      ),
    )
    .orderBy(sources.created_at, sources.id);
  return z
    .array(photoRow)
    .parse(result)
    .map((p) => ({
      ...p,
      effective: {
        ...(p.review ??
          p.suggestion ?? {
            view: "unknown" as const,
            readable: false,
            reason: "Live vision unavailable. Inspect the original photo.",
            revision: 0,
          }),
        reviewed: p.review !== null,
      },
    }));
}

/** Appends a human decision within the existing evidence transaction.
 * @throws {AppError} For inaccessible sources or unauthorized public disclosure.
 */
export async function appendPhotoReview(
  db: PoolClient,
  actor: Actor,
  opportunityId: string,
  revision: number,
  command: z.infer<typeof photoReview>,
) {
  const photo = (await readPhotos(db, actor, opportunityId)).find(
    (p) => p.sourceId === command.sourceId,
  );
  if (!photo) throw new AppError(404, "NOT_FOUND", "Photo not found.");
  if (command.approved && (!photo.shareable || photo.audience !== "sales"))
    throw new AppError(403, "DISCLOSURE_DENIED", "This photo does not permit public sharing.");
  if (command.approved && (!command.readable || command.view === "unknown"))
    throw new AppError(422, "PHOTO_INCOMPLETE", "Only a readable identified view can be approved.");
  await orm(db)
    .insert(photoReviews)
    .values({
      id: randomUUID(),
      source_id: photo.sourceId,
      actor_id: actor.userId,
      view: command.view,
      readable: command.readable,
      approved: command.approved,
      reason: command.reason,
      revision: revision + 1,
    });
}

/** Refreshes stable photo blockers in the opportunity; private photos never resolve shared tasks. */
export async function refreshPhotoBlockers(db: PoolClient, actor: Actor, opportunityId: string) {
  const photos = (await readPhotos(db, actor, opportunityId)).filter((p) => p.audience === "sales");
  for (const gap of photoCoverage(photos)) {
    await orm(db)
      .insert(evidenceBlockers)
      .values({
        id: randomUUID(),
        opportunity_id: opportunityId,
        blocker_key: `photo:${gap.view}`,
        question: `Supply readable ${gap.view.replaceAll("_", " ")} evidence`,
        assignee_id: actor.userId,
        next_action: "Inspect supplied photos and request missing evidence from the seller",
        state: gap.state === "covered" ? "resolved" : "needs_review",
      })
      .onConflictDoUpdate({
        target: [evidenceBlockers.opportunity_id, evidenceBlockers.blocker_key],
        set: { state: sql`excluded.state` },
      });
  }
}
