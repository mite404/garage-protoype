import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { Actor } from "./access";
import { AppError } from "./errors";
import { photoView, photoReview, photoCoverage } from "./photo-schema";

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
  const result = await db.query(
    `select s.id as "sourceId",s.sha256,s.name,s.audience,s.shareable,s.provenance,
    (select jsonb_build_object('view',p.view,'readable',p.readable,'reason',p.reason,'revision',p.revision,'jobId',p.job_id,'model',j.model)
      from signal_desk.photo_suggestions p join signal_desk.import_jobs j on j.id=p.job_id where p.source_id=s.id order by p.revision desc limit 1) as suggestion,
    (select jsonb_build_object('view',r.view,'readable',r.readable,'reason',r.reason,'revision',r.revision,'approved',r.approved)
      from signal_desk.photo_reviews r where r.source_id=s.id order by r.revision desc limit 1) as review
    from signal_desk.sources s where s.opportunity_id=$1 and s.kind='photo' and (s.owner_id=$2 or s.audience='sales') order by s.created_at,s.id`,
    [opportunityId, actor.userId],
  );
  return z
    .array(photoRow)
    .parse(result.rows)
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
  await db.query(
    `insert into signal_desk.photo_reviews(id,source_id,actor_id,view,readable,approved,reason,revision) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      randomUUID(),
      photo.sourceId,
      actor.userId,
      command.view,
      command.readable,
      command.approved,
      command.reason,
      revision + 1,
    ],
  );
}

/** Refreshes stable photo blockers in the opportunity; private photos never resolve shared tasks. */
export async function refreshPhotoBlockers(db: PoolClient, actor: Actor, opportunityId: string) {
  const photos = (await readPhotos(db, actor, opportunityId)).filter((p) => p.audience === "sales");
  for (const gap of photoCoverage(photos)) {
    await db.query(
      `insert into signal_desk.evidence_blockers(id,opportunity_id,blocker_key,question,assignee_id,next_action,state)
    values ($1,$2,$3,$4,$5,$6,$7) on conflict(opportunity_id,blocker_key) do update set state=excluded.state`,
      [
        randomUUID(),
        opportunityId,
        `photo:${gap.view}`,
        `Supply readable ${gap.view.replaceAll("_", " ")} evidence`,
        actor.userId,
        "Inspect supplied photos and request missing evidence from the seller",
        gap.state === "covered" ? "resolved" : "needs_review",
      ],
    );
  }
}
