import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getGrowthProfile } from "@/server/growth-views";
import { listBuyerNeeds, listSellerListings, listSourcingCases } from "@/server/sourcing";
import { AccountFrame, NextAction, accountTab } from "@signal-desk/catalog/desk-shell";
import { connectionStages, pipelineStage, prospectRole } from "@signal-desk/catalog/desk-state";
import { GrowthAccountContent, GrowthUnavailable } from "../../growth-profile";
import { ConnectionForm } from "../../sourcing/connection-forms";

export const dynamic = "force-dynamic";
const pipeline = [
  "Discovered",
  "Identity",
  "Routed",
  "Contact permission",
  "Sequence",
  "Reply",
  "Qualified seller",
];
// One next review per pipeline stage, indexed like `pipeline`.
const actions = [
  ["Confirm identity", "Directory presence is not intent. Confirm this is the right department."],
  ["Confirm identity", "Directory presence is not intent. Confirm this is the right department."],
  ["Review contact", "Record the contact's source and permission before any outreach."],
  ["Review contact", "Record the contact's source and permission before any outreach."],
  ["Review outreach", "Approve a reviewed sequence. Delivery stays disabled in this workspace."],
  ["Review reply", "Read the original answer before changing qualification."],
  ["Connect a buyer", "This seller is qualified. Connect its listing with a buyer need."],
] as const;

type Account = Awaited<ReturnType<typeof getGrowthProfile>>["account"];

// A qualified seller continues with its listing; an account qualified as a buyer before listings
// existed continues in its department workspace.
function pipelineHref(current: number, account: Account) {
  if (current < 6) return "?tab=outreach";
  if (account.listingVehicleId) return "?tab=fit#listing";
  return `/desk/municipalities/${encodeURIComponent(account.organizationId ?? "")}`;
}

function Pipeline({ current, account }: { current: number; account: Account }) {
  const [title, reason] = actions[current]!;
  const href = pipelineHref(current, account);
  return (
    <>
      <NextAction
        title={title}
        reason={reason}
        action={
          <Link className="button" href={href}>
            {title}
          </Link>
        }
      />
      <ol className="desk-rail" aria-label="Account pipeline">
        {pipeline.map((label, index) => (
          <li
            key={label}
            data-state={index < current ? "done" : index === current ? "current" : "pending"}
            aria-current={index === current ? "step" : undefined}
          >
            <span aria-hidden="true" />
            {label}
          </li>
        ))}
      </ol>
    </>
  );
}

// `?step=` selects an outreach section; anything else falls back to the reached step.
function outreachStepParam(value: string | undefined) {
  const step = Number(value);
  return Number.isInteger(step) && step >= 0 && step <= 3 ? step : undefined;
}

type Profile = Awaited<ReturnType<typeof getGrowthProfile>>;
type Pairing = Awaited<ReturnType<typeof listSourcingCases>>[number];

function ProspectDock({
  insights,
  pairings,
}: {
  insights: Profile["insights"];
  pairings: Pairing[];
}) {
  const themes = insights.flatMap((insight) =>
    insight.result.themes.map((theme, index) => ({ key: `${insight.id}:${index}`, theme })),
  );
  return (
    <section className="desk-prospect-dock">
      <header>
        <h2>Account assistant</h2>
        <p>Background analyst proposals · Needs your review</p>
      </header>
      {themes.map(({ key, theme }) => (
        <article className="desk-card desk-chat-card" key={key}>
          <span className="state state-needs_review">Needs review</span>
          <h3>{theme.theme}</h3>
          <blockquote>{theme.quote}</blockquote>
          <p>{theme.suggestion}</p>
        </article>
      ))}
      {!themes.length && <p>No background analysis is saved for this account yet.</p>}
      <h3>Ask about a connection</h3>
      <p>Conversation runs inside a buyer connection so answers stay tied to its evidence.</p>
      {pairings.map((item) => (
        <Link className="desk-dock-link" key={item.id} href={`/desk/sourcing/${item.id}`}>
          <strong>{item.buyer}</strong>
          <span>{connectionStages[item.stage]}</span>
        </Link>
      ))}
      {!pairings.length && <p>No connection yet. Connect a buyer need to this seller.</p>}
    </section>
  );
}

function Pairings({ cases }: { cases: Pairing[] }) {
  return (
    <section className="desk-card">
      <h2>Buyer connections</h2>
      <div className="desk-pairings">
        {cases.map((item) => (
          <Link className="desk-dock-link" key={item.id} href={`/desk/sourcing/${item.id}`}>
            <strong>For {item.buyer}</strong>
            <span>
              {connectionStages[item.stage]} · {item.nextAction}
            </span>
          </Link>
        ))}
      </div>
      {!cases.length && <p>No buyer need is connected to this seller yet.</p>}
    </section>
  );
}

type Listing = Awaited<ReturnType<typeof listSellerListings>>[number];
type Need = Awaited<ReturnType<typeof listBuyerNeeds>>[number];

// Each listing can start a connection toward any active buyer need not yet connected to it.
function SellerListings({
  listings,
  needs,
  cases,
}: {
  listings: Listing[];
  needs: Need[];
  cases: Pairing[];
}) {
  if (!listings.length) return null;
  const connected = new Set(cases.map((item) => item.needId));
  const options = needs
    .filter((need) => need.state === "active" && !connected.has(need.id))
    .map((need) => ({ value: need.id, label: `${need.buyer} · ${need.constraints.vehicleClass}` }));
  return (
    <section className="desk-card" id="listing">
      <h2>Listings</h2>
      {listings.map((listing) => (
        <article key={listing.id} className="mt-4">
          <h3>{listing.title}</h3>
          <p className="desk-note">
            {listing.listed ? "Listed" : "Draft listing · unpublished"} · Owned by this seller
          </p>
          <ConnectionForm
            label="Connect buyer need"
            fieldLabel="Buyer need"
            name="needId"
            options={options}
            base={{ vehicleId: listing.id }}
          />
          {!options.length && (
            <p>No unconnected active buyer need. Record one under Buyer needs.</p>
          )}
        </article>
      ))}
    </section>
  );
}

/** Authorized account evidence and review controls; conversation remains scoped to a connection. */
export default async function ProspectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; step?: string }>;
}) {
  let profile;
  let cases;
  let needs;
  let listings;
  const query = await searchParams;
  const tab = accountTab(query.tab);
  const step = outreachStepParam(query.step);
  try {
    const actor = await requireActor();
    [profile, cases, needs, listings] = await Promise.all([
      getGrowthProfile(actor, (await params).id),
      listSourcingCases(actor),
      listBuyerNeeds(actor),
      listSellerListings(actor),
    ]);
  } catch (error) {
    return (
      <GrowthUnavailable
        error={error}
        title="Account unavailable."
        href="/desk/prospects"
        backLabel="Back to accounts"
      />
    );
  }
  const { account } = profile;
  const pairings = cases.filter((item) => item.sellerId === account.id);
  const current = pipelineStage(account, profile.outreach.length > 0, profile.replies.length > 0);
  return (
    <AccountFrame
      name={account.name}
      place={`${account.directory.city}, NY`}
      synthetic={account.directory.synthetic}
      context="Prospect review"
      role={prospectRole(account)}
      tab={tab}
      dock={<ProspectDock insights={profile.insights} pairings={pairings} />}
    >
      {tab === "overview" && <Pipeline current={current} account={account} />}
      <GrowthAccountContent profile={profile} tab={tab} current={current} step={step} />
      {["overview", "fit"].includes(tab) && (
        <>
          <SellerListings
            listings={listings.filter((listing) => listing.sellerId === account.id)}
            needs={needs}
            cases={pairings}
          />
          <Pairings cases={pairings} />
        </>
      )}
    </AccountFrame>
  );
}
