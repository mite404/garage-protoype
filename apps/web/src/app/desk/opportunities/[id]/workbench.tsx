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
type Fact = Workbench["facts"][number];
type Claim = Workbench["claims"][number];
type Review = Workbench["reviews"][number];
type Source = Workbench["sources"][number];
type Classification = Workbench["classifications"][number];
type ClassificationEntry = Workbench["classificationHistory"][number];
type Blocker = Workbench["blockers"][number];
type Job = Workbench["jobs"][number];
type Save = (path: string, body: FormData | unknown, revision?: number) => Promise<void>;

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

function droppedClaimsNote(count: number) {
  return count === 1
    ? "1 suggested claim was not imported: its excerpt was not found exactly once on its page, or its value was invalid."
    : `${count} suggested claims were not imported: their excerpts were not found exactly once on their pages, or their values were invalid.`;
}

function DroppedClaims({ count }: { count: number }) {
  if (!count) return null;
  return <p className="mt-2 text-xs text-muted-foreground">{droppedClaimsNote(count)}</p>;
}

function ClaimCard({ claim }: { claim: Claim }) {
  return (
    <blockquote className="claim-card">
      <p className="text-xs font-semibold text-muted-foreground">
        {claim.sourceKind.startsWith("seller") ? "Seller-reported" : "Document assertion"}
      </p>
      <p className="my-2 text-2xl font-semibold tabular-nums">
        {claim.value}{" "}
        <span className="text-base font-normal text-muted-foreground">{claim.unit}</span>
      </p>
      <p className="text-sm">“{claim.excerpt}”</p>
      <footer className="mt-3 text-xs text-muted-foreground">
        {claim.sourceName}
        <br />
        Page {claim.page} · characters {claim.start}-{claim.end}
      </footer>
    </blockquote>
  );
}

function FactSummary({ fact, claims }: { fact: Fact; claims: Claim[] }) {
  return (
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
  );
}

function ReviewHistory({ reviews }: { reviews: Review[] }) {
  if (!reviews.length) return null;
  return (
    <details className="mt-4 text-sm">
      <summary>Preserved review history</summary>
      {reviews.map((r) => (
        <p className="mt-3" key={r.id}>
          Revision {r.revision} · {r.kind} · {r.value} {r.unit}
          <br />
          {r.reason}
        </p>
      ))}
    </details>
  );
}

function DecisionSelect({ fact, claims }: { fact: Fact; claims: Claim[] }) {
  // Selection and correction need a source assertion and a fact that is not held for review.
  const selectable = claims.length > 0 && fact.kind !== "needs_review";
  return (
    <div>
      <label htmlFor={`${fact.field}-kind`}>Review decision</label>
      <select
        id={`${fact.field}-kind`}
        name="kind"
        defaultValue={selectable ? "select" : "unknown"}
      >
        <option value="select" disabled={!selectable}>
          Select a source assertion
        </option>
        <option value="correct" disabled={!selectable}>
          Correct with evidence
        </option>
        <option value="unknown">Keep unknown</option>
      </select>
    </div>
  );
}

function SupportingSource({ field, claims }: { field: string; claims: Claim[] }) {
  if (!claims.length) return null;
  return (
    <div>
      <label htmlFor={`${field}-claim`}>Supporting source</label>
      <select id={`${field}-claim`} name="claimId">
        {claims.map((c) => (
          <option value={c.id} key={c.id}>
            {c.sourceName} · {c.value} {c.unit}
          </option>
        ))}
      </select>
    </div>
  );
}

function CorrectionFields({ field, claims }: { field: string; claims: Claim[] }) {
  if (!claims.length) return null;
  return (
    <details className="mt-4">
      <summary className="text-sm text-muted-foreground">Correction value and unit</summary>
      <div className="form-grid mt-3">
        <div>
          <label htmlFor={`${field}-value`}>Corrected value</label>
          <input id={`${field}-value`} name="value" maxLength={200} />
        </div>
        <div>
          <label htmlFor={`${field}-unit`}>Unit</label>
          <select id={`${field}-unit`} name="unit" defaultValue={claims[0]?.unit}>
            <option value="">No unit</option>
            {["gal", "gpm", "mi", "km", "L", "L/min"].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>
    </details>
  );
}

function ShareApproval({ claims }: { claims: Claim[] }) {
  if (!claims.length) return null;
  return (
    <label className="check-label mt-4">
      <input type="checkbox" name="shareable" /> Approve public value and cited excerpt, only where
      source permission allows
    </label>
  );
}

function ReviewForm({
  fact,
  claims,
  pending,
  onSubmit,
}: {
  fact: Fact;
  claims: Claim[];
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="review-form mt-5" onSubmit={onSubmit}>
      <fieldset disabled={pending}>
        <div className="form-grid">
          <DecisionSelect fact={fact} claims={claims} />
          <SupportingSource field={fact.field} claims={claims} />
        </div>
        <CorrectionFields field={fact.field} claims={claims} />
        <label className="mt-4" htmlFor={`${fact.field}-reason`}>
          Reason or correction basis
        </label>
        <input
          id={`${fact.field}-reason`}
          name="reason"
          placeholder="Required for corrections and unknown decisions"
          maxLength={2000}
        />
        <ShareApproval claims={claims} />
        <button className="button mt-4" type="submit">
          Save review
        </button>
      </fieldset>
    </form>
  );
}

function FactRow({
  fact,
  claims,
  reviews,
  revision,
  pending,
  review,
}: {
  fact: Fact;
  claims: Claim[];
  reviews: Review[];
  revision: number;
  pending: boolean;
  review: (event: FormEvent<HTMLFormElement>, field: string) => void;
}) {
  return (
    <details className="fact-row" open={fact.kind === "conflict" || undefined}>
      <FactSummary fact={fact} claims={claims} />
      <div className="fact-body">
        <p className="mb-4 text-sm text-muted-foreground">{factDescription(fact)}</p>
        <div className="claim-grid">
          {claims.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} />
          ))}
        </div>
        <ReviewHistory reviews={reviews} />
        <ReviewForm
          key={revision}
          fact={fact}
          claims={claims}
          pending={pending}
          onSubmit={(e) => review(e, fact.field)}
        />
      </div>
    </details>
  );
}

function SourceSummary({
  source,
  classification,
}: {
  source: Source;
  classification?: Classification;
}) {
  return (
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
  );
}

function SourcePages({ pages }: { pages: string[] }) {
  return pages.map((page, index) => (
    <div className="source-page mt-4" key={index}>
      <p className="mb-2 text-xs font-semibold text-muted-foreground">Page {index + 1}</p>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm">{page}</pre>
    </div>
  ));
}

function HistoryEntry({ entry }: { entry: ClassificationEntry }) {
  return (
    <p className="mt-3">
      Revision {entry.revision} · {entry.reviewed ? "Specialist" : "Extraction suggestion"} ·{" "}
      {entry.kind.replaceAll("_", " ")}
      <br />
      {entry.basis}
      <br />
      {entry.nextAction}
    </p>
  );
}

function SourceClassification({
  classification,
  history,
}: {
  classification?: Classification;
  history: ClassificationEntry[];
}) {
  if (!classification) return null;
  return (
    <>
      <div className="mt-4 text-sm">
        <strong>
          {classification.reviewed ? "Specialist correction" : "Extraction suggestion"}
        </strong>
        <p>{classification.basis}</p>
        <p className="mt-1 text-muted-foreground">Next action · {classification.nextAction}</p>
      </div>
      <details className="mt-4 text-sm">
        <summary>Preserved classification history</summary>
        {history.map((c) => (
          <HistoryEntry key={c.id} entry={c} />
        ))}
      </details>
    </>
  );
}

function ClassifyForm({
  source,
  classification,
  pending,
  onSubmit,
}: {
  source: Source;
  classification?: Classification;
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <details className="mt-4">
      <summary className="text-sm font-semibold">Correct classification and next action</summary>
      <form className="mt-4" onSubmit={onSubmit}>
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
          <input id={`${source.id}-reason`} name="reason" required maxLength={2000} />
          <label className="mt-4" htmlFor={`${source.id}-next`}>
            Next human action
          </label>
          <input id={`${source.id}-next`} name="nextAction" required maxLength={500} />
          <button className="button mt-4">Save classification</button>
        </fieldset>
      </form>
    </details>
  );
}

function SourceRow({
  source,
  classification,
  history,
  pending,
  classify,
}: {
  source: Source;
  classification?: Classification;
  history: ClassificationEntry[];
  pending: boolean;
  classify: (event: FormEvent<HTMLFormElement>, sourceId: string) => void;
}) {
  return (
    <details className="source-row">
      <SourceSummary source={source} classification={classification} />
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
        <SourcePages pages={source.pages} />
        {source.blockerId && (
          <p className="mt-4 text-sm">
            Seller response linked to buyer blocker. Review and share permission are required before
            disclosure.
          </p>
        )}
        <SourceClassification classification={classification} history={history} />
        <ClassifyForm
          source={source}
          classification={classification}
          pending={pending}
          onSubmit={(event) => classify(event, source.id)}
        />
      </div>
    </details>
  );
}

function SourcePacket({
  view,
  pending,
  classify,
}: {
  view: Workbench;
  pending: boolean;
  classify: (event: FormEvent<HTMLFormElement>, sourceId: string) => void;
}) {
  return (
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
      {view.sources.map((source) => (
        <SourceRow
          key={source.id}
          source={source}
          classification={view.classifications.find((c) => c.sourceId === source.id)}
          history={view.classificationHistory.filter((c) => c.sourceId === source.id)}
          pending={pending}
          classify={classify}
        />
      ))}
    </section>
  );
}

function AddSource({
  blockers,
  pending,
  onSubmit,
}: {
  blockers: Blocker[];
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="evidence-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow mb-2">03 · Add evidence</p>
          <h2>Keep the original.</h2>
        </div>
      </div>
      <form className="px-6 pb-6" onSubmit={onSubmit}>
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
                {blockers.map((b) => (
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
            <input name="shareable" type="checkbox" /> I authorize public excerpts after specialist
            review. Private context cannot be published.
          </label>
          <button className="button mt-5">Preserve source</button>
        </fieldset>
      </form>
    </section>
  );
}

function BlockerCard({ blocker }: { blocker: Blocker }) {
  const resolved = blocker.state === "resolved";
  return (
    <div className="blocker mt-5">
      <span className={`state state-${resolved ? "reviewed" : "needs_review"}`}>
        {resolved ? "Evidence reviewed" : "Needs human review"}
      </span>
      <p className="mt-3 text-sm font-semibold">{blocker.question}</p>
      <p className="mt-2 text-sm text-muted-foreground">{blocker.nextAction}</p>
      <p className="mt-3 break-all text-[11px] text-muted-foreground">
        Assigned specialist · {blocker.assigneeId}
      </p>
    </div>
  );
}

function BuyerBlockers({ blockers, nextAction }: { blockers: Blocker[]; nextAction: string }) {
  return (
    <section className="evidence-panel context-panel">
      <p className="eyebrow mb-3">Keep the deal in view</p>
      <h2>Buyer blockers</h2>
      <p className="mt-2 text-sm text-muted-foreground">No reply is sent automatically.</p>
      {!blockers.length && (
        <p className="mt-5 text-sm text-muted-foreground">No buyer blocker has been recorded.</p>
      )}
      {blockers.map((blocker) => (
        <BlockerCard key={blocker.id} blocker={blocker} />
      ))}
      <div className="mt-6 border-t border-border pt-5">
        <p className="text-xs font-semibold text-muted-foreground">NEXT ACTION</p>
        <p className="mt-2 text-sm">
          {nextAction || "Inspect the source packet and identify the next human action."}
        </p>
      </div>
    </section>
  );
}

function JobError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="mt-2 break-words text-xs text-destructive">
      {error}.{" "}
      {error === "SPEND_UNCERTAIN"
        ? "Reservation retained. Operator reconciliation is required."
        : "No verified findings were produced."}
    </p>
  );
}

// Invalid extractions are terminal; other failures may be requeued by their requester.
function retryable(job: Job) {
  return job.state === "failed" && job.error !== "INVALID_EXTRACTION";
}

function ImportJob({ job, pending, retry }: { job: Job; pending: boolean; retry: () => void }) {
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <span className="state state-unknown">{job.state}</span>
        <span className="text-xs text-muted-foreground">Attempt {job.attempt}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {job.mode === "saved_example" ? "Saved synthetic run" : "Provider extraction"}
      </p>
      <DroppedClaims count={job.droppedClaims} />
      <JobError error={job.error} />
      {retryable(job) && (
        <button className="quiet-button mt-3" disabled={pending} onClick={retry}>
          Retry import
        </button>
      )}
    </div>
  );
}

function ImportActivity({
  view,
  pending,
  save,
  refresh,
  queue,
}: {
  view: Workbench;
  pending: boolean;
  save: Save;
  refresh: () => void;
  queue: () => void;
}) {
  return (
    <section className="evidence-panel context-panel">
      <h2>Import activity</h2>
      <p className="mt-2 text-xs text-muted-foreground">
        Durable jobs survive reloads. Originals and corrections stay intact.
      </p>
      {view.jobs.map((job) => (
        <ImportJob
          key={job.id}
          job={job}
          pending={pending}
          retry={() => void save(`/api/v1/desk/jobs/${encodeURIComponent(job.id)}/retry`, {})}
        />
      ))}
      <button className="quiet-button mt-5 w-full" disabled={pending} onClick={refresh}>
        Refresh status
      </button>
      <button
        className="button mt-3 w-full"
        disabled={pending || !view.sources.length}
        onClick={queue}
      >
        Queue extraction
      </button>
      <p className="mt-3 text-xs text-muted-foreground">
        Arbitrary extraction needs a configured provider, model and budget. It is never replaced by
        saved output.
      </p>
    </section>
  );
}

function EvidenceSummary({ view }: { view: Workbench }) {
  const conflicts = view.facts.filter((f) => f.kind === "conflict").length;
  const reviewed = view.facts.filter((f) => f.kind === "reviewed").length;
  return (
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
  );
}

function SavedNotice({ jobs }: { jobs: Job[] }) {
  if (!jobs.some((j) => j.mode === "saved_example")) return null;
  return (
    <p className="saved-notice mt-5">
      Saved synthetic example · No live extraction. No automatic approvals.
    </p>
  );
}

function SaveStatus({
  pending,
  error,
  message,
}: {
  pending: boolean;
  error: boolean;
  message: string;
}) {
  return (
    <output
      aria-live="polite"
      className={`mt-4 block text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}
    >
      {pending ? "Saving…" : message}
    </output>
  );
}

// Reads one review command from the fact form; unknown decisions carry only their reason.
function reviewCommand(form: FormData, field: string) {
  const kind = form.get("kind");
  if (kind === "unknown") return { kind, field, reason: form.get("reason") };
  return {
    kind,
    field,
    claimId: form.get("claimId"),
    shareable: form.get("shareable") === "on",
    ...(kind === "correct"
      ? { value: form.get("value"), unit: form.get("unit"), reason: form.get("reason") }
      : {}),
  };
}

function classifyCommand(form: FormData, sourceId: string) {
  return {
    kind: "classify",
    sourceId,
    classification: form.get("classification"),
    reason: form.get("reason"),
    nextAction: form.get("nextAction"),
  };
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
    const command = reviewCommand(new FormData(event.currentTarget), field);
    void mutate(`${base}/reviews${query}`, command, view.revision);
  }

  function classify(event: FormEvent<HTMLFormElement>, sourceId: string) {
    event.preventDefault();
    const command = classifyCommand(new FormData(event.currentTarget), sourceId);
    void mutate(`${base}/reviews${query}`, command, view.revision);
  }

  function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(`${base}/sources${query}`, new FormData(event.currentTarget));
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
      <EvidenceSummary view={view} />
      <SavedNotice jobs={view.jobs} />
      <SaveStatus pending={pending} error={error} message={message} />
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
              .map((fact) => (
                <FactRow
                  key={fact.field}
                  fact={fact}
                  claims={view.claims.filter((c) => c.field === fact.field)}
                  reviews={view.reviews.filter((r) => r.field === fact.field)}
                  revision={view.revision}
                  pending={pending}
                  review={review}
                />
              ))}
          </section>
          <SourcePacket view={view} pending={pending} classify={classify} />
          <AddSource blockers={view.blockers} pending={pending} onSubmit={addSource} />
        </div>
        <aside className="min-w-0 space-y-5" aria-label="Buyer context and processing">
          <BuyerBlockers blockers={view.blockers} nextAction={view.nextAction} />
          <ImportActivity
            view={view}
            pending={pending}
            save={mutate}
            refresh={() => router.refresh()}
            queue={() =>
              void mutate(`${base}/imports${query}`, { sourceIds: view.sources.map((s) => s.id) })
            }
          />
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
