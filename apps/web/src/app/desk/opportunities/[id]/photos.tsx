"use client";

import Image from "next/image";
import type { Workbench } from "@/server/evidence";
import { photoLabels, photoView } from "@signal-desk/contracts/photo-schema";

const coverageLabels: Record<string, string> = {
  covered: "Reviewed readable",
  missing: "Missing",
  unreadable: "Unreadable",
  needs_review: "Needs review",
};

/** Reviews supplied originals only. Request edits are local suggestions, never sent or saved as drafts. */
export default function PhotoReview({
  view,
  pending,
  save,
}: {
  view: Workbench;
  pending: boolean;
  save: (command: unknown) => Promise<void>;
}) {
  const covered = view.coverage.filter((c) => c.state === "covered").length;
  return (
    <section className="evidence-panel mt-6" aria-labelledby="photos-heading" id="photo-review">
      <div className="section-heading">
        <div>
          <p className="eyebrow mb-2">Actual photo evidence</p>
          <h2 id="photos-heading">See what is still missing.</h2>
        </div>
        <span className="state state-unknown">{covered} of 8 views reviewed readable</span>
      </div>
      <div className="px-6 pb-6">
        <p className="text-sm text-stone-600">
          Coverage describes supplied photos, not an inspection or a safety assessment. Private
          photos do not complete shared coverage. Duplicate images count once.
        </p>
        <p className="saved-notice mt-4">
          Live vision unavailable. No provider is installed. Inspect and label the actual photos
          below; no extraction is fabricated.
        </p>
        <ul className="my-5 grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Photo coverage">
          {view.coverage.map((c) => (
            <li key={c.view} className="rounded-md border border-stone-200 p-3" data-view={c.view}>
              <strong className="block text-sm">{photoLabels[c.view]}</strong>
              <span
                className={`mt-2 state state-${c.state === "covered" ? "reviewed" : c.state === "unreadable" ? "conflict" : "unknown"}`}
              >
                {coverageLabels[c.state]}
              </span>
            </li>
          ))}
        </ul>
        {!view.photos.length && (
          <p className="py-5 text-sm text-stone-600">
            No photos supplied. Upload a permissioned PNG or JPEG using Add evidence below.
          </p>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          {view.photos.map((photo) => (
            <article
              className="min-w-0 rounded-lg border border-stone-200 p-4"
              key={photo.sourceId}
            >
              <a
                href={`/api/v1/desk/sources/${encodeURIComponent(photo.sourceId)}/content`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Inspect original ${photo.name} in a new tab`}
              >
                <Image
                  unoptimized
                  width={800}
                  height={600}
                  className="h-52 w-full rounded-md bg-stone-100 object-contain"
                  src={`/api/v1/desk/sources/${encodeURIComponent(photo.sourceId)}/content`}
                  alt={`Supplied original: ${photo.name}`}
                />
              </a>
              <h3 className="mt-3 break-words text-base font-semibold">{photo.name}</h3>
              <p className="mt-1 text-xs text-stone-500">
                {photo.audience === "private" ? "Private · Only you" : "Assigned specialists"} ·
                Open image to inspect original
              </p>
              <p className="mt-3 text-sm">
                <strong>{photo.effective.reviewed ? "Specialist review" : "Unreviewed"}</strong> ·{" "}
                {photoLabels[photo.effective.view]} ·{" "}
                {photo.effective.readable ? "Readable" : "Unreadable / unconfirmed"}
              </p>
              <p className="mt-1 text-xs text-stone-600">{photo.effective.reason}</p>
              {photo.suggestion && (
                <p className="mt-3 text-xs text-stone-500">
                  Preserved machine suggestion · {photoLabels[photo.suggestion.view]} ·{" "}
                  {photo.suggestion.readable ? "Readable" : "Unreadable"} · {photo.suggestion.model}
                  <br />
                  {photo.suggestion.reason}
                </p>
              )}
              <form
                key={view.revision}
                className="mt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void save({
                    kind: "reviewPhoto",
                    sourceId: photo.sourceId,
                    view: form.get("view"),
                    readable: form.get("readable") === "true",
                    approved: form.get("approved") === "on",
                    reason: form.get("reason"),
                  });
                }}
              >
                <fieldset disabled={pending}>
                  <div className="form-grid">
                    <div>
                      <label htmlFor={`${photo.sourceId}-view`}>Photo view</label>
                      <select
                        id={`${photo.sourceId}-view`}
                        name="view"
                        defaultValue={photo.effective.view}
                      >
                        {photoView.options.map((v) => (
                          <option key={v} value={v}>
                            {photoLabels[v]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`${photo.sourceId}-readable`}>Readability</label>
                      <select
                        id={`${photo.sourceId}-readable`}
                        name="readable"
                        defaultValue={String(photo.effective.readable)}
                      >
                        <option value="false">Unreadable / unconfirmed</option>
                        <option value="true">Readable</option>
                      </select>
                    </div>
                  </div>
                  <label className="mt-3" htmlFor={`${photo.sourceId}-photo-reason`}>
                    Review note
                  </label>
                  <input
                    id={`${photo.sourceId}-photo-reason`}
                    name="reason"
                    required
                    maxLength={1000}
                    defaultValue={photo.review?.reason ?? ""}
                    placeholder="What can you actually see?"
                  />
                  <label className="check-label mt-3">
                    <input
                      name="approved"
                      type="checkbox"
                      disabled={!photo.shareable || photo.audience !== "sales"}
                      defaultChecked={photo.review?.approved ?? false}
                    />{" "}
                    Approve this readable view for public sharing
                    {!photo.shareable || photo.audience !== "sales"
                      ? " (source permission unavailable)"
                      : ""}
                  </label>
                  <button className="button mt-3">Save photo review</button>
                </fieldset>
              </form>
            </article>
          ))}
        </div>
        <details className="mt-6 rounded-lg border border-stone-200 p-4" id="photo-request">
          <summary className="font-semibold">Suggested seller request · Unsent</summary>
          <p className="mt-3 text-xs text-stone-600">
            Editable preview only. Changes here are not persisted. No send action exists. Final
            drafts belong to the follow-up workflow.
          </p>
          <div key={view.revision}>
            <label className="mt-4" htmlFor="photo-recipient">
              Proposed recipient
            </label>
            <input id="photo-recipient" defaultValue={view.photoRequest.recipientLabel} />
            <label className="mt-4" htmlFor="photo-request-body">
              Missing-evidence request
            </label>
            <textarea id="photo-request-body" rows={10} defaultValue={view.photoRequest.body} />
          </div>
          <p className="mt-3 text-xs text-stone-500">
            Opportunity {view.opportunityId} · Based on revision {view.photoRequest.basisRevision}
          </p>
          <ul className="mt-3 space-y-2 text-xs text-stone-600">
            {view.photoRequest.gaps.map((g) => (
              <li key={g.view}>
                {photoLabels[g.view]} ·{" "}
                {g.blockerId
                  ? `Blocker ${g.blockerId}`
                  : "Blocker will be recorded with the first photo upload"}{" "}
                · {g.sourceIds.length} supplied source references
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
