import type { ReactNode } from "react";
import { formatUsd } from "@signal-desk/contracts/money";
import type { MunicipalityWorkspace as Workspace } from "@signal-desk/contracts/municipality-schema";

const stages = {
  proposed: "Proposed",
  contingent: "Contingent purchase",
  escrow_simulated: "Escrow · Simulated",
};
const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function VehicleThumbnail({
  thumbnail,
}: {
  thumbnail?: NonNullable<Workspace["thumbnails"]>[string];
}) {
  return thumbnail ? (
    <img
      className="municipal-thumbnail"
      src={thumbnail.url}
      alt={thumbnail.label}
      width="132"
      height="96"
    />
  ) : (
    <div className="municipal-thumbnail municipal-no-photo">No approved photo</div>
  );
}

function Acquisition({
  deal,
  thumbnail,
}: {
  deal: Workspace["acquisitions"][number];
  thumbnail?: NonNullable<Workspace["thumbnails"]>[string];
}) {
  return (
    <article className="municipal-acquisition">
      <VehicleThumbnail thumbnail={thumbnail} />
      <div className="municipal-acquisition-content">
        <h3>{deal.title}</h3>
        <p className="municipal-secondary">Seller: {deal.seller ?? "Not recorded"}</p>
        {deal.terms ? (
          <>
            <p className="municipal-price">
              <strong>{formatUsd(deal.terms.amountCents)}</strong> proposed
            </p>
            <p className="municipal-state">
              <span>State:</span> <span className="state">{stages[deal.terms.stage]}</span>
            </p>
            <div className="municipal-conditions">
              <span>Condition{deal.terms.conditions.length > 1 ? "s" : ""}:</span>
              <ul>
                {deal.terms.conditions.map((condition, index) => (
                  <li key={index}>{condition}</li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="municipal-secondary">No proposed amount or conditions recorded.</p>
        )}
        <footer className="municipal-acquisition-footer">
          <p>Simulated deal. No payment or escrow funds held.</p>
          <a href={`/desk/opportunities/${encodeURIComponent(deal.id)}`}>Review evidence →</a>
        </footer>
      </div>
    </article>
  );
}

function MunicipalityInventory({
  organization,
  activity,
  ownedListings,
  thumbnails,
}: Pick<Workspace, "organization" | "activity" | "ownedListings" | "thumbnails">) {
  return (
    <>
      <section aria-labelledby="interest-heading" className="municipal-section">
        <h2 id="interest-heading">Interested in</h2>
        <div className="municipal-list">
          {!activity.length && (
            <p className="municipal-empty">No favorites or seller contact activity recorded.</p>
          )}
          {activity.map((item) => (
            <article key={item.id} className="municipal-list-row">
              <VehicleThumbnail thumbnail={thumbnails?.[item.vehicleId]} />
              <div>
                <h3>
                  {item.kind === "favorite"
                    ? "Favorited"
                    : `Contacted ${item.seller ?? "seller"} about`}{" "}
                  {item.title}
                </h3>
                <p className="municipal-secondary">
                  {date.format(item.occurredAt)} ·{" "}
                  {item.kind === "favorite" ? "Added to watchlist" : "Contact recorded"}
                </p>
              </div>
            </article>
          ))}
        </div>
        <p className="municipal-note">Activity metadata only. Seller messages are not read.</p>
      </section>
      <section aria-labelledby="owned-heading" className="municipal-section">
        <h2 id="owned-heading">Selling</h2>
        <div className="municipal-list">
          {!ownedListings.length && <p className="municipal-empty">No owned listings recorded.</p>}
          {ownedListings.map((listing) => (
            <article key={listing.id} className="municipal-list-row">
              <VehicleThumbnail thumbnail={thumbnails?.[listing.id]} />
              <div>
                <h3>{listing.title}</h3>
                <p className="municipal-secondary">{organization.name} (owned)</p>
                <p className="municipal-secondary">
                  {listing.publishedAt
                    ? `Listed ${date.format(listing.publishedAt)}`
                    : "Not published"}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

/** Composes the municipality page around real projection data and caller-owned chat. */
export default function MunicipalityWorkspace({
  workspace,
  chat,
  enrichment,
}: {
  workspace: Workspace;
  chat?: ReactNode;
  enrichment?: ReactNode;
}) {
  const { organization, acquisitions, thumbnails } = workspace;
  return (
    <div className="municipal-page">
      <a className="dispatch-skip" href="#main-content">
        Skip to content
      </a>
      <header className="municipal-topbar">
        <nav aria-label="Municipal sales">
          <a className="municipal-brand" href="/">
            Signal Desk
          </a>
          <a className="municipal-section-link" href="/desk">
            Municipal Sales
          </a>
        </nav>
        <div className="municipal-topbar-context">
          {organization.synthetic && <span className="state">Synthetic demonstration</span>}
          <span>
            {organization.city}, {organization.region}
          </span>
        </div>
      </header>
      <main id="main-content" className="municipal-main" tabIndex={-1}>
        <header className="municipal-identity">
          <h1>{organization.name}</h1>
          <p>
            {organization.city}, {organization.region}
            {organization.unit && ` · ${organization.unit}`}
          </p>
        </header>
        <section aria-labelledby="acquisition-heading" className="municipal-section">
          <h2 id="acquisition-heading">Active acquisition</h2>
          {acquisitions.map((deal) => (
            <Acquisition key={deal.id} deal={deal} thumbnail={thumbnails?.[deal.vehicleId]} />
          ))}
        </section>
        {enrichment && <div className="municipal-section">{enrichment}</div>}
        <MunicipalityInventory
          organization={organization}
          activity={workspace.activity}
          ownedListings={workspace.ownedListings}
          thumbnails={thumbnails}
        />
        <footer className="municipal-note">
          Independent prototype. Not affiliated with Garage. No messages, payments or commercial
          commitments.
        </footer>
      </main>
      {chat}
    </div>
  );
}
