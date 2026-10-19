alter table signal_desk.opportunities add constraint opportunity_account_required
  check (buyer_id is not null or organization_id is not null);
create index opportunities_organization on signal_desk.opportunities(organization_id);
grant insert on signal_desk.organizations,signal_desk.opportunities,
  signal_desk.opportunity_members to signal_desk_runtime;
create policy server_insert on signal_desk.organizations for insert
  to signal_desk_runtime with check (true);
create policy server_insert on signal_desk.opportunities for insert
  to signal_desk_runtime with check (true);
create policy server_insert on signal_desk.opportunity_members for insert
  to signal_desk_runtime with check (true);
