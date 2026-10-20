"use client";

import Link from "next/link";
import type { getRecentAccount } from "@/server/growth-views";
import { NextAction } from "@signal-desk/catalog/desk-shell";
import { prospectRole } from "@signal-desk/catalog/desk-state";
import { WhyHere } from "@signal-desk/catalog/sourcing-workspace";
import { FitTable } from "@signal-desk/catalog/sourcing-cards";
import { evaluateFit, type SourcingAccount } from "@signal-desk/contracts/sourcing-schema";

type Recent = NonNullable<Awaited<ReturnType<typeof getRecentAccount>>>;

const date = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});

function ProspectContext({ account }: { account: Recent["account"] }) {
  return (
    <section className="desk-card">
      <h2>Why this account is here</h2>
      <p>
        Account fit: {account.fit.replaceAll("_", " ")} · Identity:{" "}
        {account.identityState.replaceAll("_", " ")}.
      </p>
      {account.buyingSignal ? (
        <blockquote className="growth-quote">
          <p>“{account.buyingSignal.quote}”</p>
          <cite>
            {account.buyingSignal.source} · {account.buyingSignal.permission}
          </cite>
        </blockquote>
      ) : (
        <p className="desk-note">
          No reviewed buying signal recorded. Directory presence is not sale intent.
        </p>
      )}
    </section>
  );
}

function AccountAction({ data, href }: { data?: SourcingAccount; href: string }) {
  return (
    <NextAction
      title={data?.nextAction ?? "Continue reviewing this account"}
      reason={
        data
          ? `Buyer: ${data.need.buyer} · ${data.need.vehicleClass} requirements and reviewed evidence below.`
          : "Check the recorded qualifiers before taking the next outreach step."
      }
      action={
        <Link className="button" href={href}>
          Continue account review
        </Link>
      }
    />
  );
}

function AccountEvidence({
  account,
  data,
  href,
}: {
  account: Recent["account"];
  data?: SourcingAccount;
  href: string;
}) {
  return (
    <>
      {data ? <WhyHere data={data} /> : <ProspectContext account={account} />}
      <section className="desk-card">
        <h2>Can this candidate meet the need?</h2>
        {data ? (
          <FitTable need={data.need} rows={evaluateFit(data.need, data.facts)} />
        ) : (
          <p>
            No confirmed buyer need is linked. Fit is unknown until a buyer's requirements and
            reviewed vehicle evidence are recorded.
          </p>
        )}
        <p className="desk-note mt-4">
          Contact permission:{" "}
          {account.contactable ? "Established for the recorded purpose" : "Not established"}.{" "}
          <Link href={`${href}?tab=sources`}>Review sources and original evidence</Link>
        </p>
      </section>
    </>
  );
}

function AccountIdentity({ recent, href }: { recent: Recent; href: string }) {
  const { account, at } = recent;
  return (
    <header className="desk-identity">
      <div>
        <p className="eyebrow">Last account worked</p>
        <h2>
          <Link href={href}>{account.name}</Link>
        </h2>
        <span className="desk-role">{prospectRole(account)}</span>
        <p>
          {account.directory.city}, NY ·{" "}
          {account.directory.synthetic ? "Synthetic fixture" : "USFA directory"}
        </p>
      </div>
      <p className="desk-note">
        Recorded activity: <time dateTime={at.toISOString()}>{date.format(at)} New York time</time>
        <br />
        Human reviews and account chats, not page views or automated research.
      </p>
    </header>
  );
}

/** Refreshes the rep's memory from the latest recorded action, preserving unknown evidence. */
export function RecentAccount({ recent }: { recent: Recent | null }) {
  if (!recent)
    return (
      <div className="desk-card mt-6">
        <p>No recorded account work yet. Open an account to start reviewing its evidence.</p>
        <Link className="quiet-button mt-4" href="/desk/prospects">
          Browse accounts
        </Link>
      </div>
    );
  const { account, sourcing } = recent;
  const data = sourcing?.account;
  const href = sourcing ? `/desk/sourcing/${sourcing.caseId}` : `/desk/prospects/${account.id}`;
  return (
    <section className="desk-recent mt-6" aria-label="Last account worked">
      <AccountIdentity recent={recent} href={href} />
      <AccountAction data={data} href={href} />
      <AccountEvidence account={account} data={data} href={href} />
    </section>
  );
}
