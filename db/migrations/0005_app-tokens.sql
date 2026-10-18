create table signal_desk.app_tokens (
  id uuid primary key,
  user_id uuid not null references signal_desk.identities(user_id),
  label text not null check (length(label) between 1 and 100),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null default array['read']::text[]
    check (scopes <@ array['read','write','spend']::text[] and 'read'=any(scopes)),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index app_tokens_user on signal_desk.app_tokens(user_id);
alter table signal_desk.app_tokens enable row level security;
grant select,insert,update(revoked_at) on signal_desk.app_tokens to signal_desk_runtime;
create policy server_token on signal_desk.app_tokens to signal_desk_runtime
  using (true) with check (true);

alter table signal_desk.import_jobs alter column session_id drop not null;
alter table signal_desk.import_jobs add column app_token_id uuid references signal_desk.app_tokens(id);
alter table signal_desk.import_jobs add constraint import_credential
  check (num_nonnulls(session_id,app_token_id)=1);
create index import_jobs_token on signal_desk.import_jobs(app_token_id);

-- Token updates take a conflicting table lock before revocation commits, just like identity revocation.
create or replace function signal_desk.lock_inference_access() returns void
language sql security definer set search_path = pg_catalog as $$
  lock table signal_desk.identities, auth.sessions,
    signal_desk.opportunities, signal_desk.opportunity_members,
    signal_desk.app_tokens in share mode;
$$;
create or replace function signal_desk.lock_evidence_access() returns void
language sql security definer set search_path = pg_catalog as $$
  lock table signal_desk.identities, auth.sessions,
    signal_desk.opportunity_members, signal_desk.app_tokens in share mode;
$$;

-- Management must not take a SHARE lock on tokens and then upgrade it under concurrent revocations.
create function signal_desk.lock_token_management() returns void
language sql security definer set search_path = pg_catalog as $$
  lock table signal_desk.identities, auth.sessions in share mode;
$$;
revoke all on function signal_desk.lock_token_management() from public;
grant execute on function signal_desk.lock_token_management() to signal_desk_runtime;
