import "server-only";
import type { PoolClient } from "pg";
import { z } from "zod";
import { and, desc, eq, exists, isNotNull, ne, or, sql } from "drizzle-orm";
import { orm } from "./db";
import {
  opportunities,
  opportunityMembers,
  photoReviews,
  publicFacts,
  sources,
  vehicles,
} from "./db-schema";
import { refreshActor, type Actor } from "./access";
import { AppError } from "./errors";
import { photoView, photoCoverage } from "@signal-desk/contracts/photo-schema";

function latestReview(db: ReturnType<typeof orm>) {
  return db
    .select()
    .from(photoReviews)
    .where(eq(photoReviews.source_id, sources.id))
    .orderBy(desc(photoReviews.revision))
    .limit(1)
    .as("latest_review");
}

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
  const db = orm(client);
  const r = latestReview(db);
  const photos = db
    .selectDistinctOn([sources.sha256], {
      id: sources.id,
      sha256: sources.sha256,
      view: r.view,
      revision: r.revision,
    })
    .from(sources)
    .innerJoin(opportunities, eq(opportunities.id, sources.opportunity_id))
    .innerJoinLateral(r, sql`true`)
    .where(
      and(
        eq(opportunities.vehicle_id, vehicles.id),
        eq(sources.kind, "photo"),
        eq(sources.shareable, true),
        eq(sources.audience, "sales"),
        eq(r.approved, true),
        eq(r.readable, true),
        ne(r.view, "unknown"),
      ),
    )
    .orderBy(sources.sha256, desc(r.revision), sources.id)
    .as("published_photos");
  const facts = db
    .select({
      value:
        sql`jsonb_build_object('field',${publicFacts.field},'value',${publicFacts.value},'citation',jsonb_build_object('sourceLabel',${publicFacts.source_label},'excerpt',${publicFacts.citation_excerpt}))`.as(
          "value",
        ),
      field: publicFacts.field,
    })
    .from(publicFacts)
    .where(
      and(
        eq(publicFacts.vehicle_id, vehicles.id),
        isNotNull(publicFacts.approved_at),
        eq(publicFacts.shareable, true),
      ),
    )
    .as("published_facts");
  const result = await db
    .select({
      id: vehicles.id,
      title: vehicles.title,
      facts: sql`coalesce((${db.select({ value: sql`jsonb_agg(${facts.value} order by ${facts.field})` }).from(facts)}),'[]'::jsonb)`,
      photos: sql`coalesce((${db.select({ value: sql`jsonb_agg(${sql.identifier("published_photos")})` }).from(photos)}),'[]'::jsonb)`,
    })
    .from(vehicles)
    .where(and(eq(vehicles.id, id), isNotNull(vehicles.published_at)));
  if (!result.length) throw new AppError(404, "NOT_FOUND", "Vehicle not found.");
  const vehicle = publicSchema.parse(result[0]);
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
  const db = orm();
  const r = latestReview(db);
  const result = await db
    .select({ content: sources.content, media_type: sources.media_type })
    .from(sources)
    .innerJoin(opportunities, eq(opportunities.id, sources.opportunity_id))
    .innerJoin(vehicles, eq(vehicles.id, opportunities.vehicle_id))
    .innerJoinLateral(r, sql`true`)
    .where(
      and(
        eq(sources.id, id),
        eq(sources.kind, "photo"),
        eq(sources.audience, "sales"),
        eq(sources.shareable, true),
        isNotNull(vehicles.published_at),
        eq(r.approved, true),
        eq(r.readable, true),
        ne(r.view, "unknown"),
      ),
    );
  if (!result.length) throw new AppError(404, "NOT_FOUND", "Photo not found.");
  return z
    .object({ content: z.instanceof(Buffer), media_type: z.enum(["image/png", "image/jpeg"]) })
    .parse(result[0]);
}

/** Retrieves private source bytes only for their owner or an assigned sales reader.
 * @throws {AppError} For an inaccessible source, opportunity, or revoked actor.
 */
export async function getSource(actor: Actor, id: string, client?: PoolClient) {
  const current = await refreshActor(actor, client);
  const db = orm(client);
  const result = await db
    .select({
      id: sources.id,
      opportunity_id: sources.opportunity_id,
      owner_id: sources.owner_id,
      audience: sources.audience,
      name: sources.name,
      media_type: sources.media_type,
      content: sources.content,
    })
    .from(sources)
    .innerJoin(opportunities, eq(opportunities.id, sources.opportunity_id))
    .where(
      and(
        eq(sources.id, id),
        or(
          eq(sources.owner_id, current.userId),
          and(eq(sources.audience, "sales"), sql`${current.role} = 'specialist'`),
        ),
        current.role === "buyer"
          ? eq(opportunities.buyer_id, current.userId)
          : exists(
              db
                .select({ id: opportunityMembers.opportunity_id })
                .from(opportunityMembers)
                .where(
                  and(
                    eq(opportunityMembers.opportunity_id, opportunities.id),
                    eq(opportunityMembers.user_id, current.userId),
                  ),
                ),
            ),
      ),
    );
  if (!result.length) throw new AppError(404, "NOT_FOUND", "Source not found.");
  return sourceSchema.parse(result[0]);
}
