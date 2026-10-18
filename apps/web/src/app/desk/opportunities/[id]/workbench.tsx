"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import type { Workbench } from "@/server/evidence";
import { classificationKind, fieldLabels } from "@signal-desk/contracts/evidence-schema";
import PhotoReview from "./photos";

const labels = {
  unknown: "Unknown",
  unreviewed: "Needs review",
  conflict: "Conflicting claims",
  needs_review: "Review required",
  reviewed: "Reviewed",
};
const reviewOrder = { conflict: 0, needs_review: 1, unreviewed: 2, reviewed: 3, unknown: 4 };

function factDescription(fact: Workbench["facts"][number]) {
  if (fact.kind !== "reviewed") return fact.reason;
  const disclosure = fact.shareable ? "Approved for public excerpts" : "Internal review only";
  const origin = fact.sourceKind.startsWith("seller")
    ? "Seller-reported, not document verified."
    : "The original assertion remains below.";
  return `${disclosure}. ${origin}`;
}

async function postEvidence(path: string, body: FormData | string, revision?: number) {
  const headers = new Headers({ "Idempotency-Key": crypto.randomUUID() });
  if (typeof body === "string") headers.set("Content-Type", "application/json");
  if (revision !== undefined) headers.set("If-Match", `"${revision}"`);
  const response = await fetch(path, { method: "POST", headers, body });
  if (!response.ok) {
    const result = z
      .object({ error: z.object({ message: z.string() }) })
      .parse(await response.json());
    throw new Error(result.error.message);
  }
}

function assertionCount(count: number) {
  return `${count} source ${count === 1 ? "assertion" : "assertions"}`;
}

/** Finite developer-authored review UI. All mutations return to authorized server operations. */
export default function EvidenceWorkbench({
  view,
  conversation,
}: {
  view: Workbench;
  conversation: ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const base = `/api/v1/desk/vehicles/${encodeURIComponent(view.vehicleId)}`;
  const query = `?opportunityId=${encodeURIComponent(view.opportunityId)}`;
  const conflicts = view.facts.filter((f) => f.kind === "conflict").length;
  const reviewed = view.facts.filter((f) => f.kind === "reviewed").length;
  const saved = view.jobs.some((j) => j.mode === "saved_example");

  async function mutate(path: string, body: FormData | unknown, revision?: number) {
    if (pending) return;
    setPending(true);
    setMessage("");
    setError(false);
    try {
      await postEvidence(path, body instanceof FormData ? body : JSON.stringify(body), revision);
      setMessage("Saved. Original evidence has been preserved.");
      router.refresh();
    } catch (problem) {
      setError(true);
      setMessage(String(problem));
    } finally {
      setPending(false);
    }
  }

  function review(event: FormEvent<HTMLFormElement>, field: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = form.get("kind");
    const command =
      kind === "unknown"
        ? { kind, field, reason: form.get("reason") }
        : {
            kind,
            field,
            claimId: form.get("claimId"),
            shareable: form.get("shareable") === "on",
            ...(kind === "correct"
              ? { value: form.get("value"), unit: form.get("unit"), reason: form.get("reason") }
              : {}),
          };
    void mutate(`${base}/reviews${query}`, command, view.revision);
  }

  return (
    <section className="evidence-desk" aria-busy={pending}>
      <nav aria-label="Breadcrumb" className="mb-7 text-sm text-muted-foreground">
        <Link href="/desk">Opportunities</Link>
        <span className="mx-3" aria-hidden="true">
          /
        </span>
        Evidence review
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="eyebrow mb-3">Evidence workbench · {view.opportunityId}</p>
          <h1 className="workbench-title">{view.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Resolve what the evidence says before a buyer relies on it.
          </p>
        </div>
        <Link href={`/vehicles/${encodeURIComponent(view.vehicleId)}`} className="quiet-button">
          View public record ↗
        </Link>
      </div>
      {conversation}
      <div className="evidence-summary mt-7">
        <span>
          <strong>{view.sources.length}</strong> sources preserved
        </span>
        <span>
          <strong>{conflicts}</strong> {conflicts === 1 ? "conflict" : "conflicts"} to resolve
        </span>
        <span>
          <strong>{reviewed}</strong> reviewed facts
        </span>
        <span className="text-muted-foreground">Revision {view.revision}</span>
      </div>
      {saved && (
        <p className="saved-notice mt-5">
          Saved synthetic example · No live extraction. No automatic approvals.
        </p>
      )}
      <output
        aria-live="polite"
        className={`mt-4 block text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}
      >
        {pending ? "Saving…" : message}
      </output>
      <PhotoReview
        view={view}
        pending={pending}
        save={(command) => mutate(`${base}/reviews${query}`, command, view.revision)}
      />
      <div className="evidence-layout mt-5">
        <div className="min-w-0 space-y-6">
          <section className="evidence-panel" aria-labelledby="facts-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow mb-2">01 · Review</p>
                <h2 id="facts-heading">Claims, not assumptions.</h2>
              </div>
              <span className="text-xs text-muted-foreground">Human approval required</span>
            </div>
            <p className="px-6 pb-4 text-sm text-muted-foreground">
              A reviewed seller statement remains seller-reported. Approval is separate from
              permission to share.
            </p>
            {view.facts
              .toSorted((a, b) => reviewOrder[a.kind] - reviewOrder[b.kind])
              .map((fact) => {
                const claims = view.claims.filter((c) => c.field === fact.field);
                return (
                  <details
                    className="fact-row"
                    key={fact.field}
                    open={fact.kind === "conflict" || undefined}
                  >
                    <summary>
                      <span className="font-semibold">{fieldLabels[fact.field]}</span>
                      <span className={`state state-${fact.kind}`}>{labels[fact.kind]}</span>
                      {fact.kind === "reviewed" ? (
                        <span className="fact-value">
                          {fact.value} {fact.unit}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {claims.length ? assertionCount(claims.length) : "No approved answer"}
                        </span>
                      )}
                    </summary>
                    <div className="fact-body">
                      <p className="mb-4 text-sm text-muted-foreground">{factDescription(fact)}</p>
                      <div className="claim-grid">
                        {claims.map((claim) => (
                          <blockquote key={claim.id} className="claim-card">
                            <p className="text-xs font-semibold text-muted-foreground">
                              {claim.sourceKind.startsWith("seller")
                                ? "Seller-reported"
                                : "Document assertion"}
                            </p>
                            <p className="my-2 text-2xl font-semibold tabular-nums">
                              {claim.value}{" "}
                              <span className="text-base font-normal text-muted-foreground">
                                {claim.unit}
                              </span>
                            </p>
                            <p className="text-sm">“{claim.excerpt}”</p>
                            <footer className="mt-3 text-xs text-muted-foreground">
                              {claim.sourceName}
                              <br />
                              Page {claim.page} · characters {claim.start}-{claim.end}
                            </footer>
                          </blockquote>
                        ))}
                      </div>
                      {view.reviews.some((r) => r.field === fact.field) && (
                        <details className="mt-4 text-sm">
                          <summary>Preserved review history</summary>
                          {view.reviews
                            .filter((r) => r.field === fact.field)
                            .map((r) => (
                              <p className="mt-3" key={r.id}>
                                Revision {r.revision} · {r.kind} · {r.value} {r.unit}
                                <br />
                                {r.reason}
                              </p>
                            ))}
                        </details>
                      )}
                      <form
                        key={view.revision}
                        className="review-form mt-5"
                        onSubmit={(e) => review(e, fact.field)}
                      >
                        <fieldset disabled={pending}>
                          <div className="form-grid">
                            <div>
                              <label htmlFor={`${fact.field}-kind`}>Review decision</label>
                              <select
                                id={`${fact.field}-kind`}
                                name="kind"
                                defaultValue={
                                  claims.length && fact.kind !== "needs_review"
                                    ? "select"
                                    : "unknown"
                                }
                              >
                                <option
                                  value="select"
                                  disabled={!claims.length || fact.kind === "needs_review"}
                                >
                                  Select a source assertion
                                </option>
                                <option
                                  value="correct"
                                  disabled={!claims.length || fact.kind === "needs_review"}
                                >
                                  Correct with evidence
                                </option>
                                <option value="unknown">Keep unknown</option>
                              </select>
                            </div>
                            {claims.length > 0 && (
                              <div>
                                <label htmlFor={`${fact.field}-claim`}>Supporting source</label>
                                <select id={`${fact.field}-claim`} name="claimId">
                                  {claims.map((c) => (
                                    <option value={c.id} key={c.id}>
                                      {c.sourceName} · {c.value} {c.unit}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                          {claims.length > 0 && (
                            <details className="mt-4">
                              <summary className="text-sm text-muted-foreground">
                                Correction value and unit
                              </summary>
                              <div className="form-grid mt-3">
                                <div>
                                  <label htmlFor={`${fact.field}-value`}>Corrected value</label>
                                  <input id={`${fact.field}-value`} name="value" maxLength={200} />
                                </div>
                                <div>
                                  <label htmlFor={`${fact.field}-unit`}>Unit</label>
                                  <select
                                    id={`${fact.field}-unit`}
                                    name="unit"
                                    defaultValue={claims[0]?.unit}
                                  >
                                    <option value="">No unit</option>
                                    {["gal", "gpm", "mi", "km", "L", "L/min"].map((u) => (
                                      <option key={u}>{u}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </details>
                          )}
                          <label className="mt-4" htmlFor={`${fact.field}-reason`}>
                            Reason or correction basis
                          </label>
                          <input
                            id={`${fact.field}-reason`}
                            name="reason"
                            placeholder="Required for corrections and unknown decisions"
                            maxLength={2000}
                          />
                          {claims.length > 0 && (
                            <label className="check-label mt-4">
                              <input type="checkbox" name="shareable" /> Approve public value and
                              cited excerpt, only where source permission allows
                            </label>
                          )}
                          <button className="button mt-4" type="submit">
                            Save review
                          </button>
                        </fieldset>
                      </form>
                    </div>
                  </details>
                );
              })}
          </section>
          <section className="evidence-panel" aria-labelledby="sources-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow mb-2">02 · Inspect</p>
                <h2 id="sources-heading">Original source packet</h2>
              </div>
            </div>
            {!view.sources.length && (
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                No sources yet. Add a permissioned source or load the labeled synthetic example.
              </p>
            )}
            {view.sources.map((source) => {
              const classification = view.classifications.find((c) => c.sourceId === source.id);
              return (
                <details key={source.id} className="source-row">
                  <summary>
                    <span className="min-w-0">
                      <strong className="block break-words text-sm">{source.name}</strong>
                      <span className="text-xs text-muted-foreground">
                        {source.kind.replaceAll("_", " ")} · {source.audience} · {source.permission}
                      </span>
                    </span>
                    <span className="state state-unknown">
                      {classification?.kind.replaceAll("_", " ") ?? "Not classified"}
                    </span>
                  </summary>
                  <div className="fact-body">
                    <p className="text-sm text-muted-foreground">{source.provenance}</p>
                    <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">
                      SHA256 {source.sha256}
                    </p>
                    <a
                      className="mt-3 inline-block text-sm text-primary underline"
                      href={`/api/v1/desk/sources/${encodeURIComponent(source.id)}/content`}
                    >
                      Download original
                    </a>
                    {source.pages.map((page, index) => (
                      <div className="source-page mt-4" key={index}>
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">
                          Page {index + 1}
                        </p>
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                          {page}
                        </pre>
                      </div>
                    ))}
                    {source.blockerId && (
                      <p className="mt-4 text-sm">
                        Seller response linked to buyer blocker. Review and share permission are
                        required before disclosure.
                      </p>
                    )}
                    {classification && (
                      <div className="mt-4 text-sm">
                        <strong>
                          {classification.reviewed
                            ? "Specialist correction"
                            : "Extraction suggestion"}
                        </strong>
                        <p>{classification.basis}</p>
                        <p className="mt-1 text-muted-foreground">
                          Next action · {classification.nextAction}
                        </p>
                      </div>
                    )}
                    {classification && (
                      <details className="mt-4 text-sm">
                        <summary>Preserved classification history</summary>
                        {view.classificationHistory
                          .filter((c) => c.sourceId === source.id)
                          .map((c) => (
                            <p className="mt-3" key={c.id}>
                              Revision {c.revision} ·{" "}
                              {c.reviewed ? "Specialist" : "Extraction suggestion"} ·{" "}
                              {c.kind.replaceAll("_", " ")}
                              <br />
                              {c.basis}
                              <br />
                              {c.nextAction}
                            </p>
                          ))}
                      </details>
                    )}
                    <details className="mt-4">
                      <summary className="text-sm font-semibold">
                        Correct classification and next action
                      </summary>
                      <form
                        className="mt-4"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          void mutate(
                            `${base}/reviews${query}`,
                            {
                              kind: "classify",
                              sourceId: source.id,
                              classification: form.get("classification"),
                              reason: form.get("reason"),
                              nextAction: form.get("nextAction"),
                            },
                            view.revision,
                          );
                        }}
                      >
                        <fieldset disabled={pending}>
                          <label htmlFor={`${source.id}-classification`}>Classification</label>
                          <select
                            id={`${source.id}-classification`}
                            name="classification"
                            defaultValue={classification?.kind ?? "human_review"}
                          >
                            {classificationKind.options.map((kind) => (
                              <option key={kind} value={kind}>
                                {kind.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                          <label className="mt-4" htmlFor={`${source.id}-reason`}>
                            Evidence for this correction
                          </label>
                          <input
                            id={`${source.id}-reason`}
                            name="reason"
                            required
                            maxLength={2000}
                          />
                          <label className="mt-4" htmlFor={`${source.id}-next`}>
                            Next human action
                          </label>
                          <input
                            id={`${source.id}-next`}
                            name="nextAction"
                            required
                            maxLength={500}
                          />
                          <button className="button mt-4">Save classification</button>
                        </fieldset>
                      </form>
                    </details>
                  </div>
                </details>
              );
            })}
          </section>
          <section className="evidence-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow mb-2">03 · Add evidence</p>
                <h2>Keep the original.</h2>
              </div>
            </div>
            <form
              className="px-6 pb-6"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(`${base}/sources${query}`, new FormData(event.currentTarget));
              }}
            >
              <fieldset disabled={pending}>
                <label htmlFor="source-name">Source name</label>
                <input
                  id="source-name"
                  name="name"
                  required
                  maxLength={200}
                  placeholder="Seller response or document title"
                />
                <div className="form-grid mt-4">
                  <div>
                    <label htmlFor="source-kind">Source type</label>
                    <select id="source-kind" name="kind">
                      <option value="document">Document</option>
                      <option value="photo">Actual photo</option>
                      <option value="seller_note">Seller note</option>
                      <option value="private_note">Private context</option>
                      <option value="inquiry">Ambiguous inquiry</option>
                      <option value="seller_response">Seller response to blocker</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="source-audience">Who can inspect it?</label>
                    <select id="source-audience" name="audience">
                      <option value="private">Only me</option>
                      <option value="sales">Assigned specialists</option>
                    </select>
                  </div>
                </div>
                <label className="mt-4" htmlFor="source-text">
                  Original note
                </label>
                <textarea id="source-text" name="text" rows={3} maxLength={2000000} />
                <label className="mt-4" htmlFor="source-file">
                  Or upload a text-based PDF, UTF-8 text, PNG or JPEG
                </label>
                <input
                  id="source-file"
                  name="file"
                  type="file"
                  accept="application/pdf,text/plain,image/png,image/jpeg"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Photos up to 5 MiB · Text/PDF up to 10 MiB and 500 pages · No scanned PDF OCR.
                </p>
                <div className="form-grid mt-4">
                  <div>
                    <label htmlFor="source-permission">Material permission</label>
                    <select id="source-permission" name="permission">
                      <option value="synthetic">Synthetic data</option>
                      <option value="permissioned">I have permission to use this</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="source-blocker">Originating buyer blocker</label>
                    <select id="source-blocker" name="blockerId">
                      <option value="">Not a seller response</option>
                      {view.blockers.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.question}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="mt-4" htmlFor="source-provenance">
                  Where did it come from?
                </label>
                <input
                  id="source-provenance"
                  name="provenance"
                  required
                  maxLength={1000}
                  placeholder="Permission and source context"
                />
                <label className="check-label mt-4">
                  <input name="shareable" type="checkbox" /> I authorize public excerpts after
                  specialist review. Private context cannot be published.
                </label>
                <button className="button mt-5">Preserve source</button>
              </fieldset>
            </form>
          </section>
        </div>
        <aside className="min-w-0 space-y-5" aria-label="Buyer context and processing">
          <section className="evidence-panel context-panel">
            <p className="eyebrow mb-3">Keep the deal in view</p>
            <h2>Buyer blockers</h2>
            <p className="mt-2 text-sm text-muted-foreground">No reply is sent automatically.</p>
            {!view.blockers.length && (
              <p className="mt-5 text-sm text-muted-foreground">
                No buyer blocker has been recorded.
              </p>
            )}
            {view.blockers.map((blocker) => (
              <div key={blocker.id} className="blocker mt-5">
                <span
                  className={`state state-${blocker.state === "resolved" ? "reviewed" : "needs_review"}`}
                >
                  {blocker.state === "resolved" ? "Evidence reviewed" : "Needs human review"}
                </span>
                <p className="mt-3 text-sm font-semibold">{blocker.question}</p>
                <p className="mt-2 text-sm text-muted-foreground">{blocker.nextAction}</p>
                <p className="mt-3 break-all text-[11px] text-muted-foreground">
                  Assigned specialist · {blocker.assigneeId}
                </p>
              </div>
            ))}
            <div className="mt-6 border-t border-border pt-5">
              <p className="text-xs font-semibold text-muted-foreground">NEXT ACTION</p>
              <p className="mt-2 text-sm">
                {view.nextAction || "Inspect the source packet and identify the next human action."}
              </p>
            </div>
          </section>
          <section className="evidence-panel context-panel">
            <h2>Import activity</h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Durable jobs survive reloads. Originals and corrections stay intact.
            </p>
            {view.jobs.map((job) => (
              <div className="mt-5 border-t border-border pt-4" key={job.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="state state-unknown">{job.state}</span>
                  <span className="text-xs text-muted-foreground">Attempt {job.attempt}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {job.mode === "saved_example" ? "Saved synthetic run" : "Provider extraction"}
                </p>
                {job.error && (
                  <p className="mt-2 break-words text-xs text-destructive">
                    {job.error}.{" "}
                    {job.error === "SPEND_UNCERTAIN"
                      ? "Reservation retained. Operator reconciliation is required."
                      : "No verified findings were produced."}
                  </p>
                )}
                {job.state === "failed" && job.error !== "INVALID_EXTRACTION" && (
                  <button
                    className="quiet-button mt-3"
                    disabled={pending}
                    onClick={() =>
                      void mutate(`/api/v1/desk/jobs/${encodeURIComponent(job.id)}/retry`, {})
                    }
                  >
                    Retry import
                  </button>
                )}
              </div>
            ))}
            <button
              className="quiet-button mt-5 w-full"
              disabled={pending}
              onClick={() => router.refresh()}
            >
              Refresh status
            </button>
            <button
              className="button mt-3 w-full"
              disabled={pending || !view.sources.length}
              onClick={() =>
                void mutate(`${base}/imports${query}`, { sourceIds: view.sources.map((s) => s.id) })
              }
            >
              Queue extraction
            </button>
            <p className="mt-3 text-xs text-muted-foreground">
              Arbitrary extraction needs a configured provider, model and budget. It is never
              replaced by saved output.
            </p>
          </section>
          <section className="saved-notice">
            <h3 className="text-sm font-semibold">Explore the saved example</h3>
            <p className="mt-2 text-xs">
              Synthetic 750 / 500 gallon conflict, private context and ambiguous intent. No paid
              call.
            </p>
            <button
              className="quiet-button mt-4 w-full"
              disabled={pending}
              onClick={() => void mutate(`${base}/saved-example${query}`, {})}
            >
              Load synthetic packet
            </button>
          </section>
        </aside>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Evidence review does not establish vehicle safety, accept an offer or promise delivery.
      </p>
    </section>
  );
}
