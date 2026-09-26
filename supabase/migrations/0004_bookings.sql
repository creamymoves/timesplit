-- 0004_bookings.sql
-- Request-to-book lifecycle with a Postgres exclusion constraint and a short checkout hold.
--
-- Lifecycle:
--   requested --(owner accepts)--> accepting --(charge ok)--> confirmed --> checked_in --> completed
--      |                              |
--      | 48h with no answer            | charge fails / hold expires (15 min)
--      v                              v
--   expired                      payment_failed --(renter fixes card, owner re-accepts... or auto-retry)--> accepting
--
-- Calendar blocking: only rows in ('accepting','confirmed','checked_in','completed') block dates.
-- Overlapping *requests* are allowed; the owner picks one. When one confirms, the rest are auto-declined.

create table public.platform_settings (
  id                         boolean primary key default true check (id),   -- single row
  platform_fee_bps           integer not null default 1000 check (platform_fee_bps between 0 and 5000), -- 10% of subtotal, charged to owner
  request_ttl                interval not null default interval '48 hours',
  checkout_hold_ttl          interval not null default interval '15 minutes',
  payout_release_delay       interval not null default interval '24 hours',  -- after check-in
  currency                   char(3) not null default 'usd',
  updated_at                 timestamptz not null default now()
);
insert into public.platform_settings default values;
create trigger platform_settings_set_updated_at before update on public.platform_settings
  for each row execute function public.set_updated_at();

create table public.bookings (
  id                      uuid primary key default gen_random_uuid(),
  listing_id              uuid not null references public.listings(id) on delete restrict,
  availability_window_id  uuid references public.availability_windows(id) on delete set null,
  owner_id                uuid not null references public.profiles(id) on delete restrict,
  renter_id               uuid not null references public.profiles(id) on delete restrict,
  check_in                date not null,
  check_out               date not null,
  stay                    daterange generated always as (daterange(check_in, check_out, '[)')) stored,
  nights                  integer generated always as (check_out - check_in) stored,
  guests                  smallint not null default 1 check (guests >= 1),
  status                  public.booking_status not null default 'requested',
  -- pricing snapshot (immutable after request)
  currency                char(3) not null default 'usd',
  nightly_rate_cents      integer not null check (nightly_rate_cents > 0),
  cleaning_fee_cents      integer not null default 0 check (cleaning_fee_cents >= 0),
  subtotal_cents          integer not null check (subtotal_cents > 0),          -- nights * rate + cleaning
  renter_total_cents      integer not null check (renter_total_cents > 0),      -- what the renter is charged (= subtotal; no renter fee)
  platform_fee_bps        integer not null,
  platform_fee_cents      integer not null check (platform_fee_cents >= 0),      -- deducted from owner
  owner_payout_cents      integer not null check (owner_payout_cents >= 0),      -- subtotal - platform_fee
  cancellation_policy     public.cancellation_policy not null,
  -- stripe references (set by server / webhooks)
  stripe_payment_intent_id text unique,
  stripe_payment_method_id text,          -- renter's saved card, captured at request time
  -- clocks
  request_expires_at      timestamptz not null,   -- created_at + 48h
  hold_expires_at         timestamptz,            -- set while status = accepting
  accepted_at             timestamptz,
  confirmed_at            timestamptz,
  declined_at             timestamptz,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  checked_in_at           timestamptz,
  completed_at            timestamptz,
  renter_note             text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint bookings_dates_chk check (check_out > check_in),
  constraint bookings_parties_chk check (owner_id <> renter_id),
  constraint bookings_money_chk check (owner_payout_cents + platform_fee_cents = subtotal_cents),
  constraint bookings_hold_chk check (status <> 'accepting' or hold_expires_at is not null),

  -- THE overlap guard. Two calendar-blocking bookings on the same listing can never overlap,
  -- regardless of application bugs or concurrent requests.
  constraint bookings_no_double_booking exclude using gist (
    listing_id with =,
    stay with &&
  ) where (status in ('accepting', 'confirmed', 'checked_in', 'completed'))
);
comment on table public.bookings is 'Request-to-book. Money columns are a snapshot at request time and never change.';
create index bookings_listing_stay_idx on public.bookings using gist (listing_id, stay);
create index bookings_owner_status_idx on public.bookings(owner_id, status);
create index bookings_renter_status_idx on public.bookings(renter_id, status);
create index bookings_expiry_idx on public.bookings(request_expires_at) where status in ('requested', 'payment_failed');
create index bookings_hold_expiry_idx on public.bookings(hold_expires_at) where status = 'accepting';
create trigger bookings_set_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

-- Append-only status history for support/debugging.
create table public.booking_events (
  id          bigint generated always as identity primary key,
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  from_status public.booking_status,
  to_status   public.booking_status not null,
  actor_id    uuid references public.profiles(id),    -- null = system/webhook
  note        text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index booking_events_booking_idx on public.booking_events(booking_id, created_at);

create or replace function public.log_booking_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.booking_events (booking_id, from_status, to_status, actor_id)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid());
  end if;
  return new;
end $$;
create trigger bookings_log_status after insert or update of status on public.bookings
  for each row execute function public.log_booking_status_change();

-- Money snapshot is immutable once written.
create or replace function public.protect_booking_snapshot()
returns trigger language plpgsql as $$
begin
  if new.check_in <> old.check_in or new.check_out <> old.check_out
     or new.nightly_rate_cents <> old.nightly_rate_cents or new.cleaning_fee_cents <> old.cleaning_fee_cents
     or new.subtotal_cents <> old.subtotal_cents or new.renter_total_cents <> old.renter_total_cents
     or new.platform_fee_cents <> old.platform_fee_cents or new.owner_payout_cents <> old.owner_payout_cents
     or new.listing_id <> old.listing_id or new.owner_id <> old.owner_id or new.renter_id <> old.renter_id then
    raise exception 'booking snapshot fields are immutable';
  end if;
  return new;
end $$;
create trigger bookings_protect_snapshot before update on public.bookings
  for each row execute function public.protect_booking_snapshot();

-- ---------------------------------------------------------------------------
-- Pricing (single source of truth; the API and Expo apps call this for quotes)
-- ---------------------------------------------------------------------------
create type public.price_quote as (
  nights              integer,
  nightly_rate_cents  integer,
  cleaning_fee_cents  integer,
  subtotal_cents      integer,
  renter_total_cents  integer,
  platform_fee_bps    integer,
  platform_fee_cents  integer,
  owner_payout_cents  integer
);

create or replace function public.quote_stay(p_window_id uuid, p_check_in date, p_check_out date)
returns public.price_quote
language plpgsql stable security definer set search_path = public as $$
declare
  w   public.availability_windows;
  s   public.platform_settings;
  q   public.price_quote;
begin
  select * into w from public.availability_windows where id = p_window_id and is_active;
  if w.id is null then raise exception 'availability window not found' using errcode = 'P0002'; end if;
  select * into s from public.platform_settings;

  if p_check_out <= p_check_in then raise exception 'check_out must be after check_in'; end if;
  if p_check_in < w.start_date or p_check_out > w.end_date then
    raise exception 'dates fall outside the availability window';
  end if;
  if w.whole_window_only and (p_check_in <> w.start_date or p_check_out <> w.end_date) then
    raise exception 'this week must be booked in full';
  end if;

  q.nights := p_check_out - p_check_in;
  if q.nights < w.min_nights then raise exception 'minimum stay is % nights', w.min_nights; end if;
  if w.max_nights is not null and q.nights > w.max_nights then
    raise exception 'maximum stay is % nights', w.max_nights;
  end if;

  q.nightly_rate_cents := w.nightly_rate_cents;
  q.cleaning_fee_cents := w.cleaning_fee_cents;
  q.subtotal_cents     := q.nights * w.nightly_rate_cents + w.cleaning_fee_cents;
  q.renter_total_cents := q.subtotal_cents;                       -- no renter-side fee (decision)
  q.platform_fee_bps   := s.platform_fee_bps;
  q.platform_fee_cents := (q.subtotal_cents * s.platform_fee_bps + 5000) / 10000;  -- round half up
  q.owner_payout_cents := q.subtotal_cents - q.platform_fee_cents;
  return q;
end $$;

-- ---------------------------------------------------------------------------
-- Transitions. Renter/owner-initiated ones check auth.uid(); server-only ones
-- require the service role (execute is revoked from authenticated in 0008_rls.sql).
-- ---------------------------------------------------------------------------

-- Renter submits a request. Payment method is saved (SetupIntent) before calling this.
create or replace function public.request_booking(
  p_window_id uuid, p_check_in date, p_check_out date, p_guests smallint,
  p_payment_method_id text, p_note text default null
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  w  public.availability_windows;
  l  public.listings;
  s  public.platform_settings;
  q  public.price_quote;
  b  public.bookings;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into w from public.availability_windows where id = p_window_id and is_active;
  if w.id is null then raise exception 'availability window not found' using errcode = 'P0002'; end if;
  select * into l from public.listings where id = w.listing_id;
  if l.status <> 'active' then raise exception 'listing is not bookable'; end if;
  if l.owner_id = auth.uid() then raise exception 'owners cannot book their own listing'; end if;
  if p_guests > l.sleeps then raise exception 'unit sleeps at most %', l.sleeps; end if;
  if p_check_in < current_date then raise exception 'check-in is in the past'; end if;
  if coalesce(p_payment_method_id, '') = '' then raise exception 'payment method required'; end if;

  -- Soft check so renters get a clear error; the exclusion constraint is the hard guarantee at acceptance.
  if exists (
    select 1 from public.bookings x
    where x.listing_id = l.id
      and x.status in ('accepting', 'confirmed', 'checked_in', 'completed')
      and x.stay && daterange(p_check_in, p_check_out, '[)')
  ) then
    raise exception 'those dates are no longer available' using errcode = 'P0003';
  end if;

  q := public.quote_stay(p_window_id, p_check_in, p_check_out);
  select * into s from public.platform_settings;

  insert into public.bookings (
    listing_id, availability_window_id, owner_id, renter_id, check_in, check_out, guests, status,
    currency, nightly_rate_cents, cleaning_fee_cents, subtotal_cents, renter_total_cents,
    platform_fee_bps, platform_fee_cents, owner_payout_cents, cancellation_policy,
    stripe_payment_method_id, request_expires_at, renter_note
  ) values (
    l.id, w.id, l.owner_id, auth.uid(), p_check_in, p_check_out, p_guests, 'requested',
    s.currency, q.nightly_rate_cents, q.cleaning_fee_cents, q.subtotal_cents, q.renter_total_cents,
    q.platform_fee_bps, q.platform_fee_cents, q.owner_payout_cents, l.cancellation_policy,
    p_payment_method_id, now() + s.request_ttl, p_note
  ) returning * into b;
  return b;
end $$;

-- Owner accepts: opens the checkout hold. The exclusion constraint fires here if the dates
-- were taken by another accept in the meantime. The server then charges the renter.
create or replace function public.accept_booking(p_booking_id uuid)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare b public.bookings; s public.platform_settings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if b.owner_id <> auth.uid() and not public.is_service_role() then
    raise exception 'only the owner can accept' using errcode = '42501';
  end if;
  if b.status not in ('requested', 'payment_failed') then raise exception 'booking is not awaiting acceptance'; end if;
  if b.request_expires_at < now() then raise exception 'request has expired'; end if;
  select * into s from public.platform_settings;

  begin
    update public.bookings
       set status = 'accepting', accepted_at = coalesce(accepted_at, now()), hold_expires_at = now() + s.checkout_hold_ttl
     where id = b.id
     returning * into b;
  exception when exclusion_violation then
    raise exception 'those dates were just booked by someone else' using errcode = 'P0003';
  end;
  return b;
end $$;

create or replace function public.decline_booking(p_booking_id uuid, p_reason text default null)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if b.owner_id <> auth.uid() and not public.is_admin() and not public.is_service_role() then
    raise exception 'only the owner can decline' using errcode = '42501';
  end if;
  if b.status not in ('requested', 'payment_failed') then raise exception 'booking cannot be declined now'; end if;
  update public.bookings set status = 'declined', declined_at = now(), cancellation_reason = p_reason
   where id = b.id returning * into b;
  return b;
end $$;

-- Server-only: charge succeeded (payment_intent.succeeded webhook).
create or replace function public.mark_booking_confirmed(p_booking_id uuid, p_payment_intent_id text)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  if not public.is_service_role() then raise exception 'service role only' using errcode = '42501'; end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if b.status = 'confirmed' then return b; end if;                 -- idempotent
  if b.status <> 'accepting' then raise exception 'booking % is % not accepting', b.id, b.status; end if;
  update public.bookings
     set status = 'confirmed', confirmed_at = now(), hold_expires_at = null,
         stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id)
   where id = b.id returning * into b;

  -- Everyone else who asked for overlapping dates loses out.
  update public.bookings x
     set status = 'declined', declined_at = now(), cancellation_reason = 'dates booked by another guest'
   where x.listing_id = b.listing_id and x.id <> b.id
     and x.status in ('requested', 'payment_failed')
     and x.stay && b.stay;
  return b;
end $$;

-- Server-only: charge failed inside the hold window.
create or replace function public.mark_booking_payment_failed(p_booking_id uuid, p_reason text default null)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  if not public.is_service_role() then raise exception 'service role only' using errcode = '42501'; end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if b.status <> 'accepting' then return b; end if;
  update public.bookings set status = 'payment_failed', hold_expires_at = null, cancellation_reason = p_reason
   where id = b.id returning * into b;
  return b;
end $$;

-- Cancellation by either party or admin. Refund math is decided server-side from the policy;
-- this only records the state change. Returns the row so the server can compute refunds.
create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare b public.bookings; v_new public.booking_status;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if public.is_admin() or public.is_service_role() then v_new := 'cancelled_by_admin';
  elsif b.renter_id = auth.uid() then v_new := 'cancelled_by_renter';
  elsif b.owner_id = auth.uid() then v_new := 'cancelled_by_owner';
  else raise exception 'not a party to this booking' using errcode = '42501';
  end if;
  if b.status not in ('requested', 'payment_failed', 'confirmed') then
    raise exception 'booking cannot be cancelled in status %', b.status;
  end if;
  update public.bookings set status = v_new, cancelled_at = now(), cancellation_reason = p_reason, hold_expires_at = null
   where id = b.id returning * into b;
  return b;
end $$;

-- Cron: 48h expiry and stale checkout holds. Server-only.
create or replace function public.expire_stale_bookings()
returns table (expired_requests integer, released_holds integer)
language plpgsql security definer set search_path = public as $$
declare n1 integer; n2 integer;
begin
  if not public.is_service_role() then raise exception 'service role only' using errcode = '42501'; end if;
  with e as (
    update public.bookings set status = 'expired'
     where status in ('requested', 'payment_failed') and request_expires_at < now()
    returning 1
  ) select count(*) into n1 from e;
  with h as (
    update public.bookings set status = 'payment_failed', hold_expires_at = null,
           cancellation_reason = 'checkout hold expired'
     where status = 'accepting' and hold_expires_at < now()
    returning 1
  ) select count(*) into n2 from h;
  return query select n1, n2;
end $$;

-- Cron: advance confirmed → checked_in → completed by date. Server-only.
create or replace function public.advance_stays()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service_role() then raise exception 'service role only' using errcode = '42501'; end if;
  update public.bookings set status = 'checked_in', checked_in_at = now()
   where status = 'confirmed' and check_in <= current_date;
  update public.bookings set status = 'completed', completed_at = now()
   where status = 'checked_in' and check_out <= current_date;
end $$;
