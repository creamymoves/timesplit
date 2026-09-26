-- 0008_rls.sql
-- Row-level security for every table, plus function grants.
-- Principles:
--   * Default deny. The service role bypasses RLS and is the only writer for money/state tables.
--   * Clients read their own rows; admins read everything.
--   * State transitions go through the SECURITY DEFINER functions in 0003–0005, never direct UPDATEs.
--   * A user can be renter and owner at once; policies test the row, not the role, where possible.

alter table public.profiles              enable row level security;
alter table public.user_roles            enable row level security;
alter table public.resorts               enable row level security;
alter table public.listings              enable row level security;
alter table public.availability_windows  enable row level security;
alter table public.listing_photos        enable row level security;
alter table public.owner_verifications   enable row level security;
alter table public.stripe_accounts       enable row level security;
alter table public.platform_settings     enable row level security;
alter table public.bookings              enable row level security;
alter table public.booking_events        enable row level security;
alter table public.payments              enable row level security;
alter table public.resort_confirmations  enable row level security;
alter table public.payouts               enable row level security;
alter table public.refunds               enable row level security;
alter table public.ledger_entries        enable row level security;
alter table public.stripe_events         enable row level security;
alter table public.conversations         enable row level security;
alter table public.messages              enable row level security;
alter table public.notifications         enable row level security;
alter table public.audit_log             enable row level security;

-- Public-safe projection of a profile for showing counterparties (no email/phone).
create or replace view public.public_profiles
  with (security_invoker = false) as
  select id, full_name, avatar_path, owner_verification_status, created_at
  from public.profiles;
grant select on public.public_profiles to anon, authenticated;

-- profiles -------------------------------------------------------------------
create policy "profiles: self read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "profiles: self update" on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- clients cannot flip verification or Stripe ids
    and owner_verification_status = (select p.owner_verification_status from public.profiles p where p.id = auth.uid())
    and stripe_customer_id is not distinct from (select p.stripe_customer_id from public.profiles p where p.id = auth.uid())
  );
-- inserts happen only via the auth trigger (security definer); no client insert/delete policy.

-- user_roles -----------------------------------------------------------------
create policy "roles: self read" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- writes only via become_owner()/grant_role()/revoke_role().

-- resorts --------------------------------------------------------------------
create policy "resorts: public read" on public.resorts for select using (true);
create policy "resorts: verified owners propose" on public.resorts for insert to authenticated
  with check (public.is_verified_owner() and is_verified = false and created_by = auth.uid());
create policy "resorts: admin write" on public.resorts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "resorts: admin delete" on public.resorts for delete to authenticated using (public.is_admin());

-- listings -------------------------------------------------------------------
create policy "listings: public read active" on public.listings for select
  using (status = 'active' or owner_id = auth.uid() or public.is_admin());
create policy "listings: owner insert" on public.listings for insert to authenticated
  with check (owner_id = auth.uid() and public.has_role('owner') and status in ('draft', 'active'));
create policy "listings: owner update" on public.listings for update to authenticated
  using (owner_id = auth.uid() and status <> 'removed_by_admin')
  with check (owner_id = auth.uid() and status <> 'removed_by_admin' and admin_notes is not distinct from (select l.admin_notes from public.listings l where l.id = id));
create policy "listings: admin update" on public.listings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "listings: owner delete drafts" on public.listings for delete to authenticated
  using ((owner_id = auth.uid() and status = 'draft') or public.is_admin());

-- availability_windows -------------------------------------------------------
create policy "windows: read with listing" on public.availability_windows for select
  using (exists (
    select 1 from public.listings l where l.id = listing_id
      and (l.status = 'active' or l.owner_id = auth.uid() or public.is_admin())
  ));
create policy "windows: owner write" on public.availability_windows for all to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy "windows: admin write" on public.availability_windows for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- listing_photos -------------------------------------------------------------
create policy "photos: read with listing" on public.listing_photos for select
  using (exists (
    select 1 from public.listings l where l.id = listing_id
      and (l.status = 'active' or l.owner_id = auth.uid() or public.is_admin())
  ));
create policy "photos: owner write" on public.listing_photos for all to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy "photos: admin delete" on public.listing_photos for delete to authenticated using (public.is_admin());

-- owner_verifications --------------------------------------------------------
create policy "verifications: owner read" on public.owner_verifications for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
create policy "verifications: owner open" on public.owner_verifications for insert to authenticated
  with check (owner_id = auth.uid() and public.has_role('owner') and status = 'in_progress');
create policy "verifications: owner edit in progress" on public.owner_verifications for update to authenticated
  using (owner_id = auth.uid() and status = 'in_progress')
  with check (
    owner_id = auth.uid() and status = 'in_progress'
    -- identity + review columns are server/admin controlled
    and identity_status = (select v.identity_status from public.owner_verifications v where v.id = id)
    and stripe_identity_session_id is not distinct from (select v.stripe_identity_session_id from public.owner_verifications v where v.id = id)
    and reviewed_by is null and admin_notes is null
  );
-- submit/review via functions; admin notes via service role or function.

-- stripe_accounts ------------------------------------------------------------
create policy "stripe accounts: owner read" on public.stripe_accounts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- written only by server (Connect onboarding + account.updated webhook).

-- platform_settings ----------------------------------------------------------
create policy "settings: read fee" on public.platform_settings for select to authenticated using (true);
create policy "settings: admin update" on public.platform_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- bookings -------------------------------------------------------------------
create policy "bookings: parties read" on public.bookings for select to authenticated
  using (renter_id = auth.uid() or owner_id = auth.uid() or public.is_admin());
-- no insert/update/delete policies: request_booking()/accept_booking()/... only.

create policy "booking events: parties read" on public.booking_events for select to authenticated
  using (exists (
    select 1 from public.bookings b where b.id = booking_id
      and (b.renter_id = auth.uid() or b.owner_id = auth.uid() or public.is_admin())
  ));

-- money ----------------------------------------------------------------------
create policy "payments: renter reads own" on public.payments for select to authenticated
  using (renter_id = auth.uid() or public.is_admin());
create policy "payouts: owner reads own" on public.payouts for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
create policy "refunds: parties read" on public.refunds for select to authenticated
  using (exists (
    select 1 from public.bookings b where b.id = booking_id
      and (b.renter_id = auth.uid() or b.owner_id = auth.uid() or public.is_admin())
  ));
create policy "ledger: admin read" on public.ledger_entries for select to authenticated using (public.is_admin());
create policy "stripe events: admin read" on public.stripe_events for select to authenticated using (public.is_admin());

create policy "confirmations: parties read" on public.resort_confirmations for select to authenticated
  using (owner_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.bookings b where b.id = booking_id and b.renter_id = auth.uid()));
-- writes via submit_resort_confirmation()/review_resort_confirmation().

-- messaging ------------------------------------------------------------------
create policy "conversations: parties read" on public.conversations for select to authenticated
  using (owner_id = auth.uid() or renter_id = auth.uid() or public.is_admin());
create policy "messages: parties read" on public.messages for select to authenticated
  using (exists (
    select 1 from public.conversations c where c.id = conversation_id
      and (c.owner_id = auth.uid() or c.renter_id = auth.uid() or public.is_admin())
  ));
create policy "messages: parties send" on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c join public.bookings b on b.id = c.booking_id
      where c.id = conversation_id
        and (c.owner_id = auth.uid() or c.renter_id = auth.uid())
        and b.status not in ('expired', 'declined')     -- no messaging on dead requests
    )
  );
create policy "messages: recipient marks read" on public.messages for update to authenticated
  using (sender_id <> auth.uid() and exists (
    select 1 from public.conversations c where c.id = conversation_id
      and (c.owner_id = auth.uid() or c.renter_id = auth.uid())))
  with check (sender_id <> auth.uid());

-- notifications --------------------------------------------------------------
create policy "notifications: own read" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notifications: own mark read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit ----------------------------------------------------------------------
create policy "audit: admin read" on public.audit_log for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Function grants. Default: everything callable by authenticated; then revoke the
-- server-only transitions so a client can't call them even though they check role.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.has_role(public.app_role), public.is_admin(), public.is_verified_owner(),
  public.become_owner(), public.grant_role(uuid, public.app_role), public.revoke_role(uuid, public.app_role),
  public.quote_stay(uuid, date, date),
  public.request_booking(uuid, date, date, smallint, text, text),
  public.accept_booking(uuid), public.decline_booking(uuid, text), public.cancel_booking(uuid, text),
  public.submit_owner_verification(uuid), public.review_owner_verification(uuid, boolean, text),
  public.submit_resort_confirmation(uuid, text, text, text), public.review_resort_confirmation(uuid, boolean, text),
  public.block_payout(uuid, text)
to authenticated;
grant execute on function public.quote_stay(uuid, date, date) to anon;   -- price display before login

revoke execute on function
  public.mark_booking_confirmed(uuid, text), public.mark_booking_payment_failed(uuid, text),
  public.expire_stale_bookings(), public.advance_stays(),
  public.mark_payouts_releasable(), public.mark_payout_released(uuid, text)
from authenticated, anon, public;
grant execute on all functions in schema public to service_role;

-- Default privileges for future objects: keep anon out.
alter default privileges in schema public revoke execute on functions from public;
