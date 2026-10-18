create table signal_desk.inference_models (
  id text primary key,
  enabled boolean not null default true,
  max_input_bytes integer not null check (max_input_bytes between 1 and 10485760),
  max_photos integer not null check (max_photos between 0 and 20),
  photo_tokens integer not null check (photo_tokens between 0 and 100000),
  overhead_tokens integer not null check (overhead_tokens between 0 and 100000),
  max_output_tokens integer not null check (max_output_tokens between 1 and 100000),
  input_micro_usd integer not null check (input_micro_usd between 1 and 10000),
  output_micro_usd integer not null check (output_micro_usd between 1 and 10000),
  max_attempts integer not null check (max_attempts between 1 and 5),
  retry_ms integer not null check (retry_ms between 10 and 60000),
  timeout_ms integer not null check (timeout_ms between 10 and 60000)
);

-- Lifetime caps. Provision explicitly; missing rows deny spending.
create table signal_desk.inference_budgets (
  scope text primary key,
  limit_micro_usd bigint not null check (limit_micro_usd between 0 and 9007199254740991),
  spent_micro_usd bigint not null default 0 check (spent_micro_usd >= 0),
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  max_concurrent integer not null check (max_concurrent between 1 and 100),
  active integer not null default 0 check (active >= 0)
);

create table signal_desk.inference_operations (
  id uuid primary key,
  user_id uuid not null references signal_desk.identities(user_id),
  request_key text not null check (length(request_key) between 1 and 200),
  opportunity_id text not null references signal_desk.opportunities(id),
  fingerprint text not null,
  model_id text not null references signal_desk.inference_models(id),
  max_attempts integer not null,
  unique (user_id,request_key)
);
create index inference_operations_opportunity on signal_desk.inference_operations(opportunity_id);

create table signal_desk.inference_denials (
  id uuid primary key,
  user_id uuid,
  code text not null,
  decided_at timestamptz not null default clock_timestamp()
);
create index inference_denials_user on signal_desk.inference_denials(user_id,decided_at);

create table signal_desk.inference_attempts (
  id uuid primary key,
  operation_id uuid not null references signal_desk.inference_operations(id),
  number integer not null check (number > 0),
  state text not null check (state in ('dispatched','uncertain','completed','failed','not-billed')),
  reserved_micro_usd bigint not null check (reserved_micro_usd > 0),
  input_rate integer not null,
  output_rate integer not null,
  input_bound integer not null,
  output_bound integer not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  duration_ms integer,
  retry_ms integer not null check (retry_ms between 10 and 60000),
  retry_after timestamptz not null,
  report jsonb,
  reconciliation_evidence text,
  unique(operation_id,number),
  check ((state in ('dispatched','uncertain') and report is null and finished_at is null)
    or (state in ('completed','failed','not-billed') and report is not null
      and report->>'kind'=state and finished_at is not null))
);

-- A fixed, privileged lock operation grants no permission to edit identity tables.
-- ponytail: brief installation-wide permission locks; replace with keyed revocation locks
-- if measured admission throughput requires finer-grained authorization coordination.
create function signal_desk.lock_inference_access() returns void
language sql security definer set search_path = pg_catalog as $$
  lock table signal_desk.identities, auth.sessions,
    signal_desk.opportunities, signal_desk.opportunity_members in share mode;
$$;
revoke all on function signal_desk.lock_inference_access() from public;
grant execute on function signal_desk.lock_inference_access() to signal_desk_runtime;

alter table signal_desk.inference_models enable row level security;
alter table signal_desk.inference_budgets enable row level security;
alter table signal_desk.inference_operations enable row level security;
alter table signal_desk.inference_attempts enable row level security;
alter table signal_desk.inference_denials enable row level security;
grant select on signal_desk.inference_models to signal_desk_runtime;
grant select,update (spent_micro_usd,reserved_micro_usd,active)
  on signal_desk.inference_budgets to signal_desk_runtime;
grant select,insert on signal_desk.inference_operations to signal_desk_runtime;
grant select,insert,update on signal_desk.inference_attempts to signal_desk_runtime;
grant insert on signal_desk.inference_denials to signal_desk_runtime;
create policy server_read on signal_desk.inference_models for select to signal_desk_runtime using (true);
create policy server_budget on signal_desk.inference_budgets to signal_desk_runtime using (true) with check (true);
create policy server_operation on signal_desk.inference_operations to signal_desk_runtime using (true) with check (true);
create policy server_attempt on signal_desk.inference_attempts to signal_desk_runtime using (true) with check (true);
create policy server_denial on signal_desk.inference_denials for insert to signal_desk_runtime with check (true);
