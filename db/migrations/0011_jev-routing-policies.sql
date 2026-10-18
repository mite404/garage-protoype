-- Jev bills 0.042 microUSD per input token and nothing for output, which integer per-token rates
-- cannot express. Rates now apply per rate_tokens tokens; a zero output rate is allowed.
alter table signal_desk.inference_models
  add constraint inference_models_rate_tokens_check check (rate_tokens between 1 and 1000000),
  drop constraint inference_models_output_micro_usd_check,
  add constraint inference_models_output_micro_usd_check
    check (output_micro_usd between 0 and 10000);

-- Advisory Jev routing is append-only and server-read; it never grants access or visibility.
alter table signal_desk.inquiry_suggestions
  add constraint inquiry_suggestions_inquiry_id_fkey
    foreign key (inquiry_id) references signal_desk.inquiries(id);
alter table signal_desk.inquiry_suggestions enable row level security;
grant select,insert on signal_desk.inquiry_suggestions to signal_desk_runtime;
create policy server_read on signal_desk.inquiry_suggestions
  for select to signal_desk_runtime using (true);
create policy server_insert on signal_desk.inquiry_suggestions
  for insert to signal_desk_runtime with check (true);
