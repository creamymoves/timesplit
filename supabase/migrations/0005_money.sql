-- 0005_money.sql
-- Payments, payouts (held transfers), refunds, resort confirmations, ledger, Stripe event log.
-- See docs/money-flow.md for the narrative. All rows here are written by the server (service role)
-- from Stripe webhooks; clients read only.

-- One PaymentIntent per booking attempt (a booking can have several if a charge fails and retries).
create table public.payments (
  id                        uuid primary key default gen_random_uuid(),
  booking_id                uuid not null references public.bookings(id) on delete restrict,
  renter_id                 uuid not null references public.profiles(id),
  stripe_payment_intent_id  text not null unique,
  stripe_charge_id          text unique,
  stripe_customer_id        text,
  amount_cents              integer not null check (amount_cents > 0),
  amount_refunded_cents     integer not null default 0 check (amount_refunded_cents >= 0),
  currency                  char(3) not null default 'usd',
  status                    public.payment_status not null default 'processing',
  failure_code              text,
  failure_message           text,
  stripe_fee_cents          integer,            -- from balance_transaction, for margin reporting
  succeeded_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint payments_refund_chk check (amount_refunded_cents <= amount_cents)
);
create index payments_booking_idx on public.payments(booking_id);
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- Owner uploads the resort's guest confirmation showing the renter's name. Gates payout release.
create table public.resort_confirmations (
  id                     uuid primary key default gen_random_uuid(),
  booking_id             uuid not null unique references public.bookings(id) on delete cascade,
  owner_id               uuid not null references public.profiles(id),
  storage_path           text,                    -- `resort-confirmations/<owner_id>/<booking_id>/<uuid>.pdf`
  confirmation_number    text,
  guest_name_on_reservation text,
  status                 public.confirmation_status not null default 'missing',
  submitted_at           timestamptz,
  reviewed_by            uuid references public.profiles(id),
  reviewed_at            timestamptz,
  rejection_reason       text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index resort_confirmations_queue_idx on public.resort_confirmations(status, submitted_at);
create trigger resort_confirmations_set_updated_at before update on public.resort_confirmations
  for each row execute function public.set_updated_at();

-- One payout record per confirmed booking. Created when the booking is confirmed, in status 'held'.
create table public.payouts (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null unique references public.bookings(id) on delete restrict,
  owner_id              uuid not null references public.profiles(id),
  stripe_account_id     text,               -- filled at release time from stripe_accounts (owner may connect Stripe after confirmation)
  amount_cents          integer not null check (amount_cents >= 0),     -- owner_payout_cents at confirmation
  currency              char(3) not null default 'usd',
  status                public.payout_status not null default 'held',
  stripe_transfer_id    text unique,
  stripe_transfer_reversal_id text,
  releasable_at         timestamptz,       -- check_in + payout_release_delay
  released_at           timestamptz,
  reversed_at           timestamptz,
  blocked_reason        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index payouts_status_releasable_idx on public.payouts(status, releasable_at);
create index payouts_owner_idx on public.payouts(owner_id);
create trigger payouts_set_updated_at before update on public.payouts
  for each row execute function public.set_updated_at();

create table public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings(id) on delete restrict,
  payment_id         uuid not null references public.payments(id) on delete restrict,
  stripe_refund_id   text unique,
  amount_cents       integer not null check (amount_cents > 0),
  currency           char(3) not null default 'usd',
  reason             text not null,            -- renter_cancel_flexible, owner_cancel, admin, dispute, ...
  status             public.refund_status not null default 'pending',
  initiated_by       uuid references public.profiles(id),   -- null = system
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index refunds_booking_idx on public.refunds(booking_id);
create trigger refunds_set_updated_at before update on public.refunds
  for each row execute function public.set_updated_at();

-- Append-only ledger of every money movement, in platform-balance terms.
-- Positive = money into platform balance, negative = out.
create table public.ledger_entries (
  id                bigint generated always as identity primary key,
  booking_id        uuid references public.bookings(id) on delete restrict,
  user_id           uuid references public.profiles(id),   -- counterparty where relevant
  kind              public.ledger_kind not null,
  amount_cents      integer not null,
  currency          char(3) not null default 'usd',
  stripe_object_id  text,                                   -- ch_, tr_, re_, dp_, trr_
  stripe_event_id   text,
  memo              text,
  created_at        timestamptz not null default now()
);
create index ledger_booking_idx on public.ledger_entries(booking_id, created_at);
create unique index ledger_dedupe_idx on public.ledger_entries(kind, stripe_object_id) where stripe_object_id is not null;

-- Idempotency for Stripe webhooks: insert event id first; if it already exists, skip.
create table public.stripe_events (
  id            text primary key,          -- evt_...
  type          text not null,
  account_id    text,                      -- connected account id for Connect events
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);
create index stripe_events_unprocessed_idx on public.stripe_events(received_at) where processed_at is null;

-- Ledger/booking rows must never be edited or deleted by anyone but service role, and even then not deleted.
create or replace function public.forbid_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% rows are append-only', tg_table_name;
end $$;
create trigger ledger_append_only before update or delete on public.ledger_entries
  for each row execute function public.forbid_mutation();
create trigger booking_events_append_only before update or delete on public.booking_events
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Payout gating
-- ---------------------------------------------------------------------------

-- Create the held payout + empty confirmation slot when a booking is confirmed.
create or replace function public.on_booking_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.platform_settings;
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    select * into s from public.platform_settings;
    insert into public.payouts (booking_id, owner_id, amount_cents, currency, releasable_at)
    values (new.id, new.owner_id, new.owner_payout_cents, new.currency,
            (new.check_in::timestamp at time zone 'UTC') + s.payout_release_delay)
    on conflict (booking_id) do nothing;
    insert into public.resort_confirmations (booking_id, owner_id)
    values (new.id, new.owner_id) on conflict (booking_id) do nothing;
  end if;
  return new;
end $$;
create trigger bookings_on_confirmed after update of status on public.bookings
  for each row execute function public.on_booking_confirmed();

-- Owner submits the resort confirmation (file already uploaded to storage).
create or replace function public.submit_resort_confirmation(
  p_booking_id uuid, p_storage_path text, p_confirmation_number text, p_guest_name text
) returns public.resort_confirmations
language plpgsql security definer set search_path = public as $$
declare rc public.resort_confirmations; b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id;
  if b.id is null or b.owner_id <> auth.uid() then raise exception 'not found' using errcode = 'P0002'; end if;
  if b.status not in ('confirmed', 'checked_in', 'completed') then
    raise exception 'booking is not confirmed';
  end if;
  update public.resort_confirmations
     set storage_path = p_storage_path, confirmation_number = p_confirmation_number,
         guest_name_on_reservation = p_guest_name, status = 'submitted', submitted_at = now(),
         rejection_reason = null
   where booking_id = p_booking_id and status in ('missing', 'rejected')
   returning * into rc;
  if rc.id is null then raise exception 'confirmation already submitted'; end if;
  return rc;
end $$;

-- Admin approves/rejects the confirmation.
create or replace function public.review_resort_confirmation(p_booking_id uuid, p_approve boolean, p_reason text default null)
returns public.resort_confirmations
language plpgsql security definer set search_path = public as $$
declare rc public.resort_confirmations;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.resort_confirmations
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.confirmation_status,
         reviewed_by = auth.uid(), reviewed_at = now(),
         rejection_reason = case when p_approve then null else coalesce(p_reason, 'rejected') end
   where booking_id = p_booking_id and status = 'submitted'
   returning * into rc;
  if rc.id is null then raise exception 'no submitted confirmation for booking'; end if;
  return rc;
end $$;

-- Which held payouts may be transferred now? Both gates must pass:
--   1. renter has checked in (check_in + delay has passed, booking not cancelled/disputed)
--   2. resort confirmation in the renter's name approved by admin
--   3. owner has a Connect account that can receive transfers
create or replace view public.releasable_payouts as
select p.*, sa.stripe_account_id as live_stripe_account_id
from public.payouts p
join public.bookings b on b.id = p.booking_id
join public.resort_confirmations rc on rc.booking_id = b.id
join public.stripe_accounts sa on sa.user_id = p.owner_id and sa.payouts_enabled
where p.status = 'held'
  and p.releasable_at <= now()
  and b.status in ('checked_in', 'completed')
  and rc.status = 'approved';

-- Server-only: mark payouts releasable (cron), then the server creates the Stripe transfer
-- and calls mark_payout_released.
create or replace function public.mark_payouts_releasable()
returns setof public.payouts
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service_role() then raise exception 'service role only' using errcode = '42501'; end if;
  return query
    update public.payouts p set status = 'releasable', stripe_account_id = r.live_stripe_account_id
      from public.releasable_payouts r
     where p.id = r.id
    returning p.*;
end $$;

create or replace function public.mark_payout_released(p_payout_id uuid, p_transfer_id text)
returns public.payouts
language plpgsql security definer set search_path = public as $$
declare p public.payouts;
begin
  if not public.is_service_role() then raise exception 'service role only' using errcode = '42501'; end if;
  update public.payouts set status = 'released', stripe_transfer_id = p_transfer_id, released_at = now()
   where id = p_payout_id and status in ('releasable', 'held')
   returning * into p;
  return p;
end $$;

create or replace function public.block_payout(p_payout_id uuid, p_reason text)
returns public.payouts
language plpgsql security definer set search_path = public as $$
declare p public.payouts;
begin
  if not (public.is_admin() or public.is_service_role()) then raise exception 'admin only' using errcode = '42501'; end if;
  update public.payouts set status = 'blocked', blocked_reason = p_reason
   where id = p_payout_id and status in ('held', 'releasable')
   returning * into p;
  return p;
end $$;
