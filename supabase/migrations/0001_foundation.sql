-- 0001_foundation.sql
-- Extensions, enums, shared helpers, profiles, roles, auth hooks.
-- Conventions:
--   * All money is integer cents in USD.
--   * All timestamps are timestamptz; dates of stay are `date` (resort-local calendar days).
--   * Every table has RLS enabled (policies live in 0008_rls.sql).
--   * Business state transitions happen only through SECURITY DEFINER functions or the
--     service role (server API). Clients never UPDATE money/booking state directly.

-- helper functions reference tables created later in this file
set check_function_bodies = off;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;   -- needed for the booking exclusion constraint
create extension if not exists citext;
create extension if not exists pg_trgm;      -- resort/listing search

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('renter', 'owner', 'admin');

create type public.owner_verification_status as enum (
  'not_started',   -- has owner role but has not begun verification
  'in_progress',   -- documents/identity being collected
  'pending_review',-- everything submitted, waiting in admin queue
  'approved',
  'rejected'
);

create type public.identity_status as enum ('not_started', 'requires_input', 'processing', 'verified', 'canceled');

create type public.unit_type as enum ('studio', '1br', '2br', '3br', '4br', 'lockoff', 'other');

create type public.listing_status as enum ('draft', 'active', 'paused', 'archived', 'removed_by_admin');

create type public.cancellation_policy as enum ('flexible', 'moderate', 'strict', 'non_refundable');

create type public.booking_status as enum (
  'requested',        -- renter submitted; owner has 48h to accept
  'accepting',        -- owner accepted; short checkout hold while renter's card is charged
  'payment_failed',   -- charge failed inside hold window; renter may retry until request_expires_at
  'confirmed',        -- charge succeeded; dates are locked
  'declined',         -- owner declined
  'expired',          -- 48h passed without acceptance
  'cancelled_by_renter',
  'cancelled_by_owner',
  'cancelled_by_admin',
  'checked_in',
  'completed',
  'disputed'
);

create type public.payment_status as enum ('requires_action', 'processing', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded');

create type public.payout_status as enum (
  'held',        -- funds on platform balance; waiting for check-in + confirmation
  'releasable',  -- all gates passed; transfer will be created
  'released',    -- transfer created on Stripe
  'reversed',    -- transfer reversed (refund/dispute after release)
  'blocked'      -- admin hold (dispute, fraud, failed confirmation)
);

create type public.refund_status as enum ('pending', 'succeeded', 'failed', 'canceled');

create type public.confirmation_status as enum ('missing', 'submitted', 'approved', 'rejected');

create type public.ledger_kind as enum (
  'charge', 'platform_fee', 'transfer', 'transfer_reversal', 'refund', 'dispute', 'dispute_reversal', 'adjustment'
);

create type public.notification_channel as enum ('in_app', 'email', 'push');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Role helpers are SECURITY DEFINER so they can be used inside RLS policies
-- on user_roles itself without recursion.
create or replace function public.has_role(p_role public.app_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = p_role
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('admin');
$$;

create or replace function public.is_verified_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.owner_verification_status = 'approved'
  ) and public.has_role('owner');
$$;

-- True when the request is made with the service_role key (server API / webhooks).
create or replace function public.is_service_role()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

-- ---------------------------------------------------------------------------
-- Profiles & roles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                          uuid primary key references auth.users(id) on delete cascade,
  email                       citext not null,
  full_name                   text,
  phone                       text,
  avatar_path                 text,                 -- storage path in `avatars` bucket
  owner_verification_status   public.owner_verification_status not null default 'not_started',
  stripe_customer_id          text unique,          -- renter side (charges)
  us_state                    char(2),              -- US only; used for tax/disclosure later
  terms_accepted_at           timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint profiles_us_state_chk check (us_state is null or us_state ~ '^[A-Z]{2}$')
);
comment on table public.profiles is 'One row per auth user. Public-safe fields only; PII kept minimal.';

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.user_roles (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        public.app_role not null,
  granted_by  uuid references public.profiles(id),
  granted_at  timestamptz not null default now(),
  primary key (user_id, role)
);
comment on table public.user_roles is 'A user may hold several roles (e.g. renter + owner). admin is only granted via service role.';

create index user_roles_role_idx on public.user_roles(role);

-- Auto-provision profile + renter role when an auth user is created.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_path)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    null
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role) values (new.id, 'renter')
  on conflict do nothing;

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profile email in sync if the auth email changes.
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- Self-service: any authenticated user can opt in to the owner role.
-- Verification (docs + Stripe Identity + admin approval) is a separate gate.
create or replace function public.become_owner()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.user_roles (user_id, role) values (auth.uid(), 'owner')
  on conflict do nothing;
end $$;

-- Admin grant/revoke. Callable by admins; also by service role.
create or replace function public.grant_role(p_user_id uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_service_role()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  insert into public.user_roles (user_id, role, granted_by) values (p_user_id, p_role, auth.uid())
  on conflict do nothing;
end $$;

create or replace function public.revoke_role(p_user_id uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_service_role()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_role = 'renter' then
    raise exception 'renter role cannot be revoked';
  end if;
  delete from public.user_roles where user_id = p_user_id and role = p_role;
end $$;

-- ---------------------------------------------------------------------------
-- Custom access token hook: put roles + owner status into the JWT so web and
-- Expo clients can render role-aware UI without a round trip. RLS never trusts
-- these claims; it always re-reads user_roles/profiles via has_role().
-- Enable in supabase/config.toml:
--   [auth.hook.custom_access_token]
--   enabled = true
--   uri = "pg-functions://postgres/public/custom_access_token_hook"
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_roles   jsonb;
  v_status  public.owner_verification_status;
  v_claims  jsonb := coalesce(event -> 'claims', '{}'::jsonb);
begin
  select coalesce(jsonb_agg(role order by role), '[]'::jsonb) into v_roles
  from public.user_roles where user_id = v_user_id;

  select owner_verification_status into v_status from public.profiles where id = v_user_id;

  v_claims := jsonb_set(v_claims, '{app_roles}', v_roles, true);
  v_claims := jsonb_set(v_claims, '{owner_status}', to_jsonb(coalesce(v_status::text, 'not_started')), true);

  return jsonb_set(event, '{claims}', v_claims, true);
end $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant select on public.user_roles, public.profiles to supabase_auth_admin;
