-- 0006_messaging_audit.sql
-- Booking-scoped messaging (realtime), notifications (in-app + Resend email), admin audit log.

create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null unique references public.bookings(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id),
  renter_id   uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create or replace function public.create_conversation_for_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.conversations (booking_id, owner_id, renter_id)
  values (new.id, new.owner_id, new.renter_id) on conflict do nothing;
  return new;
end $$;
create trigger bookings_create_conversation after insert on public.bookings
  for each row execute function public.create_conversation_for_booking();

create table public.messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid not null references public.profiles(id),
  body             text not null check (length(body) between 1 and 4000),
  created_at       timestamptz not null default now(),
  read_at          timestamptz
);
create index messages_conversation_idx on public.messages(conversation_id, created_at);

create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,                 -- booking.requested, booking.accepted, payout.released, ...
  title       text not null,
  body        text,
  data        jsonb not null default '{}'::jsonb,
  channels    public.notification_channel[] not null default '{in_app,email}',
  read_at     timestamptz,
  emailed_at  timestamptz,
  email_provider_id text,                    -- Resend message id
  created_at  timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;
create index notifications_email_pending_idx on public.notifications(created_at)
  where emailed_at is null and 'email' = any (channels);

-- Everything an admin does, plus sensitive system actions.
create table public.audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles(id),
  actor_role   text,
  action       text not null,                -- e.g. verification.approve, payout.block, listing.remove
  entity_type  text not null,
  entity_id    text not null,
  before       jsonb,
  after        jsonb,
  ip           inet,
  created_at   timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log(entity_type, entity_id, created_at);
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.forbid_mutation();

-- Realtime: clients subscribe to their own bookings, messages and notifications (RLS-filtered).
alter publication supabase_realtime add table public.bookings, public.messages, public.notifications;
