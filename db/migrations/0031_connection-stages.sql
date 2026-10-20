-- A connection runs from investigating to a closed sale; handed-off pairings were introductions.
alter table signal_desk.sourcing_cases drop constraint sourcing_cases_stage_check;
update signal_desk.sourcing_cases set stage = 'introduced' where stage = 'handed_off';
alter table signal_desk.sourcing_cases add constraint sourcing_cases_stage_check
  check (stage in ('investigate','awaiting_seller','evidence_review','ready_for_buyer_review',
    'introduced','sale_closed','closed_elsewhere','rejected','unavailable'));
-- Introducing a buyer or closing a sale needs the seller's vehicle on the connection.
alter table signal_desk.sourcing_cases add constraint sourcing_cases_vehicle_stage_check
  check (vehicle_id is not null or stage not in ('introduced','sale_closed'));
-- One vehicle sells once, so at most one connection per vehicle can record a closed sale.
create unique index sourcing_cases_vehicle_sale on signal_desk.sourcing_cases(vehicle_id)
  where stage = 'sale_closed';
create index sourcing_cases_vehicle on signal_desk.sourcing_cases(vehicle_id)
  where vehicle_id is not null;
create index sourcing_cases_need on signal_desk.sourcing_cases(need_id);
-- Qualifying a seller drafts an unpublished listing owned by that department.
grant insert on signal_desk.vehicles to signal_desk_runtime;
create policy server_insert on signal_desk.vehicles for insert to signal_desk_runtime
  with check (published_at is null and revision = 0);
