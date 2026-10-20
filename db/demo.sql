-- Demonstration vehicles. demo-pumper is synthetic mock data. The other three are model
-- references, not vehicles for sale: each fact comes from the frozen labels in
-- apps/web/src/server/extraction-corpus/public-documents.json for a public document in
-- fixtures/seller-documents, with that document's excerpt and page. Values use canonicalValue.
insert into signal_desk.vehicles(id,title,published_at) values
  ('demo-pumper','2004 synthetic pumper',now()),
  ('demo-hme-wildland','HME Ahrens-Fox Wildland Type 1 Model 18 (brochure reference)',now()),
  ('demo-army-2500l','Army 1000 GPM multipurpose truck, Model 2500L (manual reference)',now()),
  ('demo-bme-sierra','BME Sierra Mini Pumper (brochure reference)',now())
on conflict do nothing;

insert into signal_desk.public_facts
  (vehicle_id,field,value,citation_excerpt,source_label,approved_at,shareable)
values
  ('demo-pumper','year','2004','Model year: 2004','Synthetic demonstration brochure',now(),true),

  ('demo-hme-wildland','chassisManufacturer','hme','Chassis: HME Custom',
    'HME-Wildland-Type1.pdf, page 1',now(),true),
  ('demo-hme-wildland','bodyBuilder','hme ahrens-fox','HME AHRENS-FOX',
    'HME-Wildland-Type1.pdf, page 1',now(),true),
  ('demo-hme-wildland','model','wildland type 1 model 18','WILDLAND TYPE 1 MODEL 18',
    'HME-Wildland-Type1.pdf, page 1',now(),true),
  ('demo-hme-wildland','transmission','allison 3000evs','Allison 3000EVS Transmission',
    'HME-Wildland-Type1.pdf, page 1',now(),true),
  ('demo-hme-wildland','pumpCapacity','1500 gpm','1500 GPM',
    'HME-Wildland-Type1.pdf, page 1',now(),true),
  ('demo-hme-wildland','tankCapacity','800 gal','Tank: 800 Gallons',
    'HME-Wildland-Type1.pdf, page 1',now(),true),

  ('demo-army-2500l','chassisManufacturer','amertek inc','Amertek Inc',
    'TM 5-4210-220-12, page 34',now(),true),
  ('demo-army-2500l','bodyBuilder','amertek inc','Amertek Inc',
    'TM 5-4210-220-12, page 34',now(),true),
  ('demo-army-2500l','fuel','df2','DF2','TM 5-4210-220-12, page 34',now(),true),
  ('demo-army-2500l','transmission','ht 750 drd','HT 750 DRD',
    'TM 5-4210-220-12, page 35',now(),true),
  ('demo-army-2500l','tankCapacity','660 gal','660 gal (2500 L)',
    'TM 5-4210-220-12, page 37',now(),true),
  ('demo-army-2500l','pumpCapacity','1000 gpm','1000 gpm at 150 psi',
    'TM 5-4210-220-12, page 37',now(),true),

  ('demo-bme-sierra','bodyBuilder','bme','BME''s Mini Pumper',
    'MiniPumper_Sierra_Brochure2025.pdf, page 1 (image)',now(),true),
  ('demo-bme-sierra','model','sierra','SIERRA',
    'MiniPumper_Sierra_Brochure2025.pdf, page 1 (image)',now(),true),
  ('demo-bme-sierra','tankCapacity','300 gal','300 Gallon Poly Water Tank',
    'MiniPumper_Sierra_Brochure2025.pdf, page 2 (image)',now(),true)
on conflict do nothing;
