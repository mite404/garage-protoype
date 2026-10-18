import { z } from "zod";

/** Validated municipality metadata shared by the server and catalog. */
export const organizationSchema = z.object({
  id: z.string(),
  name: z.string().max(200),
  city: z.string().max(100),
  region: z.string().max(100),
  unit: z.string().max(100),
  synthetic: z.boolean(),
});
const termsSchema = z.object({
  amountCents: z.number().int().positive(),
  currency: z.literal("USD"),
  stage: z.enum(["proposed", "contingent", "escrow_simulated"]),
  conditions: z.array(z.string().min(1).max(500)).min(1).max(12),
});
const acquisitionSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  title: z.string().max(300),
  seller: z.string().max(200).nullable(),
  terms: termsSchema.nullable(),
});
/** Workspace projection. Activity contains metadata, never message bodies. */
export const workspaceSchema = z.object({
  organization: organizationSchema,
  thumbnails: z.record(z.string(), z.object({ url: z.string(), label: z.string() })).optional(),
  acquisitions: z.tuple([acquisitionSchema]).rest(acquisitionSchema),
  activity: z.array(
    z.object({
      id: z.string(),
      vehicleId: z.string(),
      title: z.string(),
      seller: z.string().max(200).nullable(),
      kind: z.enum(["favorite", "contact"]),
      occurredAt: z.date(),
    }),
  ),
  ownedListings: z.array(
    z.object({ id: z.string(), title: z.string(), publishedAt: z.date().nullable() }),
  ),
});

export type MunicipalityWorkspace = z.infer<typeof workspaceSchema>;
