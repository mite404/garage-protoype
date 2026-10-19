import type { ReactNode } from "react";
import {
  evaluateFit,
  isStale,
  requirementLabel,
  type Decision,
  type FitRow,
  type SourcingAccount,
} from "@signal-desk/contracts/sourcing-schema";
import {
  DecisionPacket,
  FitTable,
  InformationRequest,
  RecordNote,
  ReplyReview,
  SourceChangeCard,
} from "./sourcing-cards";

const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const outreachStates: Record<SourcingAccount["outreach"]["state"], string> = {
  none: "No outreach",
  draft: "Reviewed draft, not sent",
  queued: "Queued",
  sent: "Sent",
  uncertain: "Delivery uncertain, follow-up paused",
  stopped: "Stopped",
};

function inventoryText(search: SourcingAccount["inventorySearch"]) {
  if (!search) return "Not yet checked. Search existing inventory before new sourcing.";
  const result = search.reviewedMatches
    ? `${search.reviewedMatches} reviewed matches`
    : "No suitable reviewed match";
  return `${result} · ${date.format(search.searchedAt)}`;
}

function WhyHere({ data }: { data: SourcingAccount }) {
  const { need, inventorySearch } = data;
  return (
    <section aria-labelledby="why-heading" className="municipal-section">
      <h2 id="why-heading">Why this department is here</h2>
      <div className="sourcing-why">
        <div className="municipal-list">
          <div className="municipal-list-row">
            <div>
              <h3>
                Confirmed buyer need: <a href={need.buyerHref}>{need.buyer}</a>
              </h3>
              <p className="municipal-secondary">
                {need.vehicleClass} · {requirementLabel(need, "budget")} · Height ≤
                {need.maxHeightIn} in · Revision {need.revision}
              </p>
            </div>
          </div>
          <div className="municipal-list-row">
            <div>
              <h3>Existing inventory</h3>
              <p className="municipal-secondary">{inventoryText(inventorySearch)}</p>
            </div>
          </div>
        </div>
        {data.trigger ? (
          <SourceChangeCard trigger={data.trigger} />
        ) : (
          <p className="municipal-empty">No source change recorded for this pairing.</p>
        )}
      </div>
    </section>
  );
}

function Identity({ data, sellerHref }: { data: SourcingAccount; sellerHref?: string }) {
  const { account } = data;
  return (
    <header className="municipal-identity sourcing-identity">
      <div>
        <h1>{account.name}</h1>
        <p>
          {account.place} ·{" "}
          {account.roles
            .map((role) => (role === "seller" ? "Potential seller" : "Buyer"))
            .join(" · ")}
          {sellerHref && (
            <>
              {" · "}
              <a className="sourcing-link" href={sellerHref}>
                Department record
              </a>
            </>
          )}
        </p>
      </div>
      <dl className="sourcing-owner">
        <dt>Owner</dt>
        <dd>{data.owner}</dd>
      </dl>
    </header>
  );
}

function Topbar({ data }: { data: SourcingAccount }) {
  return (
    <header className="municipal-topbar">
      <nav aria-label="Sales workspace">
        <a className="municipal-brand" href="/">
          Signal Desk
        </a>
        <a className="municipal-section-link" href="/desk/prospects">
          Departments
        </a>
      </nav>
      <div className="municipal-topbar-context">
        {data.account.synthetic && <span className="state">Synthetic demonstration</span>}
        {!data.outreach.deliveryEnabled && <span>Message sending disabled</span>}
      </div>
    </header>
  );
}

// A new request is offered only before enrollment and while the pairing is still open.
function Outreach({
  data,
  rows,
  onSaveDraft,
}: {
  data: SourcingAccount;
  rows: FitRow[];
  onSaveDraft?: (draft: { subject: string; body: string }) => void;
}) {
  const { outreach } = data;
  const rejected = data.decision?.decision === "reject";
  const editable = ["none", "draft"].includes(outreach.state) && !rejected;
  return (
    <section aria-labelledby="outreach-heading" className="municipal-section">
      <h2 id="outreach-heading">Outreach</h2>
      <p className="municipal-secondary sourcing-status">
        Status: <span className="state">{outreachStates[outreach.state]}</span>
        {outreach.stopReason && ` · ${outreach.stopReason}`}
      </p>
      {editable ? (
        <InformationRequest
          need={data.need}
          rows={rows}
          contact={data.contact}
          deliveryEnabled={outreach.deliveryEnabled}
          onSave={onSaveDraft}
        />
      ) : (
        <p className="municipal-note">
          {rejected
            ? `This pairing was rejected, so no further requests are offered.${
                outreach.state === "queued"
                  ? " Its queued request stays queued until stopped on the department record."
                  : ""
              }`
            : "The reviewed request is enrolled. A reply, opt-out or uncertain delivery stops follow-up."}
        </p>
      )}
    </section>
  );
}

/**
 * Account-first seller research page: the reason for investigation, fit, outreach, replies and
 * the pairing decision stay visible, with the caller-owned chat alongside.
 */
export default function SourcingWorkspace({
  data,
  chat,
  problem,
  sellerHref,
  onSaveDraft,
  onAccept,
  onDecide,
  onRecordNote,
}: {
  data: SourcingAccount;
  chat?: ReactNode;
  /** The last rejected command's sanitized message. */
  problem?: string;
  /** The growth-owned department record for the seller. */
  sellerHref?: string;
  onSaveDraft?: (draft: { subject: string; body: string }) => void;
  onAccept?: (factIds: string[]) => void;
  onDecide?: (decision: Decision) => void;
  onRecordNote?: (text: string) => void;
}) {
  const { need } = data;
  const rows = evaluateFit(need, data.facts); // → FitRow[] from accepted facts only
  return (
    <div className="municipal-page">
      <a className="dispatch-skip" href="#main-content">
        Skip to content
      </a>
      <Topbar data={data} />
      <main id="main-content" className="municipal-main" tabIndex={-1}>
        <Identity data={data} sellerHref={sellerHref} />
        <div className="card-next-action sourcing-next">
          <p className="reading-label">Next action</p>
          <p>{data.nextAction}</p>
        </div>
        {problem && (
          <p role="alert" className="sourcing-problem">
            {problem}
          </p>
        )}

        <WhyHere data={data} />

        <section aria-labelledby="fit-heading" className="municipal-section">
          <h2 id="fit-heading">Can this candidate meet the need?</h2>
          <FitTable need={need} rows={rows} />
        </section>

        <Outreach data={data} rows={rows} onSaveDraft={onSaveDraft} />

        <section aria-labelledby="replies-heading" className="municipal-section">
          <h2 id="replies-heading">Replies and reviewed facts</h2>
          <ReplyReview need={need} replies={data.replies} facts={data.facts} onAccept={onAccept} />
          {onRecordNote && <RecordNote onRecord={onRecordNote} />}
          <p className="municipal-note">
            The background analyst proposes; the specialist reviews. Chat opens these same cards.
          </p>
        </section>

        <section aria-labelledby="decision-heading" className="municipal-section">
          <h2 id="decision-heading">Decision for this pairing</h2>
          <DecisionPacket
            need={need}
            rows={rows}
            decision={data.decision}
            stale={!!data.decision && isStale(data.decision.basis, need, data.facts)}
            onDecide={onDecide}
          />
        </section>
        <footer className="municipal-note">
          Independent prototype. Not affiliated with Garage. No messages, payments or commercial
          commitments.
        </footer>
      </main>
      {chat}
    </div>
  );
}
