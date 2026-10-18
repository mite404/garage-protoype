alter table signal_desk.sources drop constraint sources_kind_check;
alter table signal_desk.sources add constraint sources_kind_check
  check (kind in ('document','seller_note','private_note','inquiry','seller_response','photo'));

-- Suggestions and reviews are append-only; a worker never writes human decisions.
create table signal_desk.photo_suggestions (
  id text primary key,
  source_id text not null references signal_desk.sources(id) on delete cascade,
  job_id text not null references signal_desk.import_jobs(id) on delete cascade,
  view text not null check (view in ('front','rear','driver_side','passenger_side','cab','pump_panel','odometer','identification_plate','unknown')),
  readable boolean not null,
  reason text not null,
  revision integer not null,
  unique(source_id,job_id)
);
create index photo_suggestions_job on signal_desk.photo_suggestions(job_id);
create table signal_desk.photo_reviews (
  id text primary key,
  source_id text not null references signal_desk.sources(id) on delete cascade,
  actor_id uuid not null references signal_desk.identities(user_id),
  view text not null check (view in ('front','rear','driver_side','passenger_side','cab','pump_panel','odometer','identification_plate','unknown')),
  readable boolean not null,
  approved boolean not null default false,
  reason text not null,
  revision integer not null,
  check (not approved or (readable and view <> 'unknown')),
  unique(source_id,revision)
);
create index photo_reviews_actor on signal_desk.photo_reviews(actor_id);
create index photo_reviews_source on signal_desk.photo_reviews(source_id,revision desc);

do $$ declare t text; begin
  foreach t in array array['photo_suggestions','photo_reviews'] loop
    execute format('alter table signal_desk.%I enable row level security',t);
    execute format('grant select,insert on signal_desk.%I to signal_desk_runtime',t);
    execute format('create policy server_read on signal_desk.%I for select to signal_desk_runtime using (true)',t);
    execute format('create policy server_insert on signal_desk.%I for insert to signal_desk_runtime with check (true)',t);
  end loop;
end $$;
