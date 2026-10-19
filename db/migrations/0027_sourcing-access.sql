alter table signal_desk.buyer_needs enable row level security;
alter table signal_desk.sourcing_cases enable row level security;
alter table signal_desk.source_changes enable row level security;
alter table signal_desk.pairing_facts enable row level security;
alter table signal_desk.pairing_events enable row level security;
revoke all on signal_desk.buyer_needs, signal_desk.sourcing_cases, signal_desk.source_changes,
  signal_desk.pairing_facts, signal_desk.pairing_events from public;
grant select, insert, update on signal_desk.buyer_needs, signal_desk.sourcing_cases,
  signal_desk.source_changes, signal_desk.pairing_facts to signal_desk_runtime;
grant select, insert on signal_desk.pairing_events to signal_desk_runtime;
create policy server_access on signal_desk.buyer_needs to signal_desk_runtime
  using (true) with check (true);
create policy server_access on signal_desk.sourcing_cases to signal_desk_runtime
  using (true) with check (true);
create policy server_access on signal_desk.source_changes to signal_desk_runtime
  using (true) with check (true);
create policy server_access on signal_desk.pairing_facts to signal_desk_runtime
  using (true) with check (true);
create policy server_read on signal_desk.pairing_events for select
  to signal_desk_runtime using (true);
create policy server_insert on signal_desk.pairing_events for insert
  to signal_desk_runtime with check (true);
alter table signal_desk.buyer_needs add constraint buyer_needs_state_check
  check (state in ('draft','active','paused','fulfilled','closed'));
alter table signal_desk.sourcing_cases add constraint sourcing_cases_stage_check
  check (stage in ('investigate','awaiting_seller','evidence_review','ready_for_buyer_review',
    'handed_off','rejected','unavailable'));
alter table signal_desk.source_changes add constraint source_changes_disposition_check
  check (disposition in ('open','kept','dismissed'));
alter table signal_desk.pairing_facts add constraint pairing_facts_status_check
  check (status in ('proposed','accepted','rejected'));
alter table signal_desk.pairing_facts add constraint pairing_facts_review_check
  check ((status = 'proposed') = (reviewed_at is null));
alter table signal_desk.inference_operations drop constraint inference_one_context;
alter table signal_desk.inference_operations add constraint inference_one_context
  check (num_nonnulls(opportunity_id, prospect_id, sourcing_case_id) = 1);
alter table signal_desk.chat_turns add constraint chat_turns_subject_check
  check (num_nonnulls(opportunity_id, sourcing_case_id) = 1);
alter table signal_desk.stream_turns add constraint stream_turns_subject_check
  check (num_nonnulls(opportunity_id, sourcing_case_id) = 1
    and (opportunity_id is null or inquiry_id is not null));
create index chat_turns_sourcing_case on signal_desk.chat_turns(sourcing_case_id)
  where sourcing_case_id is not null;
create index buyer_needs_owner on signal_desk.buyer_needs(owner_id,id);
create index sourcing_cases_owner on signal_desk.sourcing_cases(owner_id,id);
create index sourcing_cases_seller on signal_desk.sourcing_cases(seller_prospect_id);
create index pairing_facts_case on signal_desk.pairing_facts(case_id,created_at);
create index pairing_events_case on signal_desk.pairing_events(case_id,created_at);
create index source_changes_case on signal_desk.source_changes(case_id,observed_at);
create index stream_turns_sourcing_case on signal_desk.stream_turns(sourcing_case_id,actor_id,created_at)
  where sourcing_case_id is not null;
create index inference_operations_sourcing_case
  on signal_desk.inference_operations(sourcing_case_id) where sourcing_case_id is not null;
