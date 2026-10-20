-- The runtime syncs blockers inside case writes; rows are never deleted, only resolved.
alter table signal_desk.connection_blockers enable row level security;
revoke all on signal_desk.connection_blockers from public;
grant select, insert, update on signal_desk.connection_blockers to signal_desk_runtime;
create policy server_access on signal_desk.connection_blockers to signal_desk_runtime
  using (true) with check (true);
alter table signal_desk.connection_blockers add constraint connection_blockers_kind_check
  check (kind in ('available','height','budget','authority','contact_permission'));
alter table signal_desk.connection_blockers add constraint connection_blockers_order_check
  check (resolved_at is null or resolved_at >= opened_at);
create index connection_blockers_case on signal_desk.connection_blockers(case_id,opened_at);
