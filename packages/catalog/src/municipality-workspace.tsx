import type { ReactNode } from "react";
import type { MunicipalityWorkspace as Workspace } from "@signal-desk/contracts/municipality-schema";

const stages = {
  proposed: "Proposed",
  contingent: "Contingent purchase",
  escrow_simulated: "Escrow · Simulated",
};
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function MunicipalityIdentity({ organization }: Pick<Workspace, "organization">) {
  return (
    <header className="mt-7 mb-10">
      {organization.synthetic && <p className="eyebrow mb-3">Synthetic demonstration</p>}
      <h1>{organization.name}</h1>
      <p className="mt-3 text-stone-500">
        {organization.city}, {organization.region}
        {organization.unit && ` · ${organization.unit}`}
      </p>
    </header>
  );
}

function Acquisition({ deal }: { deal: Workspace["acquisitions"][number] }) {
  return (
    <article className="panel mb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold">{deal.title}</h3>
          <p className="mt-2 text-sm text-stone-500">Seller · {deal.seller ?? "Not recorded"}</p>
        </div>
        {deal.terms && <span className="state state-unknown">{stages[deal.terms.stage]}</span>}
      </div>
      {deal.terms ? (
        <>
          <p className="mt-6 text-3xl font-semibold tracking-tight">
            {money.format(deal.terms.amountCents / 100)}{" "}
            <span className="text-sm font-normal text-stone-500">proposed</span>
          </p>
          <div className="mt-5 rounded-lg border border-orange-100 bg-orange-50/60 p-4">
            <p className="text-sm font-semibold">Purchase conditions</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {deal.terms.conditions.map((condition, index) => (
                <li key={index}>{condition}</li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <p className="mt-5 text-sm text-stone-500">No proposed amount or conditions recorded.</p>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
        <p className="text-xs text-stone-500">
          Prototype only. No real escrow, payment or delivery commitment.
        </p>
        <a
          className="text-sm font-semibold text-orange-800"
          href={`/desk/opportunities/${encodeURIComponent(deal.id)}`}
        >
          Review evidence →
        </a>
      </div>
    </article>
  );
}

function MunicipalityInventory({
  organization,
  activity,
  ownedListings,
}: Pick<Workspace, "organization" | "activity" | "ownedListings">) {
  return (
    <>
      <section aria-labelledby="interest-heading" className="mb-9">
        <h2 id="interest-heading" className="mb-4">
          Interested in
        </h2>
        <div className="panel divide-y divide-stone-100">
          {!activity.length && (
            <p className="text-sm text-stone-500">
              No favorites or seller contact activity recorded.
            </p>
          )}
          {activity.map((item) => (
            <article
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
            >
              <div>
                <h3 className="font-semibold">{item.title}</h3>
                <p className="mt-1 text-sm text-stone-500">
                  {item.kind === "favorite"
                    ? "Added to favorites"
                    : `Contacted ${item.seller ?? "seller"}`}{" "}
                  · {date.format(item.occurredAt)}
                </p>
              </div>
              <span className="text-xs text-stone-500">
                {item.kind === "favorite" ? "Favorite" : "Contact metadata only"}
              </span>
            </article>
          ))}
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Activity metadata only. Seller messages are not read.
        </p>
      </section>
      <section aria-labelledby="owned-heading">
        <h2 id="owned-heading" className="mb-4">
          Owned listings
        </h2>
        <div className="panel divide-y divide-stone-100">
          {!ownedListings.length && (
            <p className="text-sm text-stone-500">No owned listings recorded.</p>
          )}
          {ownedListings.map((listing) => (
            <article key={listing.id} className="py-4 first:pt-0 last:pb-0">
              <h3 className="font-semibold">{listing.title}</h3>
              <p className="mt-1 text-sm text-stone-500">
                Owned by {organization.name} ·{" "}
                {listing.publishedAt
                  ? `Listed ${date.format(listing.publishedAt)}`
                  : "Not published"}
              </p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

/** Renders the municipality projection with a caller-supplied live chat. */
export default function MunicipalityWorkspace({
  workspace,
  chat,
}: {
  workspace: Workspace;
  chat?: ReactNode;
}) {
  const { organization, acquisitions } = workspace;
  return (
    <div className="mx-auto max-w-4xl pb-24">
      <a href="/desk" className="text-sm text-stone-500">
        ← Municipal sales
      </a>
      <MunicipalityIdentity organization={organization} />
      <section aria-labelledby="acquisition-heading" className="mb-9">
        <h2 id="acquisition-heading" className="mb-4">
          Active acquisition
        </h2>
        {acquisitions.map((deal) => (
          <Acquisition key={deal.id} deal={deal} />
        ))}
      </section>
      <MunicipalityInventory
        organization={organization}
        activity={workspace.activity}
        ownedListings={workspace.ownedListings}
      />
      {chat}
    </div>
  );
}
