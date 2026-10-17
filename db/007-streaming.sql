create table signal_desk.stream_turns (
  id text primary key references signal_desk.chat_turns(id) on delete cascade,
  opportunity_id text not null references signal_desk.opportunities(id) on delete cascade,
  actor_id uuid not null references signal_desk.identities(user_id),
  credential jsonb not null check (credential->>'kind' in ('supabase-session','app-token')),
  inquiry_id text not null references signal_desk.inquiries(id),
  message text not null,
  revision integer not null,
  state text not null default 'queued'
    check (state in ('queued','running','completed','interrupted','cancelling','cancelled')),
  text text not null default '',
  submission_id text,
  error_code text,
  created_at timestamptz not null default clock_timestamp()
);
create index stream_turns_opportunity on signal_desk.stream_turns(opportunity_id,created_at);
create index stream_turns_actor on signal_desk.stream_turns(actor_id);
create index stream_turns_inquiry on signal_desk.stream_turns(inquiry_id);
create index stream_turns_pending on signal_desk.stream_turns(created_at)
  where state in ('queued','running','cancelling');
alter table signal_desk.stream_turns enable row level security;
grant select,insert,update on signal_desk.stream_turns to signal_desk_runtime;
create policy server_read on signal_desk.stream_turns for select to signal_desk_runtime using (true);
create policy server_insert on signal_desk.stream_turns for insert to signal_desk_runtime with check (true);
create policy server_update on signal_desk.stream_turns for update to signal_desk_runtime using (true) with check (true);

-- Framework tables are installed by the pinned adapter through the operator migration command.
create schema signal_desk_flue;
revoke all on schema signal_desk_flue from public;
grant usage on schema signal_desk_flue to signal_desk_runtime;
