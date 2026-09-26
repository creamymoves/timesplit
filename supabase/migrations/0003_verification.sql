-- 0003_verification.sql
-- Manual owner verification: ownership document + Stripe Identity, reviewed in an admin queue.
-- Stripe Connect account state for owners.

create table public.owner_verifications (
  id                          uuid primary key default gen_random_uuid(),
  owner_id                    uuid not null references public.profiles(id) on delete cascade,
  -- ownership evidence
  ownership_doc_path          text,       -- storage: `ownership-docs/<owner_id>/<uuid>.pdf`
  ownership_doc_type          text,       -- deed, points statement, maintenance fee bill, etc.
  resort_id                   uuid references public.resorts(id),
  ownership_doc_uploaded_at   timestamptz,
  -- identity
  stripe_identity_session_id  text unique,
  identity_status             public.identity_status not null default 'not_started',
  identity_verified_at        timestamptz,
  -- review
  status                      public.owner_verification_status not null default 'in_progress',
  submitted_at                timestamptz,
  reviewed_by                 uuid references public.profiles(id),
  reviewed_at                 timestamptz,
  rejection_reason            text,
  admin_notes                 text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
comment on table public.owner_verifications is 'One open verification attempt per owner; a rejection lets them open a new one.';
create unique index owner_verifications_one_open_idx on public.owner_verifications(owner_id)
  where status in ('in_progress', 'pending_review');
create index owner_verifications_queue_idx on public.owner_verifications(status, submitted_at);
create trigger owner_verifications_set_updated_at before update on public.owner_verifications
  for each row execute function public.set_updated_at();

-- Mirror the verification outcome onto the profile (denormalised for cheap RLS checks and JWT claims).
create or replace function public.sync_owner_verification_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set owner_verification_status = new.status
   where id = new.owner_id
     and owner_verification_status is distinct from new.status
     -- never downgrade an approved owner because of a stale attempt row
     and not (owner_verification_status = 'approved' and new.status <> 'approved');
  return new;
end $$;
create trigger owner_verifications_sync after insert or update of status on public.owner_verifications
  for each row execute function public.sync_owner_verification_status();

-- Owner submits for review once both pieces of evidence are in.
create or replace function public.submit_owner_verification(p_verification_id uuid)
returns public.owner_verifications
language plpgsql security definer set search_path = public as $$
declare v public.owner_verifications;
begin
  select * into v from public.owner_verifications where id = p_verification_id for update;
  if v.id is null or v.owner_id <> auth.uid() then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v.status <> 'in_progress' then
    raise exception 'verification is not editable';
  end if;
  if v.ownership_doc_path is null then
    raise exception 'ownership document required';
  end if;
  if v.identity_status <> 'verified' then
    raise exception 'identity verification must be complete';
  end if;
  update public.owner_verifications
     set status = 'pending_review', submitted_at = now()
   where id = v.id
   returning * into v;
  return v;
end $$;

-- Admin decision.
create or replace function public.review_owner_verification(
  p_verification_id uuid, p_approve boolean, p_reason text default null
) returns public.owner_verifications
language plpgsql security definer set search_path = public as $$
declare v public.owner_verifications;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into v from public.owner_verifications where id = p_verification_id for update;
  if v.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if v.status <> 'pending_review' then raise exception 'not pending review'; end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'rejection reason required';
  end if;
  update public.owner_verifications
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.owner_verification_status,
         reviewed_by = auth.uid(), reviewed_at = now(),
         rejection_reason = case when p_approve then null else p_reason end
   where id = v.id
   returning * into v;
  return v;
end $$;

-- Stripe Connect (Express) account per owner.
create table public.stripe_accounts (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  stripe_account_id  text not null unique,
  charges_enabled    boolean not null default false,
  payouts_enabled    boolean not null default false,
  details_submitted  boolean not null default false,
  requirements       jsonb not null default '{}'::jsonb,   -- raw account.requirements snapshot
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger stripe_accounts_set_updated_at before update on public.stripe_accounts
  for each row execute function public.set_updated_at();
