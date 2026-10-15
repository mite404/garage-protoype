insert into signal_desk.vehicles(id,title,published_at)
values ('demo-pumper','2004 synthetic pumper',now()) on conflict do nothing;
insert into signal_desk.public_facts
  (vehicle_id,field,value,citation_excerpt,source_label,approved_at,shareable)
values ('demo-pumper','year','2004','Model year: 2004','Synthetic demonstration brochure',now(),true)
on conflict do nothing;
