import { z } from "zod";

/** View labels describe supplied evidence, never vehicle condition. */
export const photoView = z.enum([
  "front",
  "rear",
  "driver_side",
  "passenger_side",
  "cab",
  "pump_panel",
  "odometer",
  "identification_plate",
  "unknown",
]);
/** Machine suggestions cannot approve disclosure. */
export const photoSuggestion = z
  .object({
    sourceId: z.string(),
    view: photoView,
    readable: z.boolean(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
/** A human review keeps its original suggestion and explicitly controls publication. */
export const photoReview = photoSuggestion
  .extend({ kind: z.literal("reviewPhoto"), approved: z.boolean() })
  .strict();
/** Display names share the category keys used by reviews, coverage and requests. */
export const photoLabels: Record<z.infer<typeof photoView>, string> = {
  front: "Front",
  rear: "Rear",
  driver_side: "Driver side",
  passenger_side: "Passenger side",
  cab: "Cab",
  pump_panel: "Pump panel",
  odometer: "Odometer",
  identification_plate: "Identification plate",
  unknown: "Unknown view",
};

type CoveragePhoto = {
  sourceId: string;
  sha256: string;
  effective: {
    view: z.infer<typeof photoView>;
    readable: boolean;
    reviewed: boolean;
    revision: number;
  };
};

/** Counts each unique image once; the newest human decision wins over machine suggestions.
 * Suggested or unknown views never count as reviewed coverage.
 */
export function photoCoverage(photos: CoveragePhoto[]) {
  const ordered = photos.toSorted(
    (a, b) =>
      Number(b.effective.reviewed) - Number(a.effective.reviewed) ||
      b.effective.revision - a.effective.revision ||
      a.sourceId.localeCompare(b.sourceId),
  );
  const unique = ordered.filter(
    (p, i) => ordered.findIndex((other) => other.sha256 === p.sha256) === i,
  );
  return photoView.options
    .filter((view) => view !== "unknown")
    .map((view) => {
      const related = unique.filter((p) => p.effective.view === view);
      const covered = related.some((p) => p.effective.reviewed && p.effective.readable);
      const state = covered
        ? "covered"
        : related.some((p) => !p.effective.readable)
          ? "unreadable"
          : related.length
            ? "needs_review"
            : "missing";
      return { view, state, sourceIds: related.map((p) => p.sourceId) };
    });
}

/** Builds unsent content only. ETH-77 owns persistence and follow-up operations.
 * References come from the authorized opportunity, not inferred contacts or recipients.
 */
export function suggestPhotoRequest(input: {
  opportunityId: string;
  vehicleId: string;
  revision: number;
  coverage: ReturnType<typeof photoCoverage>;
  evidenceSourceIds: string[];
  blockers: { id: string; key: string; question: string; assigneeId: string }[];
}) {
  const gaps = input.coverage
    .filter((c) => c.state !== "covered")
    .map((c) => {
      const blocker = input.blockers.find((b) => b.key === `photo:${c.view}`);
      return {
        ...c,
        blockerKey: `photo:${c.view}`,
        blockerId: blocker?.id ?? null,
        question: blocker?.question ?? null,
        assigneeId: blocker?.assigneeId ?? null,
      };
    });
  const requests = gaps.map((g) =>
    g.state === "unreadable"
      ? `A readable replacement for the ${photoLabels[g.view].toLowerCase()} photo.`
      : `A readable ${photoLabels[g.view].toLowerCase()} photo${g.state === "needs_review" ? " if specialist review cannot confirm the supplied view" : ""}.`,
  );
  return {
    kind: "photo_evidence_request" as const,
    opportunityId: input.opportunityId,
    vehicleId: input.vehicleId,
    basisRevision: input.revision,
    evidenceSourceIds: input.evidenceSourceIds,
    recipientLabel: "Vehicle seller (recipient to be confirmed)",
    status: "unsent_suggestion" as const,
    gaps,
    body: requests.length
      ? `Please supply the following vehicle evidence:\n${requests.map((r) => `- ${r}`).join("\n")}\nThese are requests for supplied photos, not a vehicle inspection or safety assessment.`
      : "No additional photo views are requested. Reviewed coverage is not an inspection or safety assessment.",
  };
}
