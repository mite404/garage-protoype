import Link from "next/link";
import { requireActor } from "@/server/auth";
import { getGrowthProfile } from "@/server/growth-views";
import { listSourcingCases } from "@/server/sourcing";
import { AccountFrame, NextAction, accountTab } from "@signal-desk/catalog/desk-shell";
import { pipelineStage, pairingStages, prospectRole } from "@signal-desk/catalog/desk-state";
import { GrowthAccountContent, GrowthUnavailable } from "../../growth-profile";

export const dynamic = "force-dynamic";
const pipeline = [
  "Discovered",
  "Identity",
  "Routed",
  "Contact permission",
  "Sequence",
  "Reply",
  "Active deal",
];
// One next review per pipeline stage, indexed like `pipeline`.
const actions = [
  ["Confirm identity", "Directory presence is not intent. Confirm this is the right department."],
  ["Confirm identity", "Directory presence is not intent. Confirm this is the right department."],
  ["Review contact", "Record the contact's source and permission before any outreach."],
  ["Review contact", "Record the contact's source and permission before any outreach."],
  ["Review outreach", "Approve a reviewed sequence. Delivery stays disabled in this workspace."],
  ["Review reply", "Read the original answer before changing qualification."],
  ["Open active deal", "This account is qualified. Continue in its deal workspace."],
] as const;

function Pipeline({ current, organizationId }: { current: number; organizationId: string | null }) {
  const [title, reason] = actions[current]!;
  const href =
    current === 6 && organizationId
      ? `/desk/municipalities/${encodeURIComponent(organizationId)}`
      : "?tab=outreach";
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
      <h3>Ask about a pairing</h3>
      <p>Conversation runs inside a buyer-need pairing so answers stay tied to its evidence.</p>
      {pairings.map((item) => (
        <Link className="desk-dock-link" key={item.id} href={`/desk/sourcing/${item.id}`}>
          <strong>{item.buyer}</strong>
          <span>{pairingStages[item.stage]}</span>
        </Link>
      ))}
      {!pairings.length && <p>No pairing yet. Start from a confirmed buyer need.</p>}
    </section>
  );
}

function Pairings({ cases }: { cases: Awaited<ReturnType<typeof listSourcingCases>> }) {
  return (
    <section className="desk-card">
      <h2>Buyer-need pairings</h2>
      <div className="desk-pairings">
        {cases.map((item) => (
          <Link className="desk-dock-link" key={item.id} href={`/desk/sourcing/${item.id}`}>
            <strong>For {item.buyer}</strong>
            <span>
              {pairingStages[item.stage]} · {item.nextAction}
            </span>
          </Link>
        ))}
      </div>
      {!cases.length && (
        <p>
          Pairings start from a confirmed buyer need. No pairing has been linked to this account.
        </p>
      )}
    </section>
  );
}

/** Authorized account evidence and review controls; conversation remains scoped to a pairing. */
export default async function ProspectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; step?: string }>;
}) {
  let profile;
  let cases;
  const query = await searchParams;
  const tab = accountTab(query.tab);
  const step = outreachStepParam(query.step);
  try {
    const actor = await requireActor();
    [profile, cases] = await Promise.all([
      getGrowthProfile(actor, (await params).id),
      listSourcingCases(actor),
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
      role={prospectRole(account.qualified)}
      tab={tab}
      dock={<ProspectDock insights={profile.insights} pairings={pairings} />}
    >
      {tab === "overview" && <Pipeline current={current} organizationId={account.organizationId} />}
      <GrowthAccountContent profile={profile} tab={tab} current={current} step={step} />
      {["overview", "fit"].includes(tab) && <Pairings cases={pairings} />}
    </AccountFrame>
  );
}
