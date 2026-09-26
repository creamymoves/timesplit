# Timesplit

Timeshare rental marketplace. Owners list weeks at their resort, renters request to book, the platform charges on acceptance and pays owners after check-in.

Stack: Next.js 14 (App Router, TypeScript) on Vercel, Supabase (Postgres, Auth, Storage, Realtime), Stripe Connect, Resend. Expo mobile apps will use the same Supabase RPCs later, so all business logic is in Postgres functions and server-only code.

## Documents

- [docs/money-flow.md](docs/money-flow.md): how money moves through Stripe. Charge, hold, fee, transfer, refund.
- [docs/architecture.md](docs/architecture.md): schema, roles, booking state machine, RLS matrix, buckets, cron.

## Local setup

```bash
npm install
cp .env.example .env.local           # fill in keys
npx supabase start                   # local Postgres, Auth, Storage, Studio
npx supabase db reset                # applies supabase/migrations/*.sql
npm run db:types                     # regenerate src/types/database.ts
npm run dev
```

Enable the JWT claims hook in `supabase/config.toml` once the stack is running, or via the dashboard for hosted projects:

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

Make yourself an admin from the SQL editor:

```sql
insert into public.user_roles (user_id, role) values ('<your auth user id>', 'admin');
```

## Schema tests without the Supabase CLI

Any Postgres 15+ works:

```bash
createdb timesplit_test
DATABASE_URL=postgresql://localhost/timesplit_test supabase/tests/run.sh
```

## Layout

```text
supabase/migrations/   0001 foundation · 0002 listings · 0003 verification · 0004 bookings
                       0005 money · 0006 messaging+audit · 0007 storage · 0008 rls
supabase/tests/        shim for auth/storage schemas, lifecycle test, runner
src/app/               pages, server actions, /auth/callback, /api/health, /api/cron/*
src/lib/supabase/      browser, server (RLS) and admin (service role) clients
src/lib/auth/roles.ts  getSessionUser, requireUser, requireRole, requireVerifiedOwner
src/middleware.ts      session refresh + claims-based route gating
src/lib/{stripe,email,env,cron}.ts
```

## Status

Phase 1 complete: scaffold, schema with RLS, auth and roles, money-flow design. Feature work (listings UI, booking flow, Stripe webhooks, admin queue, email) starts after review.
