# Stripe money flow

Status: proposal for review before payments feature work begins.

## Decisions this flow implements

| Decision | How it shows up |
|---|---|
| Request-to-book, 48h owner acceptance | Card saved at request time, charged only when the owner accepts |
| Charge on acceptance | PaymentIntent created and confirmed inside a 15-minute checkout hold |
| Platform fee charged to owner only | Renter pays the listing price. Fee is deducted from the owner's transfer |
| Payouts held until check-in and gated on resort confirmation | Funds sit on the platform balance. Transfer created only after both gates pass |
| US only | Express connected accounts, USD, `country: 'US'` |

## Connect model: separate charges and transfers

The platform is the merchant of record. Every renter charge lands on the **platform** Stripe balance. Owner payouts are separate `Transfer` objects to the owner's **Express** connected account, created later and funded from the original charge via `source_transaction`.

Why not destination charges or manual capture:

- Destination charges move money to the owner immediately at capture. Holding until check-in would then require reversing transfers, which is fragile and confusing on the owner's dashboard.
- Manual capture authorisations expire after 7 days. Check-in is typically weeks or months after acceptance.
- Separate charges and transfers is the pattern Stripe documents for "hold funds until a service is delivered". It also lets the platform absorb refunds and disputes before any money has reached the owner.

Consequences to be aware of:

- The platform bears dispute liability and Stripe fees. Stripe processing fees come out of the platform's share, not the owner's.
- Platform payouts to the bank must not drain funds that are still owed to owners. Using `source_transaction` on each transfer ties it to the original charge's availability, so a low available balance does not block owner transfers. Keep the platform payout schedule at a delay of at least a few days, or manual, until this is proven in production.
- Because the platform is merchant of record, sales tax and lodging tax obligations are the platform's to work out. Out of scope for this phase, but the schema keeps `us_state` on profiles and resorts for it.

## Actors and objects

| Actor | Stripe object | Where stored |
|---|---|---|
| Renter | `Customer` plus saved `PaymentMethod` | `profiles.stripe_customer_id`, `bookings.stripe_payment_method_id` |
| Owner | Express connected `Account` | `stripe_accounts` |
| Owner identity | `Identity.VerificationSession` | `owner_verifications.stripe_identity_session_id` |
| Booking charge | `PaymentIntent` and its `Charge` | `payments` |
| Owner payout | `Transfer` | `payouts.stripe_transfer_id` |
| Refund | `Refund` | `refunds` |
| Every movement | | `ledger_entries` (append-only) |
| Webhook dedupe | `Event` | `stripe_events` |

## Timeline

### 1. Request (day 0)

1. Renter picks dates. Server calls `quote_stay()` for the price. The renter sees the total. No fee line for the renter.
2. Client collects a card through a `SetupIntent` on the platform account with `usage: 'off_session'`. This gives the platform permission to charge later without the renter present.
3. Server calls `request_booking()` with the payment method id. Booking is `requested` with `request_expires_at` set 48 hours out.
4. Nothing is charged. No authorisation is placed on the card.

### 2. Acceptance and charge (within 48h)

1. Owner accepts. Server calls `accept_booking()`. The row moves to `accepting` with a 15-minute `hold_expires_at`. The exclusion constraint on `bookings` fails this update if any other accepting or confirmed booking overlaps, so two owners' accepts can never both win.
2. Server creates and confirms a PaymentIntent on the **platform** account:

   ```text
   amount:               bookings.renter_total_cents
   currency:             usd
   customer:             renter's customer id
   payment_method:       bookings.stripe_payment_method_id
   off_session:          true
   confirm:              true
   transfer_group:       booking id
   metadata.booking_id:  booking id
   idempotency key:      "pi:" + booking id + ":" + attempt number
   ```

   No `transfer_data`, no `application_fee_amount`, no `on_behalf_of`. The full amount is a platform charge.

3. Outcomes:
   - `payment_intent.succeeded` webhook: server calls `mark_booking_confirmed()`. Booking is `confirmed`. Trigger creates a `payouts` row in `held` and an empty `resort_confirmations` row. All overlapping `requested` bookings on that listing are auto-declined. Ledger gets a `charge` entry for the full amount and a `platform_fee` entry for the fee.
   - `payment_intent.payment_failed` or `requires_action` (3DS off-session): server calls `mark_booking_payment_failed()`. Booking is `payment_failed`, hold released. Renter is emailed to update their card. Owner can re-accept once they do, as long as the 48h clock has not run out.
   - Hold expires with no webhook: the 10-minute cron calls `expire_stale_bookings()` which moves stale `accepting` rows to `payment_failed`.

### 3. Hold period (acceptance to check-in)

Money sits on the platform balance. The `payouts` row is `held` with `releasable_at = check_in + 24h`.

The owner must upload the resort's guest confirmation showing the renter's name via `submit_resort_confirmation()`. An admin approves it via `review_resort_confirmation()`. This is the fraud control: it proves the owner actually assigned their week to this renter.

### 4. Release (after check-in)

The hourly cron:

1. Calls `mark_payouts_releasable()`. The `releasable_payouts` view returns payouts where all of these hold:
   - `payouts.status = 'held'` and `releasable_at <= now()`
   - booking is `checked_in` or `completed`, so not cancelled or disputed
   - resort confirmation is `approved`
   - the owner has a `stripe_accounts` row with `payouts_enabled = true`
2. For each row, creates a Transfer on the platform account:

   ```text
   amount:              payouts.amount_cents   (= subtotal - platform fee)
   currency:            usd
   destination:         owner's acct_ id
   source_transaction:  the booking's ch_ id
   transfer_group:      booking id
   idempotency key:     "tr:" + payout id
   ```

3. Calls `mark_payout_released()` with the transfer id. Ledger gets a `transfer` entry.

Stripe then pays the owner's bank on the connected account's own payout schedule. The platform keeps `platform_fee_cents` minus Stripe's processing fee.

Worked example for a 7-night stay at $250 plus $150 cleaning:

| Line | Cents |
|---|---|
| Renter charged | 190,000 |
| Platform fee at 10% of subtotal | 19,000 |
| Transfer to owner | 171,000 |
| Stripe processing fee, roughly 2.9% + 30c, paid by platform | about 5,540 |
| Platform net | about 13,460 |

### 5. Refunds and cancellations

All refunds are `Refund` objects against the platform charge. Because nothing has been transferred before check-in, no owner clawback is needed for the common cases.

| Situation | Renter refund | Owner transfer | Platform fee |
|---|---|---|---|
| Owner declines or request expires | Never charged | None | None |
| Charge fails | Never charged | None | None |
| Renter cancels before check-in, per `cancellation_policy` | Policy-based partial or full | Owner keeps their share of any non-refunded amount, still released on the normal schedule | Charged on the non-refunded portion only |
| Owner cancels a confirmed booking | 100% | None. Payout row is `blocked` | Waived to renter. Owner cancellation penalties are a later policy decision |
| Admin cancels (fraud, no valid confirmation) | 100% | None. Payout `blocked` | Waived |
| Owner never uploads or confirmation rejected by check-in | 100% | None. Payout `blocked` | Waived |
| Dispute after release | Handled by Stripe on the platform charge | `transfers.createReversal` for the owner's share, recorded as `transfer_reversal`. Dispute fee is a platform cost | Kept only if the dispute is won |

Refund mechanics:

- `refunds.create` with `payment_intent`, `amount`, `reason`, `metadata.booking_id`, idempotency key `"re:" + refund row id`.
- Stripe does not return its processing fee on refunds. The platform eats it. This is a real cost of owner cancellations and is why owner cancellation penalties should be a follow-up decision.
- When a partial refund happens before release, the release step transfers `owner_payout_cents` recomputed on the non-refunded subtotal. The `payouts.amount_cents` snapshot is adjusted by the server at refund time and the change is written to the ledger as an `adjustment`.

### 6. Webhooks

Two endpoints, both verifying signatures and inserting into `stripe_events` first. A duplicate event id is a no-op.

Platform endpoint (`STRIPE_WEBHOOK_SECRET`):

- `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.requires_action`
- `charge.refunded`, `refund.updated`
- `charge.dispute.created`, `charge.dispute.closed`
- `transfer.created`, `transfer.reversed`
- `identity.verification_session.verified`, `identity.verification_session.requires_input`
- `setup_intent.succeeded`

Connect endpoint (`STRIPE_CONNECT_WEBHOOK_SECRET`):

- `account.updated` writes `charges_enabled`, `payouts_enabled`, `details_submitted`, `requirements` to `stripe_accounts`
- `payout.failed` on the connected account, for owner support

### 7. Owner onboarding

1. Owner opts in with `become_owner()`. Uploads an ownership document to the private `ownership-docs` bucket.
2. Server creates an `Identity.VerificationSession` (document plus selfie) and stores the id. The `verified` webhook sets `identity_status`.
3. Owner calls `submit_owner_verification()`. Admin approves. Only now can the owner publish a listing.
4. Separately, server creates an Express account (`type: 'express'`, `country: 'US'`, `capabilities: { transfers: { requested: true } }`) and sends the owner through an Account Link. Owners can list before finishing Stripe onboarding, but the payout release gate requires `payouts_enabled`.

## Open questions for review

1. Owner cancellation penalty. The flow above waives the fee and refunds the renter fully. Should the owner owe a penalty, and if so, how is it collected given the owner has never been charged?
2. Refund of the platform fee on renter-initiated cancellations. Above, the fee is charged only on the non-refunded portion. Alternative: keep the full fee whenever a charge occurred.
3. Release delay. Set to 24 hours after check-in in `platform_settings.payout_release_delay`. Longer gives renters time to report a no-show at the resort.
4. Whether admins must approve every resort confirmation or whether a first-pass auto-approve (name match) with spot checks is acceptable at volume.
