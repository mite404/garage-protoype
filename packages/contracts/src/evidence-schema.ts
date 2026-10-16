import { z } from "zod";
import { photoReview, photoSuggestion } from "@signal-desk/contracts/photo-schema";

/** Supported specification keys; other facts remain explicitly unknown. */
export const fieldSchema = z.enum([
  "year",
  "chassisManufacturer",
  "bodyBuilder",
  "model",
  "mileage",
  "pumpCapacity",
  "tankCapacity",
  "fuel",
  "transmission",
  "serviceRecords",
  "pumpTest",
]);
/** Classification is a routing suggestion, never a publication permission. */
export const classificationKind = z.enum([
  "supported",
  "conflict",
  "missing_evidence",
  "private_context",
  "human_review",
  "conditional_offer",
]);
/** Exact excerpt offsets are UTF-16 code units within the one-based source page. */
export const extractedClaim = z
  .object({
    sourceId: z.string().min(1),
    field: fieldSchema,
    value: z.string().trim().min(1).max(200),
    unit: z.enum(["", "gal", "gpm", "mi", "km", "L", "L/min"]),
    page: z.number().int().min(1).max(500),
    start: z.number().int().min(0),
    end: z.number().int().positive(),
    excerpt: z.string().min(1).max(2000),
  })
  .strict();
/** Provider output must cite supplied source pages and classify every supplied source. */
export const extractionSchema = z
  .object({
    claims: z.array(extractedClaim).max(200),
    photos: z.array(photoSuggestion).max(20).default([]),
    classifications: z
      .array(
        z
          .object({
            sourceId: z.string(),
            kind: classificationKind,
            basis: z.string().min(1).max(2000),
            nextAction: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
const selection = z.object({ field: fieldSchema, claimId: z.string(), shareable: z.boolean() });
/** Human commands append decisions without modifying source assertions. */
export const reviewSchema = z.discriminatedUnion("kind", [
  photoReview,
  selection.extend({ kind: z.literal("select") }).strict(),
  selection
    .extend({
      kind: z.literal("correct"),
      value: z.string().trim().min(1).max(200),
      unit: extractedClaim.shape.unit,
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unknown"),
      field: fieldSchema,
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("classify"),
      sourceId: z.string(),
      classification: classificationKind,
      reason: z.string().trim().min(1).max(2000),
      nextAction: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
/** Display labels do not change field identity or units. */
export const fieldLabels: Record<z.infer<typeof fieldSchema>, string> = {
  year: "Model year",
  chassisManufacturer: "Chassis manufacturer",
  bodyBuilder: "Body builder",
  model: "Model",
  mileage: "Mileage",
  pumpCapacity: "Pump capacity",
  tankCapacity: "Tank capacity",
  fuel: "Fuel",
  transmission: "Transmission",
  serviceRecords: "Service records",
  pumpTest: "Pump-test result",
};

const numericUnits: Record<string, readonly string[]> = {
  year: [""],
  mileage: ["mi", "km"],
  tankCapacity: ["gal", "L"],
  pumpCapacity: ["gpm", "L/min"],
};

/** Normalizes numeric formatting, preserving units instead of guessing conversions.
 * @throws {Error} For a value or unit incompatible with its field.
 */
export function canonicalValue(field: string, value: string, unit: string) {
  const allowed = numericUnits[field];
  if (allowed) {
    if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))
      throw new Error("Invalid numeric evidence");
    if (!allowed.includes(unit)) throw new Error("Invalid evidence unit");
    return `${Number(value)} ${unit}`.trim();
  }
  if (unit) throw new Error("Unexpected evidence unit");
  return value.trim().toLowerCase();
}
