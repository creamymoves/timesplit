-- 0002_listings.sql
-- Resorts catalog, listings (an owner's unit at a resort), availability windows, photos.

create table public.resorts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  brand         text,                          -- e.g. Marriott Vacation Club, Hilton Grand Vacations, Disney Vacation Club
  address_line1 text,
  address_line2 text,
  city          text not null,
  state         char(2) not null,
  postal_code   text,
  country       char(2) not null default 'US',
  latitude      numeric(9,6),
  longitude     numeric(9,6),
  timezone      text not null default 'America/New_York',   -- IANA; check-in day boundaries are resort-local
  website_url   text,
  is_verified   boolean not null default false,             -- admin-curated vs owner-proposed
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint resorts_us_only_chk check (country = 'US'),
  constraint resorts_state_chk check (state ~ '^[A-Z]{2}$')
);
create index resorts_name_trgm_idx on public.resorts using gin (name gin_trgm_ops);
create index resorts_state_city_idx on public.resorts(state, city);
create trigger resorts_set_updated_at before update on public.resorts
  for each row execute function public.set_updated_at();

create table public.listings (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references public.profiles(id) on delete restrict,
  resort_id            uuid not null references public.resorts(id) on delete restrict,
  title                text not null,
  description          text,
  unit_type            public.unit_type not null,
  bedrooms             smallint not null default 1 check (bedrooms between 0 and 10),
  bathrooms            numeric(3,1) not null default 1 check (bathrooms between 0 and 10),
  sleeps               smallint not null check (sleeps between 1 and 30),
  amenities            text[] not null default '{}',
  house_rules          text,
  cancellation_policy  public.cancellation_policy not null default 'moderate',
  status               public.listing_status not null default 'draft',
  admin_notes          text,                       -- visible to admins only (column-level via view later)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.listings is 'An owner''s unit at a resort. Dates and price live in availability_windows.';
create index listings_owner_idx on public.listings(owner_id);
create index listings_resort_status_idx on public.listings(resort_id, status);
create trigger listings_set_updated_at before update on public.listings
  for each row execute function public.set_updated_at();

-- An availability window is a block of nights the owner is offering.
-- Fixed-week owners set whole_window_only = true (renter must take the whole block).
-- Points owners can offer flexible windows with min/max nights.
create table public.availability_windows (
  id                     uuid primary key default gen_random_uuid(),
  listing_id             uuid not null references public.listings(id) on delete cascade,
  start_date             date not null,     -- first check-in date
  end_date               date not null,     -- last check-out date (exclusive upper bound of the stay range)
  nightly_rate_cents     integer not null check (nightly_rate_cents > 0),
  cleaning_fee_cents     integer not null default 0 check (cleaning_fee_cents >= 0),
  min_nights             smallint not null default 1 check (min_nights >= 1),
  max_nights             smallint check (max_nights is null or max_nights >= min_nights),
  whole_window_only      boolean not null default false,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint aw_dates_chk check (end_date > start_date),
  -- A listing cannot offer two overlapping windows.
  constraint aw_no_overlap exclude using gist (
    listing_id with =,
    daterange(start_date, end_date, '[)') with &&
  ) where (is_active)
);
create index aw_listing_dates_idx on public.availability_windows(listing_id, start_date, end_date);
create trigger aw_set_updated_at before update on public.availability_windows
  for each row execute function public.set_updated_at();

create table public.listing_photos (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  storage_path text not null,                -- `listing-photos/<owner_id>/<listing_id>/<uuid>.jpg`
  caption      text,
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now(),
  unique (listing_id, storage_path)
);
create index listing_photos_listing_idx on public.listing_photos(listing_id, sort_order);

-- Only verified owners may publish. Enforced in the DB, not just the UI.
create or replace function public.enforce_listing_publish_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status public.owner_verification_status;
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    select owner_verification_status into v_status from public.profiles where id = new.owner_id;
    if v_status is distinct from 'approved' then
      raise exception 'owner must be verified before publishing a listing' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger listings_publish_gate before insert or update of status on public.listings
  for each row execute function public.enforce_listing_publish_gate();
