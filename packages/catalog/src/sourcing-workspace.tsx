import type { ReactNode } from "react";
import {
  evaluateFit,
  type Decision,
  type SourcingAccount,
} from "@signal-desk/contracts/sourcing-schema";
import {
  DecisionPacket,
  FitTable,
  InformationRequest,
  ReplyReview,
  SourceChangeCard,
} from "./sourcing-cards";

const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const outreachStates: Record<SourcingAccount["outreach"]["state"], string> = {
  none: "No outreach",
  draft: "Reviewed draft, not sent",
  queued: "Queued",
  sent: "Sent",
  uncertain: "Delivery uncertain, follow-up paused",
  stopped: "Stopped",
};

/**
 * Account-first seller research page: the reason for investigation, fit, outreach, replies and
 * the pairing decision stay visible, with the caller-owned chat alongside.
 */
export default function SourcingWorkspace({
  data,
  chat,
  onSaveDraft,
  onAccept,
  onDecide,
}: {
  data: SourcingAccount;
  chat?: ReactNode;
  onSaveDraft?: (draft: { subject: string; body: string }) => void;
  onAccept?: (factIds: string[]) => void;
  onDecide?: (decision: Decision) => void;
}) {
  const { account, need, outreach } = data;
  const rows = evaluateFit(need, data.facts); // → FitRow[] from accepted facts only
  return (
    <div className="municipal-page">
      <a className="dispatch-skip" href="#main-content">
        Skip to content
      </a>
      <header className="municipal-topbar">
        <nav aria-label="Sales workspace">
          <a className="municipal-brand" href="/">
            Signal Desk
          </a>
          <a className="municipal-section-link" href="/desk/prospects">
            Accounts
          </a>
        </nav>
        <div className="municipal-topbar-context">
          {account.synthetic && <span className="state">Synthetic demonstration</span>}
          <span>Message sending disabled</span>
        </div>
      </header>
      <main id="main-content" className="municipal-main" tabIndex={-1}>
        <header className="municipal-identity sourcing-identity">
          <div>
            <h1>{account.name}</h1>
            <p>
              {account.place} ·{" "}
              {account.roles
                .map((role) => (role === "seller" ? "Potential seller" : "Buyer"))
                .join(" · ")}
            </p>
          </div>
          <dl className="sourcing-owner">
            <dt>Owner</dt>
            <dd>{data.owner}</dd>
          </dl>
        </header>
        <div className="card-next-action sourcing-next">
          <p className="reading-label">Next action</p>
          <p>{data.nextAction}</p>
        </div>

        <section aria-labelledby="why-heading" className="municipal-section">
          <h2 id="why-heading">Why this account is here</h2>
          <div className="sourcing-why">
            <div className="municipal-list">
              <div className="municipal-list-row">
                <div>
                  <h3>
                    Confirmed buyer need: <a href={need.buyerHref}>{need.buyer}</a>
                  </h3>
                  <p className="municipal-secondary">
                    {need.vehicleClass} · Up to {usd.format(need.maxAllInCents / 100)} all-in ·
                    Height ≤{need.maxHeightIn} in
                  </p>
                </div>
              </div>
              <div className="municipal-list-row">
                <div>
                  <h3>Existing inventory checked</h3>
                  <p className="municipal-secondary">
                    {data.inventorySearch.reviewedMatches
                      ? `${data.inventorySearch.reviewedMatches} reviewed matches`
                      : "No suitable reviewed match"}{" "}
                    · {date.format(data.inventorySearch.searchedAt)}
                  </p>
                </div>
              </div>
            </div>
            <SourceChangeCard trigger={data.trigger} />
          </div>
        </section>

        <section aria-labelledby="fit-heading" className="municipal-section">
          <h2 id="fit-heading">Can this candidate meet the need?</h2>
          <FitTable need={need} rows={rows} />
        </section>

        <section aria-labelledby="outreach-heading" className="municipal-section">
          <h2 id="outreach-heading">Outreach</h2>
          <p className="municipal-secondary sourcing-status">
            Status: <span className="state">{outreachStates[outreach.state]}</span>
            {outreach.stopReason && ` · ${outreach.stopReason}`}
          </p>
          <InformationRequest
            need={need}
            rows={rows}
            contact={data.contact}
            deliveryEnabled={outreach.deliveryEnabled}
            onSave={onSaveDraft}
          />
        </section>

        <section aria-labelledby="replies-heading" className="municipal-section">
          <h2 id="replies-heading">Replies and reviewed facts</h2>
          <ReplyReview need={need} replies={data.replies} facts={data.facts} onAccept={onAccept} />
          <p className="municipal-note">
            The background analyst proposes; the specialist reviews. Chat opens these same cards.
          </p>
        </section>

        <section aria-labelledby="decision-heading" className="municipal-section">
          <h2 id="decision-heading">Decision for this pairing</h2>
          <DecisionPacket need={need} rows={rows} decision={data.decision} onDecide={onDecide} />
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
