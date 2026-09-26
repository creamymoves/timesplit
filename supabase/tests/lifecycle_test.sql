create schema if not exists test; grant usage on schema test to public; alter default privileges in schema test grant execute on functions to public;
-- Behavioural test of the schema. Run after shim + migrations on a scratch DB:
--   psql -d tsdev -v ON_ERROR_STOP=1 -f supabase/tests/lifecycle_test.sql
-- Uses request.jwt.* settings to impersonate users the way PostgREST does.
\set ON_ERROR_STOP on
begin;

-- helpers -------------------------------------------------------------------
create or replace function test.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function test.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;
create or replace function test.as_super() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end $$;
create or replace function test.b(n text) returns uuid language sql stable as $$ select current_setting('test.'||n)::uuid $$;
create or replace function test.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'expected error containing "%" but statement succeeded: %', needle, sql;
exception when others then
  if sqlerrm not ilike '%' || needle || '%' and sqlstate <> needle then
    raise exception 'expected error containing "%", got [%] %', needle, sqlstate, sqlerrm;
  end if;
end $$;

-- fixtures --------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.com',  '{"full_name":"Olive Owner"}'),
  ('00000000-0000-0000-0000-000000000002', 'renter@example.com', '{"full_name":"Rae Renter"}'),
  ('00000000-0000-0000-0000-000000000003', 'other@example.com',  '{"full_name":"Otto Other"}'),
  ('00000000-0000-0000-0000-000000000009', 'admin@example.com',  '{"full_name":"Ada Admin"}');

-- trigger provisioned profiles + renter role
do $$ begin
  assert (select count(*) from public.profiles) = 4, 'profiles created by trigger';
  assert (select count(*) from public.user_roles where role = 'renter') = 4, 'renter role granted';
end $$;

select test.as_service();
select public.grant_role('00000000-0000-0000-0000-000000000009', 'admin');

select test.as_user('00000000-0000-0000-0000-000000000001');
select public.become_owner();
do $$ begin assert public.has_role('owner'), 'owner role via become_owner'; end $$;

-- owner cannot publish before verification
select test.as_super();
insert into public.resorts (id, name, city, state, is_verified) values
  ('10000000-0000-0000-0000-000000000001', 'Marriott Grande Vista', 'Orlando', 'FL', true);
insert into public.listings (id, owner_id, resort_id, title, unit_type, sleeps, status) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '2BR villa, week 12', '2br', 8, 'draft');
select test.expect_error(
  $q$update public.listings set status = 'active' where id = '20000000-0000-0000-0000-000000000001'$q$,
  'owner must be verified');

-- verification flow
select test.as_user('00000000-0000-0000-0000-000000000001');
insert into public.owner_verifications (id, owner_id, ownership_doc_path, ownership_doc_type)
  values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
          'ownership-docs/00000000-0000-0000-0000-000000000001/deed.pdf', 'deed');
select test.expect_error(
  $q$select public.submit_owner_verification('30000000-0000-0000-0000-000000000001')$q$,
  'identity verification must be complete');
-- client may not flip identity_status themselves
select test.expect_error(
  $q$update public.owner_verifications set identity_status = 'verified' where id = '30000000-0000-0000-0000-000000000001'$q$,
  '42501');
select test.as_service();
update public.owner_verifications set identity_status = 'verified', identity_verified_at = now()
  where id = '30000000-0000-0000-0000-000000000001';
select test.as_user('00000000-0000-0000-0000-000000000001');
select public.submit_owner_verification('30000000-0000-0000-0000-000000000001');
-- non-admin cannot review
select test.expect_error(
  $q$select public.review_owner_verification('30000000-0000-0000-0000-000000000001', true)$q$, 'admin only');
select test.as_user('00000000-0000-0000-0000-000000000009');
select public.review_owner_verification('30000000-0000-0000-0000-000000000001', true);
do $$ begin
  assert (select owner_verification_status from public.profiles where id = '00000000-0000-0000-0000-000000000001') = 'approved',
    'profile status synced';
end $$;

-- publish + availability
select test.as_user('00000000-0000-0000-0000-000000000001');
update public.listings set status = 'active' where id = '20000000-0000-0000-0000-000000000001';
insert into public.availability_windows (id, listing_id, start_date, end_date, nightly_rate_cents, cleaning_fee_cents, min_nights)
  values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
          current_date + 30, current_date + 37, 25000, 15000, 3);
select test.expect_error(
  $q$insert into public.availability_windows (listing_id, start_date, end_date, nightly_rate_cents)
     values ('20000000-0000-0000-0000-000000000001', current_date + 33, current_date + 40, 20000)$q$,
  'aw_no_overlap');

-- quote: 7 nights * 250 + 150 cleaning = 1900.00; fee 10% = 190.00; owner 1710.00
do $$ declare q public.price_quote; begin
  q := public.quote_stay('40000000-0000-0000-0000-000000000001', current_date + 30, current_date + 37);
  assert q.subtotal_cents = 190000, format('subtotal %s', q.subtotal_cents);
  assert q.platform_fee_cents = 19000, format('fee %s', q.platform_fee_cents);
  assert q.owner_payout_cents = 171000, format('payout %s', q.owner_payout_cents);
  assert q.renter_total_cents = 190000, 'renter pays subtotal only';
end $$;

-- two renters request overlapping dates (allowed)
select test.as_user('00000000-0000-0000-0000-000000000002');
select id as b1 from public.request_booking('40000000-0000-0000-0000-000000000001', current_date + 30, current_date + 34, 2::smallint, 'pm_test_1') \gset
select set_config('test.b1', :'b1', false);
select test.as_user('00000000-0000-0000-0000-000000000003');
select id as b2 from public.request_booking('40000000-0000-0000-0000-000000000001', current_date + 32, current_date + 36, 2::smallint, 'pm_test_2') \gset
select set_config('test.b2', :'b2', false);

-- renter cannot see the other renter's request; owner sees both
do $$ begin
  assert (select count(*) from public.bookings) = 1, 'renter sees only own booking';
end $$;
select test.as_user('00000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.bookings) = 2, 'owner sees both requests';
  assert (select count(*) from public.conversations) = 2, 'conversation per booking';
end $$;

-- renter cannot accept; owner accepts b1 -> hold
select test.as_user('00000000-0000-0000-0000-000000000002');
select test.expect_error(format($q$select public.accept_booking(%L)$q$, test.b('b1')), 'only the owner');
select test.as_user('00000000-0000-0000-0000-000000000001');
select public.accept_booking(test.b('b1'));
do $$ begin
  assert (select status from public.bookings where id = test.b('b1')) = 'accepting', 'hold opened';
  assert (select hold_expires_at from public.bookings where id = test.b('b1')) > now(), 'hold expiry set';
end $$;
-- accepting the overlapping b2 while b1 is on hold is blocked by the exclusion constraint
select test.expect_error(format($q$select public.accept_booking(%L)$q$, test.b('b2')), 'just booked by someone else');

-- charge succeeds (webhook, service role) -> confirmed; b2 auto-declined; payout held; confirmation slot created
select test.as_user('00000000-0000-0000-0000-000000000001');
select test.expect_error(format($q$select public.mark_booking_confirmed(%L, 'pi_1')$q$, test.b('b1')), '42501');
select test.as_service();
select public.mark_booking_confirmed(test.b('b1'), 'pi_1');
do $$ begin
  assert (select status from public.bookings where id = test.b('b1')) = 'confirmed';
  assert (select status from public.bookings where id = test.b('b2')) = 'declined', 'overlapping request auto-declined';
  assert (select status from public.payouts where booking_id = test.b('b1')) = 'held', 'payout held';
  assert (select amount_cents from public.payouts where booking_id = test.b('b1')) = 103500, '4 nights*250+150 = 1150, minus 10% = 1035';
  assert (select status from public.resort_confirmations where booking_id = test.b('b1')) = 'missing';
  assert (select count(*) from public.booking_events where booking_id = test.b('b1')) = 3, 'requested->accepting->confirmed logged';
end $$;

-- direct writes to a confirmed booking are rejected even for service role (snapshot immutability)
select test.expect_error(format($q$update public.bookings set subtotal_cents = 1 where id = %L$q$, test.b('b1')), 'immutable');

-- a third overlapping confirmed booking can never be inserted, even bypassing RLS
select test.expect_error(format($q$
  insert into public.bookings (listing_id, owner_id, renter_id, check_in, check_out, status, nightly_rate_cents,
    subtotal_cents, renter_total_cents, platform_fee_bps, platform_fee_cents, owner_payout_cents, cancellation_policy, request_expires_at)
  values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003',
    current_date + 33, current_date + 35, 'confirmed', 1000, 2000, 2000, 1000, 200, 1800, 'moderate', now())$q$),
  'bookings_no_double_booking');

-- payout gate: not releasable before check-in nor without approved confirmation
do $$ begin assert (select count(*) from public.releasable_payouts) = 0, 'nothing releasable yet'; end $$;
select test.as_user('00000000-0000-0000-0000-000000000001');
select public.submit_resort_confirmation(test.b('b1'), 'resort-confirmations/o/b/c.pdf', 'MVC-123', 'Rae Renter');
select test.as_user('00000000-0000-0000-0000-000000000009');
select public.review_resort_confirmation(test.b('b1'), true);
select test.as_service();
do $$ begin assert (select count(*) from public.releasable_payouts) = 0, 'still gated on check-in'; end $$;
-- owner connects Stripe (account.updated webhook)
insert into public.stripe_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted)
  values ('00000000-0000-0000-0000-000000000001', 'acct_owner1', true, true, true);
do $$ begin assert (select count(*) from public.releasable_payouts) = 0, 'still gated on check-in even with Stripe connected'; end $$;
-- simulate time passing: check-in happened
update public.bookings set status = 'checked_in', checked_in_at = now() where id = test.b('b1');
update public.payouts set releasable_at = now() - interval '1 minute' where booking_id = test.b('b1');
do $$ begin assert (select count(*) from public.releasable_payouts) = 1, 'releasable after both gates'; end $$;
select public.mark_payouts_releasable();
select public.mark_payout_released((select id from public.payouts where booking_id = test.b('b1')), 'tr_1');
do $$ begin
  assert (select status from public.payouts where booking_id = test.b('b1')) = 'released';
  assert (select stripe_account_id from public.payouts where booking_id = test.b('b1')) = 'acct_owner1', 'account captured at release';
end $$;

-- renter can read own payment side but not the ledger
select test.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  assert (select count(*) from public.ledger_entries) = 0, 'ledger hidden from renter';
  assert (select count(*) from public.payouts) = 0, 'payouts hidden from renter';
  assert (select count(*) from public.resort_confirmations) = 1, 'renter sees own confirmation';
end $$;

-- expiry job
select test.as_user('00000000-0000-0000-0000-000000000003');
select id as b3 from public.request_booking('40000000-0000-0000-0000-000000000001', current_date + 34, current_date + 37, 1::smallint, 'pm_test_3') \gset
select set_config('test.b3', :'b3', false);
select test.as_super();
update public.bookings set request_expires_at = now() - interval '1 hour' where id = test.b('b3');
select test.as_service();
select * from public.expire_stale_bookings();
do $$ begin assert (select status from public.bookings where id = test.b('b3')) = 'expired'; end $$;

select test.as_super();
select 'ALL LIFECYCLE TESTS PASSED' as result;
rollback;
