-- Development seed: a handful of well-known US timeshare resorts so listings can be created immediately.
insert into public.resorts (name, brand, city, state, timezone, is_verified) values
  ('Marriott''s Grande Vista', 'Marriott Vacation Club', 'Orlando', 'FL', 'America/New_York', true),
  ('Hilton Grand Vacations Club at Parc Soleil', 'Hilton Grand Vacations', 'Orlando', 'FL', 'America/New_York', true),
  ('Disney''s Polynesian Villas & Bungalows', 'Disney Vacation Club', 'Lake Buena Vista', 'FL', 'America/New_York', true),
  ('Marriott''s Ko Olina Beach Club', 'Marriott Vacation Club', 'Kapolei', 'HI', 'Pacific/Honolulu', true),
  ('Hilton Hawaiian Village Lagoon Tower', 'Hilton Grand Vacations', 'Honolulu', 'HI', 'Pacific/Honolulu', true),
  ('Westin Kierland Villas', 'Marriott Vacation Club', 'Scottsdale', 'AZ', 'America/Phoenix', true),
  ('Marriott''s Newport Coast Villas', 'Marriott Vacation Club', 'Newport Beach', 'CA', 'America/Los_Angeles', true),
  ('Wyndham Bonnet Creek', 'Club Wyndham', 'Orlando', 'FL', 'America/New_York', true),
  ('Hyatt Residence Club Key West, Beach House', 'Hyatt Vacation Club', 'Key West', 'FL', 'America/New_York', true),
  ('Marriott''s Grand Chateau', 'Marriott Vacation Club', 'Las Vegas', 'NV', 'America/Los_Angeles', true)
on conflict do nothing;
