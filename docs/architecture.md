# Architecture and schema overview

## Shape

```text
Next.js (Vercel)            Supabase                     Stripe / Resend
┌──────────────────┐        ┌──────────────────────┐     ┌────────────────┐
│ App Router pages │  RLS   │ Postgres             │     │ Connect        │
│ Server Actions   │◄──────►│  tables + policies   │     │ Identity       │
│ Route handlers   │        │  SECURITY DEFINER fns│◄────│ webhooks       │
│  /api/webhooks   │ svc    │ Auth (magic link)    │     └────────────────┘
│  /api/cron       │ role   │ Storage (4 buckets)  │     ┌────────────────┐
│ middleware       │        │ Realtime             │     │ Resend email   │
└──────────────────┘        └──────────────────────┘     └────────────────┘
        ▲
        │ same Supabase client + same RPCs
   Expo apps (later)
```

All business rules live in Postgres functions or in server-only Next.js code. Web and Expo clients call the same RPCs through supabase-js. Nothing about pricing, state transitions, or authorisation is duplicated in the UI layer.

## Roles

- `user_roles` allows several roles per user. Every new auth user gets `renter`. Anyone can call `become_owner()`. `admin` is only granted by an existing admin or the service role.
- Roles are copied into the JWT (`app_roles`, `owner_status`) by `custom_access_token_hook` for UI and middleware. RLS never trusts the claims. It calls `has_role()`, which reads the table.
- Owner verification status is denormalised on `profiles` and kept in sync by trigger from `owner_verifications`.

## Tables by domain

| Domain | Tables |
|---|---|
| Identity | `profiles`, `user_roles`, `owner_verifications`, `stripe_accounts` |
| Inventory | `resorts`, `listings`, `availability_windows`, `listing_photos` |
| Booking | `platform_settings`, `bookings`, `booking_events` |
| Money | `payments`, `payouts`, `refunds`, `resort_confirmations`, `ledger_entries`, `stripe_events` |
| Comms | `conversations`, `messages`, `notifications` |
| Ops | `audit_log` |

## Booking state machine

```text
requested ──accept──► accepting ──charge ok──► confirmed ──date──► checked_in ──date──► completed
   │                     │                        │
   │ 48h                 │ fail / 15 min          │ cancel
   ▼                     ▼                        ▼
expired             payment_failed ──re-accept──►(accepting)   cancelled_by_{renter,owner,admin}
   ▲                     │
   └──── 48h ────────────┘
declined (owner, or automatic when an overlapping booking confirms)
```

Overlap protection is two layers:

1. `bookings_no_double_booking` exclusion constraint on `(listing_id, stay)` for rows in `accepting`, `confirmed`, `checked_in`, `completed`. This is the guarantee.
2. The `accepting` status is the short checkout hold. It claims the dates under the constraint for 15 minutes while the card is charged, then either becomes `confirmed` or drops back to `payment_failed` and stops blocking.

Overlapping `requested` rows are allowed on purpose. Owners see competing requests and pick one. The rest are auto-declined when one confirms.

## Row-level security summary

| Table | anon | renter | owner | admin |
|---|---|---|---|---|
| profiles | via `public_profiles` view (name, avatar, status) | own row read/update | same | read all |
| resorts | read | read | read, propose unverified | full |
| listings | read active | read active | own rows full, publish gated on verification | full |
| availability_windows, listing_photos | with active listing | same | own listing full | full |
| owner_verifications | | | own rows, editable while in progress | read, review via fn |
| bookings | | own as renter, read only | own as owner, read only | read all |
| payments | | own | | read all |
| payouts | | | own | read all, block via fn |
| refunds, resort_confirmations | | on own bookings | on own bookings | read all |
| ledger_entries, stripe_events, audit_log | | | | read |
| messages | | send/read on own bookings | same | read all |
| notifications | | own | own | own |

All writes to `bookings`, `payments`, `payouts`, `refunds`, `ledger_entries` come from the service role or from `SECURITY DEFINER` functions. Server-only functions have execute revoked from `authenticated`, so a client cannot call `mark_booking_confirmed()` even though the function also checks the role.

## Storage buckets

| Bucket | Public | Write | Read |
|---|---|---|---|
| `listing-photos` | yes | owner, own folder | everyone |
| `avatars` | yes | user, own folder | everyone |
| `ownership-docs` | no | owner, own folder | owner, admin |
| `resort-confirmations` | no | owner, `<owner>/<booking>/` | owner, that booking's renter, admin |

## Background jobs (Vercel Cron)

| Path | Schedule | Calls |
|---|---|---|
| `/api/cron/expire-requests` | every 10 min | `expire_stale_bookings()`, `advance_stays()` |
| `/api/cron/release-payouts` | hourly | `mark_payouts_releasable()`, Stripe transfer, `mark_payout_released()` |

## Testing the schema

`supabase/tests/run.sh` applies a shim for the Supabase-managed `auth` and `storage` schemas, runs every migration, then runs `lifecycle_test.sql`, which impersonates users through `request.jwt.*` settings the way PostgREST does. It covers role provisioning, the verification gate on publishing, quoting, overlapping requests, the checkout hold, the exclusion constraint, auto-decline, snapshot immutability, RLS visibility, the payout gate, and request expiry. CI runs it against Postgres 15.
