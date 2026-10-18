alter table signal_desk.vehicles add column revision integer not null default 0;
alter table signal_desk.opportunities add column assignee_id uuid references signal_desk.identities(user_id);
create index opportunities_assignee on signal_desk.opportunities(assignee_id);

create table signal_desk.evidence_blockers (
  id text primary key,
  opportunity_id text not null references signal_desk.opportunities(id) on delete cascade,
  blocker_key text not null,
  question text not null,
  field text,
  assignee_id uuid not null references signal_desk.identities(user_id),
  next_action text not null,
  state text not null default 'needs_review' check (state in ('needs_review','resolved')),
  unique(opportunity_id,blocker_key)
);
create index evidence_blockers_assignee on signal_desk.evidence_blockers(assignee_id);

alter table signal_desk.sources
  add column sha256 text generated always as (encode(sha256(content),'hex')) stored,
  add column kind text not null default 'document'
    check (kind in ('document','seller_note','private_note','inquiry','seller_response')),
  add column pages jsonb not null default '[]',
  add column shareable boolean not null default false,
  add column permission text not null default 'permissioned' check (permission in ('synthetic','permissioned')),
  add column provenance text not null default 'Legacy source; permission needs confirmation',
  add column blocker_id text references signal_desk.evidence_blockers(id),
  add column created_at timestamptz not null default clock_timestamp();
create index sources_hash on signal_desk.sources(opportunity_id,sha256);
create index sources_blocker on signal_desk.sources(blocker_id);

create table signal_desk.import_jobs (
  id text primary key,
  opportunity_id text not null references signal_desk.opportunities(id) on delete cascade,
  actor_id uuid not null references signal_desk.identities(user_id),
  session_id uuid not null,
  fingerprint text not null,
  model text not null,
  config text not null,
  input text not null,
  mode text not null default 'provider' check (mode in ('provider','saved_example')),
  state text not null default 'queued' check (state in ('queued','processing','ready','failed')),
  attempt integer not null default 1 check (attempt between 1 and 5),
  fence integer not null default 0,
  lease_until timestamptz,
  error text,
  created_at timestamptz not null default clock_timestamp(),
  unique(opportunity_id,fingerprint)
);
create index import_jobs_actor on signal_desk.import_jobs(actor_id);
create index import_jobs_queue on signal_desk.import_jobs(state,lease_until,created_at);
create table signal_desk.import_keys (
  actor_id uuid not null references signal_desk.identities(user_id),
  request_key text not null,
  fingerprint text not null,
  job_id text not null references signal_desk.import_jobs(id) on delete cascade,
  primary key(actor_id,request_key)
);
create index import_keys_job on signal_desk.import_keys(job_id);
create table signal_desk.import_sources (
  job_id text not null references signal_desk.import_jobs(id) on delete cascade,
  source_id text not null references signal_desk.sources(id) on delete cascade,
  primary key(job_id,source_id)
);
create index import_sources_source on signal_desk.import_sources(source_id);

create table signal_desk.claims (
  id text primary key,
  vehicle_id text not null references signal_desk.vehicles(id) on delete cascade,
  source_id text not null references signal_desk.sources(id) on delete cascade,
  job_id text not null references signal_desk.import_jobs(id) on delete cascade,
  field text not null,
  value text not null,
  unit text not null,
  page integer not null check (page > 0),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset),
  excerpt text not null,
  unique(source_id,field,value,unit,page,start_offset,end_offset)
);
create index claims_vehicle_field on signal_desk.claims(vehicle_id,field);
create index claims_job on signal_desk.claims(job_id);

create table signal_desk.evidence_reviews (
  id text primary key,
  vehicle_id text not null references signal_desk.vehicles(id) on delete cascade,
  opportunity_id text not null references signal_desk.opportunities(id) on delete cascade,
  actor_id uuid not null references signal_desk.identities(user_id),
  field text not null,
  kind text not null check (kind in ('select','correct','unknown')),
  claim_id text references signal_desk.claims(id) on delete cascade,
  value text not null,
  unit text not null,
  reason text not null,
  basis text not null,
  shareable boolean not null default false,
  revision integer not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(vehicle_id,revision)
);
create index evidence_reviews_field on signal_desk.evidence_reviews(vehicle_id,field,revision desc);
create index evidence_reviews_actor on signal_desk.evidence_reviews(actor_id);
create index evidence_reviews_opportunity on signal_desk.evidence_reviews(opportunity_id);
create index evidence_reviews_claim on signal_desk.evidence_reviews(claim_id);

create table signal_desk.source_classifications (
  id text primary key,
  source_id text not null references signal_desk.sources(id) on delete cascade,
  job_id text references signal_desk.import_jobs(id) on delete cascade,
  actor_id uuid references signal_desk.identities(user_id),
  kind text not null check (kind in ('supported','conflict','missing_evidence','private_context','human_review','conditional_offer')),
  basis text not null,
  next_action text not null,
  revision integer not null,
  created_at timestamptz not null default clock_timestamp(),
  check ((actor_id is null) <> (job_id is null))
);
create index source_classifications_source on signal_desk.source_classifications(source_id,revision desc);
create index source_classifications_job on signal_desk.source_classifications(job_id);
create index source_classifications_actor on signal_desk.source_classifications(actor_id);

alter table signal_desk.public_facts add column review_id text references signal_desk.evidence_reviews(id) on delete cascade;
create index public_facts_review on signal_desk.public_facts(review_id);

create function signal_desk.lock_evidence_access() returns void
language sql security definer set search_path = pg_catalog as $$
  lock table signal_desk.identities, auth.sessions,
    signal_desk.opportunity_members in share mode;
$$;
revoke all on function signal_desk.lock_evidence_access() from public;
grant execute on function signal_desk.lock_evidence_access() to signal_desk_runtime;

-- Runtime code can append evidence and decisions, never rewrite their originals.
grant insert on signal_desk.sources, signal_desk.claims, signal_desk.evidence_reviews,
  signal_desk.source_classifications, signal_desk.import_sources, signal_desk.import_keys to signal_desk_runtime;
grant select,insert,update(state,attempt,fence,lease_until,error) on signal_desk.import_jobs to signal_desk_runtime;
grant select,insert,update on signal_desk.evidence_blockers to signal_desk_runtime;
grant update(revision) on signal_desk.vehicles to signal_desk_runtime;
grant update(assignee_id,next_action) on signal_desk.opportunities to signal_desk_runtime;
grant insert,update,delete on signal_desk.public_facts to signal_desk_runtime;
create policy server_insert on signal_desk.sources for insert to signal_desk_runtime with check (true);
create policy server_update on signal_desk.vehicles for update to signal_desk_runtime using (true);
create policy server_update on signal_desk.opportunities for update to signal_desk_runtime using (true);
create policy server_insert on signal_desk.public_facts for insert to signal_desk_runtime with check (true);
create policy server_update on signal_desk.public_facts for update to signal_desk_runtime using (true);
create policy server_delete on signal_desk.public_facts for delete to signal_desk_runtime using (true);
do $$ declare t text; begin
  foreach t in array array['evidence_blockers','import_jobs','import_keys','import_sources','claims','evidence_reviews','source_classifications'] loop
    execute format('alter table signal_desk.%I enable row level security',t);
    execute format('grant select on signal_desk.%I to signal_desk_runtime',t);
    execute format('create policy server_read on signal_desk.%I for select to signal_desk_runtime using (true)',t);
    execute format('create policy server_insert on signal_desk.%I for insert to signal_desk_runtime with check (true)',t);
  end loop;
end $$;
create policy server_update on signal_desk.import_jobs for update to signal_desk_runtime using (true);
create policy server_update on signal_desk.evidence_blockers for update to signal_desk_runtime using (true);
