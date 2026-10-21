import type { ReactNode } from "react";
import { formatUsd } from "@signal-desk/contracts/money";
import type { MunicipalityWorkspace as Workspace } from "@signal-desk/contracts/municipality-schema";

// A contingent deal waits on its conditions, so it reads as needing attention.
const stages = {
  proposed: ["Proposed", ""],
  contingent: ["Contingent purchase", "state-needs_review"],
  escrow_simulated: ["Escrow · Simulated", ""],
} satisfies Record<string, [label: string, tone: string]>;
type Thumbnail = NonNullable<Workspace["thumbnails"]>[string];

const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function VehicleThumbnail({ thumbnail }: { thumbnail?: Thumbnail }) {
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

// One anatomy for a vehicle being bought or sold: identity on the left, the deciding figure on
// the right, then its state and next link.
function ItemCard({
  thumbnail,
  title,
  detail,
  figure,
  children,
  footer,
}: {
  thumbnail?: Thumbnail;
  title: string;
  detail?: string;
  figure?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article className="municipal-item">
      <VehicleThumbnail thumbnail={thumbnail} />
      <div className="municipal-item-content">
        <header className="municipal-item-head">
          <div>
            <h3>{title}</h3>
            {detail && <p className="municipal-secondary">{detail}</p>}
          </div>
          {figure}
        </header>
        {children}
        {footer && <footer className="municipal-item-footer">{footer}</footer>}
      </div>
    </article>
  );
}

function Acquisition({
  deal,
  thumbnail,
}: {
  deal: Workspace["acquisitions"][number];
  thumbnail?: Thumbnail;
}) {
  const { terms } = deal;
  return (
    <ItemCard
      thumbnail={thumbnail}
      title={deal.title}
      detail={deal.seller ? `From ${deal.seller}` : "Seller not recorded"}
      figure={
        terms && (
          <p className="municipal-figure">
            <strong>{formatUsd(terms.amountCents)}</strong> proposed
          </p>
        )
      }
      footer={
        <>
          <p>Simulated deal. No payment or escrow funds held.</p>
          <a href={`/desk/opportunities/${encodeURIComponent(deal.id)}`}>Review evidence →</a>
        </>
      }
    >
      {terms ? (
        <div className="municipal-terms">
          <span className={`state ${stages[terms.stage][1]}`}>{stages[terms.stage][0]}</span>
          <ul aria-label="Conditions">
            {terms.conditions.map((condition, index) => (
              <li key={index}>{condition}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="municipal-secondary">No proposed amount or conditions recorded.</p>
      )}
    </ItemCard>
  );
}

// A department's own vehicle for sale; only a published listing has a public record to open.
function Listing({
  listing,
  thumbnail,
}: {
  listing: Workspace["ownedListings"][number];
  thumbnail?: Thumbnail;
}) {
  const { publishedAt } = listing;
  return (
    <ItemCard
      thumbnail={thumbnail}
      title={listing.title}
      figure={
        <span className={`state ${publishedAt ? "state-reviewed" : "state-needs_review"}`}>
          {publishedAt ? `Listed ${date.format(publishedAt)}` : "Not published"}
        </span>
      }
      footer={
        publishedAt ? (
          <a href={`/vehicles/${encodeURIComponent(listing.id)}`}>Public record →</a>
        ) : (
          <p>Buyers cannot see this vehicle until it is published.</p>
        )
      }
    />
  );
}

function MunicipalityInventory({
  activity,
  ownedListings,
  thumbnails,
}: Pick<Workspace, "activity" | "ownedListings" | "thumbnails">) {
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
        {!ownedListings.length && <p className="municipal-empty">No owned listings recorded.</p>}
        {ownedListings.map((listing) => (
          <Listing key={listing.id} listing={listing} thumbnail={thumbnails?.[listing.id]} />
        ))}
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
          {organization.synthetic && (
            <span className="state state-simulated">Synthetic demonstration</span>
          )}
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
