create table signal_desk.organizations (
  id text primary key,
  buyer_id uuid unique references signal_desk.identities(user_id),
  name text not null,
  city text not null,
  region text not null,
  unit text not null default '',
  synthetic boolean not null default false
);
alter table signal_desk.vehicles add column owner_organization_id text
  references signal_desk.organizations(id);
create index vehicles_owner_organization on signal_desk.vehicles(owner_organization_id);

create table signal_desk.opportunity_deal_terms (
  opportunity_id text primary key references signal_desk.opportunities(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'USD'),
  stage text not null check (stage in ('proposed','contingent','escrow_simulated')),
  conditions text[] not null check (cardinality(conditions) between 1 and 12)
);

create table signal_desk.municipality_interests (
  id text primary key,
  organization_id text not null references signal_desk.organizations(id),
  vehicle_id text not null references signal_desk.vehicles(id),
  kind text not null check (kind in ('favorite','contact')),
  occurred_at timestamptz not null default now(),
  unique (organization_id,vehicle_id,kind)
);
create index municipality_interests_vehicle on signal_desk.municipality_interests(vehicle_id);
create index stream_turns_history on signal_desk.stream_turns(actor_id,opportunity_id,created_at,id);

alter table signal_desk.organizations enable row level security;
alter table signal_desk.opportunity_deal_terms enable row level security;
alter table signal_desk.municipality_interests enable row level security;
revoke all on signal_desk.organizations,signal_desk.opportunity_deal_terms,
  signal_desk.municipality_interests from public;
grant select on signal_desk.organizations,signal_desk.opportunity_deal_terms,
  signal_desk.municipality_interests to signal_desk_runtime;
create policy server_read on signal_desk.organizations
  for select to signal_desk_runtime using (true);
create policy server_read on signal_desk.opportunity_deal_terms
  for select to signal_desk_runtime using (true);
create policy server_read on signal_desk.municipality_interests
  for select to signal_desk_runtime using (true);
