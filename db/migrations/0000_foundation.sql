create schema if not exists signal_desk;
revoke all on schema signal_desk from public;

create table signal_desk.identities (
  user_id uuid primary key,
  role text not null check (role in ('buyer', 'specialist')),
  can_spend boolean not null default false,
  invited_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table signal_desk.vehicles (
  id text primary key,
  title text not null,
  internal_notes text not null default '',
  published_at timestamptz
);

create table signal_desk.opportunities (
  id text primary key,
  vehicle_id text not null references signal_desk.vehicles(id),
  buyer_id uuid not null references signal_desk.identities(user_id),
  internal_notes text not null default '',
  next_action text not null default ''
);
create index opportunities_vehicle on signal_desk.opportunities(vehicle_id);
create index opportunities_buyer on signal_desk.opportunities(buyer_id);

create table signal_desk.opportunity_members (
  opportunity_id text not null references signal_desk.opportunities(id),
  user_id uuid not null references signal_desk.identities(user_id),
  primary key (opportunity_id,user_id)
);
create index opportunity_members_user on signal_desk.opportunity_members(user_id);

create table signal_desk.sources (
  id text primary key,
  opportunity_id text not null references signal_desk.opportunities(id),
  owner_id uuid not null references signal_desk.identities(user_id),
  audience text not null default 'private' check (audience in ('private','sales')),
  name text not null,
  media_type text not null,
  content bytea not null check (octet_length(content) <= 10485760)
);
create index sources_opportunity on signal_desk.sources(opportunity_id);
create index sources_owner on signal_desk.sources(owner_id);

-- An explicit publication projection, never a serialized private vehicle or source.
create table signal_desk.public_facts (
  vehicle_id text not null references signal_desk.vehicles(id),
  field text not null,
  value text not null,
  citation_excerpt text not null,
  source_label text not null,
  approved_at timestamptz,
  shareable boolean not null default false,
  primary key (vehicle_id,field)
);

alter table signal_desk.identities enable row level security;
alter table signal_desk.vehicles enable row level security;
alter table signal_desk.opportunities enable row level security;
alter table signal_desk.opportunity_members enable row level security;
alter table signal_desk.sources enable row level security;
alter table signal_desk.public_facts enable row level security;

-- This role is server-only and cannot create objects or provision identities.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='signal_desk_runtime') then
    create role signal_desk_runtime nologin;
  end if;
end $$;
grant usage on schema signal_desk to signal_desk_runtime;
grant select on all tables in schema signal_desk to signal_desk_runtime;
create policy server_read on signal_desk.identities for select to signal_desk_runtime using (true);
create policy server_read on signal_desk.vehicles for select to signal_desk_runtime using (true);
create policy server_read on signal_desk.opportunities for select to signal_desk_runtime using (true);
create policy server_read on signal_desk.opportunity_members for select to signal_desk_runtime using (true);
create policy server_read on signal_desk.sources for select to signal_desk_runtime using (true);
create policy server_read on signal_desk.public_facts for select to signal_desk_runtime using (true);
grant usage on schema auth to signal_desk_runtime;
grant select (id,user_id,not_after) on auth.sessions to signal_desk_runtime;
create policy signal_desk_session_read on auth.sessions for select to signal_desk_runtime using (true);
