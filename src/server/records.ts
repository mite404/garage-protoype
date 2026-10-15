import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import { database } from "./db";
import { refreshActor, type Actor } from "./access";
import { AppError } from "./errors";
import { photoView, photoCoverage } from "./photo-schema";

const publishedPhotos = `select distinct on(s.sha256) s.id,s.sha256,r.view,r.revision
  from signal_desk.sources s join signal_desk.opportunities o on o.id=s.opportunity_id
  join lateral (select * from signal_desk.photo_reviews where source_id=s.id order by revision desc limit 1) r on true
  where o.vehicle_id=v.id and s.kind='photo' and s.shareable and s.audience='sales'
  and r.approved and r.readable and r.view<>'unknown'
  order by s.sha256,r.revision desc,s.id`;

const publicSchema = z.object({
  id: z.string(),
  title: z.string(),
  photos: z.array(
    z.object({ id: z.string(), sha256: z.string(), view: photoView, revision: z.number() }),
  ),
  facts: z.array(
    z.object({
      field: z.string(),
      value: z.string(),
      citation: z.object({ sourceLabel: z.string(), excerpt: z.string() }),
    }),
  ),
});
const sourceSchema = z.object({
  id: z.string(),
  opportunity_id: z.string(),
  owner_id: z.uuid(),
  audience: z.enum(["private", "sales"]),
  name: z.string(),
  media_type: z.string(),
  content: z.instanceof(Buffer),
});

/** Returns only published, approved, shareable fields and citation excerpts.
 * @throws {AppError} If the vehicle has not been published.
 */
export async function getPublicVehicle(id: string, client?: PoolClient) {
  const result = await database(client).query(
    `select v.id,v.title,coalesce(
    (select jsonb_agg(jsonb_build_object('field',f.field,'value',f.value,'citation',
      jsonb_build_object('sourceLabel',f.source_label,'excerpt',f.citation_excerpt)) order by f.field)
    from signal_desk.public_facts f where f.vehicle_id=v.id and f.approved_at is not null and f.shareable),
    '[]'::jsonb) as facts,
    coalesce((select jsonb_agg(p) from (${publishedPhotos}) p),'[]'::jsonb) as photos
    from signal_desk.vehicles v where v.id=$1 and v.published_at is not null`,
    [id],
  );
  if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Vehicle not found.");
  const vehicle = publicSchema.parse(result.rows[0]);
  const coverage = photoCoverage(
    vehicle.photos.map((p) => ({
      sourceId: p.id,
      sha256: p.sha256,
      effective: { view: p.view, readable: true, reviewed: true, revision: p.revision },
    })),
  );
  return {
    ...vehicle,
    photos: vehicle.photos.map((p) => ({
      id: p.id,
      view: p.view,
      mediaUrl: `/api/v1/public/media/${encodeURIComponent(p.id)}`,
    })),
    coverage: coverage.map((c) => ({ view: c.view, state: c.state })),
    prototypeLabel: "Independent prototype · synthetic or permissioned evidence",
  };
}

/** Returns bytes only while the photo's latest review still explicitly approves public sharing.
 * @throws {AppError} For private, unapproved, unreadable or unpublished media.
 */
export async function getPublicPhoto(id: string) {
  const result = await database().query(
    `select s.content,s.media_type from signal_desk.sources s
    join signal_desk.opportunities o on o.id=s.opportunity_id
    join signal_desk.vehicles v on v.id=o.vehicle_id
    join lateral(select * from signal_desk.photo_reviews where source_id=s.id order by revision desc limit 1) r on true
    where s.id=$1 and s.kind='photo' and s.audience='sales' and s.shareable and v.published_at is not null and r.approved and r.readable and r.view<>'unknown'`,
    [id],
  );
  if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Photo not found.");
  return z
    .object({ content: z.instanceof(Buffer), media_type: z.enum(["image/png", "image/jpeg"]) })
    .parse(result.rows[0]);
}

/** Retrieves private source bytes only for their owner or an assigned sales reader.
 * @throws {AppError} For an inaccessible source, opportunity, or revoked actor.
 */
export async function getSource(actor: Actor, id: string, client?: PoolClient) {
  const current = await refreshActor(actor, client);
  const result = await database(client).query(
    `select s.id,s.opportunity_id,s.owner_id,s.audience,s.name,s.media_type,s.content
    from signal_desk.sources s join signal_desk.opportunities o on o.id=s.opportunity_id
    where s.id=$1 and (s.owner_id=$2 or (s.audience='sales' and $3='specialist')) and
    (($3='buyer' and o.buyer_id=$2) or ($3='specialist' and exists
      (select 1 from signal_desk.opportunity_members m where m.opportunity_id=o.id and m.user_id=$2)))`,
    [id, current.userId, current.role],
  );
  if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Source not found.");
  return sourceSchema.parse(result.rows[0]);
}
