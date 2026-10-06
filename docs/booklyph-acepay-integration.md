# BooklyPH × AcePay integration guide

How BooklyPH takes payments for coaching sessions and gets money to its coaches, using AcePay.

> **Who this is for:** the BooklyPH backend developers.
> **Status:** AcePay's side is built (Slice 6). Nothing on the BooklyPH side exists yet. This guide is
> the contract to build against.

---

## 1. The big picture

A student pays for a session. Most of the money goes to the coach and a small platform fee goes to us.
BooklyPH only ever talks to AcePay. It never talks to Xendit directly, and coaches never see Xendit at all.

```
Student pays ₱500 for a session with Coach Juan
        │
        ▼
BooklyPH backend ──POST /v1/payments──► AcePay ──► Xendit checkout (GCash, Maya, cards…)
        │                                              │ student pays
        │                                              ▼
        │                              Xendit splits the payment automatically:
        │                                ₱50 (10%) → platform
        │                                ₱450      → Coach Juan's own balance
        │                                              │
        ◄──── webhook "payment.succeeded" ──── AcePay ◄┘
        │
        ▼  (once or twice a week, the AcePay operator clicks "Pay all coaches")
Coach Juan's GCash / bank ◄── payout ── AcePay
        │
        ◄──── webhook "merchant.payout_sent" ──── AcePay
```

A few words used throughout:

| Word | Meaning |
|---|---|
| **Merchant** | AcePay's name for a coach. Each coach is one merchant with its own Xendit balance (a "sub-account"). |
| **Platform fee** | BooklyPH's cut of each payment (e.g. **10%**). It is **set in AcePay** and can change: BooklyPH adopts AcePay's rate (see *The fee is set in AcePay* below). BooklyPH sets no per-coach overrides: its own books assume every coach pays the app rate. |
| **Payout** | Money sent from a coach's balance to their GCash or bank. The AcePay operator triggers these by hand, once or twice a week. Nothing is paid out automatically. |
| **Minor units** | All amounts are in **centavos**, as whole numbers. ₱500.00 is `50000`. |

---

## 2. What the money looks like on a ₱500 session

| | Amount |
|---|---|
| Student pays | ₱500.00 |
| Platform fee (10%) | −₱50.00 |
| Xendit's payment fee, paid by the coach (about 3.2% + ₱11 for GCash; varies by method) | about −₱27 |
| Stays in the coach's balance | about ₱423 |
| Xendit's payout fee, paid by the coach once per payout, not per session | about −₱15 to ₱25 |

Show coaches their real take-home (about 84% at 10%), not just "10% fee". That avoids surprises after the first payout.

---

## 3. Setup (one time)

1. **Ask the AcePay operator to:**
   - register BooklyPH as an app, if it isn't already. You get an **API key** and a **webhook secret**.
   - set BooklyPH's **webhook URL**, e.g. `https://api.bookly.ph/api/webhooks/acepay`. For local
     testing use `http://127.0.0.1:3300/api/webhooks/acepay`: AcePay's URL check needs a dotted
     host, so `localhost` is refused.
   - turn on **marketplace mode** for BooklyPH with a **10%** fee and a **₱500 minimum payout**.
2. **Store these as server secrets.** They must never be in the mobile app or the website:
   ```
   ACEPAY_BASE_URL=https://<acepay-gateway-host>      # local dev: http://localhost:4001
   ACEPAY_API_KEY=...
   ACEPAY_WEBHOOK_SECRET=...
   ```
3. **Every request** sends the key in a header:
   ```
   x-api-key: <ACEPAY_API_KEY>
   Content-Type: application/json
   ```

Full interactive API docs (Swagger) are at `<ACEPAY_BASE_URL>/docs`.

---

## 4. Onboarding a coach

Do this when a coach finishes the "Get paid" setup in BooklyPH.

### `POST /v1/merchants`

```json
{
  "externalRef": "coach_42",
  "name": "Coach Juan Dela Cruz",
  "email": "juan@email.com",
  "payoutChannelCode": "PH_GCASH",
  "payoutAccountNumber": "09171234567",
  "payoutAccountHolderName": "Juan Dela Cruz",
  "metadata": { "city": "Cebu" }
}
```

| Field | Notes |
|---|---|
| `externalRef` | **Your** coach id. Must be unique within BooklyPH. Use it to look the coach up later. |
| `name` | Shown to students on the Xendit checkout page. |
| `payoutChannelCode` | Where payouts go: `PH_GCASH`, `PH_PAYMAYA`, `PH_BPI`, `PH_BDO`, … |
| `payoutAccountNumber`, `payoutAccountHolderName` | Optional at sign-up. **All three payout fields must be sent together.** A coach without them can still take bookings, but is skipped at payout time until they add them. |

**Response `201`**
```json
{
  "id": "8f5c1c2e-…",
  "externalRef": "coach_42",
  "name": "Coach Juan Dela Cruz",
  "email": "juan@email.com",
  "status": "active",
  "feePercent": 10,
  "feeOverridePercent": null,
  "feeOverrideEndsAt": null,
  "payoutChannelCode": "PH_GCASH",
  "payoutAccount": "•••• 4567",
  "payoutAccountHolderName": "Juan Dela Cruz",
  "hasPayoutDestination": true,
  "metadata": { "city": "Cebu" },
  "createdAt": "…",
  "updatedAt": "…"
}
```

- **Save `id` on the coach** as `acepayMerchantId`. You need it for every booking payment.
- `status` is usually `active` straight away. If it comes back `pending`, wait for the
  `merchant.activated` webhook before taking bookings for that coach.
- The full account number is never returned, only a masked version.
- A second call with the same `externalRef` returns `409 merchant_exists`. Look the coach up instead
  (see below).

### Other coach endpoints

| Purpose | Call |
|---|---|
| Look a coach up by your own id | `GET /v1/merchants?externalRef=coach_42` |
| Get one coach | `GET /v1/merchants/:id` |
| Coach edits name, email or payout details | `PATCH /v1/merchants/:id`. Same fields as create (except `externalRef`); the three payout fields go together. |
| List coaches | `GET /v1/merchants?status=active&page=1&pageSize=20` |

Coach statuses:
- `pending`: the sub-account is still being set up.
- `active`: can take bookings.
- `paused`: the operator paused this coach. No new payments, skipped at payouts.
- `suspended`: Xendit suspended the coach.

Only `active` coaches can be charged.

---

## 5. Charging a student for a session

### `POST /v1/payments`

```json
{
  "amount": 50000,
  "currency": "PHP",
  "merchantId": "8f5c1c2e-…",
  "idempotencyKey": "booking_9f2c",
  "description": "Tennis session with Coach Juan — Oct 10, 4:00 PM",
  "redirect": {
    "success": "https://bookly.ph/bookings/booking_9f2c/paid",
    "failed": "https://bookly.ph/bookings/booking_9f2c/payment-failed"
  },
  "customer": { "email": "maria@email.com", "name": "Maria Santos" },
  "metadata": { "bookingId": "booking_9f2c", "sessionAt": "2026-10-10T08:00:00Z" }
}
```

| Field | Notes |
|---|---|
| `amount` | Centavos. Minimum `100` (₱1). |
| `currency` | `PHP` only. |
| `merchantId` | The coach's AcePay id from section 4. |
| `idempotencyKey` | **Use your booking id.** Sending the same key again returns the **same** payment and checkout link instead of charging twice. Safe to retry on timeouts. Reusing a key for a *different* amount or coach returns `409 idempotency_key_reused`. |
| `redirect` | Where Xendit sends the student afterwards. `https://` URLs or app deep links (e.g. `booklyph://booking/9f2c/paid`). |
| `customer.email` | Optional. Pre-fills the checkout and receives Xendit's receipt. |

**Response `201`**
```json
{
  "id": "c0ffee00-…",
  "status": "pending",
  "amount": 50000,
  "currency": "PHP",
  "merchantId": "8f5c1c2e-…",
  "platformFee": 5000,
  "merchantAmount": 45000,
  "feePercent": 10,
  "checkoutUrl": "https://checkout.xendit.co/web/…",
  "idempotencyKey": "booking_9f2c",
  "metadata": { "bookingId": "booking_9f2c", "sessionAt": "…" },
  "createdAt": "…"
}
```

1. Save `id` on the booking as `acepayPaymentId`.
2. Send the student to `checkoutUrl`. On mobile, open it in an in-app browser.
3. **Don't mark the booking paid when the student lands on the success redirect.** The redirect is only
   for display. The booking is paid when the `payment.succeeded` **webhook** arrives (section 7).

`merchantAmount` is the coach's share **before** Xendit's own fees.

---

## 6. Reading, syncing and refunding payments

| Purpose | Call |
|---|---|
| Get a payment | `GET /v1/payments/:id`. If it's been `pending` for a while, AcePay re-checks Xendit automatically. |
| List payments | `GET /v1/payments?status=succeeded&from=…&to=…&page=1` |
| Force a re-check (if a webhook seems lost) | `POST /v1/payments/:id/sync` |
| Refund (cancelled booking) | `POST /v1/payments/:id/refund` with `{ "amount": 50000, "reason": "Coach cancelled" }`. Leave out `amount` for a full refund. |

**About refunds:**
- **Who it comes out of.** A refund comes out of the **coach's** balance.
- **If the coach was already paid out.** Their balance may be too low and the refund fails. Contact the AcePay operator in that case.
- **The 10% isn't returned.** The platform fee is not refunded automatically, because Xendit doesn't reverse splits.
- **Partial refunds.** These are allowed. AcePay stops you refunding more than was paid.

---

## 7. Webhooks: how BooklyPH hears about things

AcePay POSTs JSON to BooklyPH's webhook URL.

### Verify every webhook

Each request carries:

| Header | Meaning |
|---|---|
| `x-acepay-signature` | `sha256=<hex HMAC>` |
| `x-acepay-timestamp` | Unix seconds |
| `x-acepay-event` | Event name, e.g. `payment.succeeded` |
| `x-acepay-event-id` | Unique id; use it to ignore duplicates |

The signature is `HMAC-SHA256(webhookSecret, "<timestamp>.<raw body>")`. Check it against the **raw** body
before parsing:

```ts
import { createHmac, timingSafeEqual } from 'crypto';
import express from 'express';

app.post('/webhooks/acepay', express.raw({ type: 'application/json' }), async (req, res) => {
  const timestamp = req.header('x-acepay-timestamp') ?? '';
  const sent = (req.header('x-acepay-signature') ?? '').replace('sha256=', '');
  const expected = createHmac('sha256', process.env.ACEPAY_WEBHOOK_SECRET!)
    .update(`${timestamp}.${req.body}`)
    .digest('hex');
  const ok = sent.length === expected.length && timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return res.status(401).send('bad signature');

  const eventId = req.header('x-acepay-event-id');
  if (await alreadyHandled(eventId)) return res.sendStatus(200); // duplicates happen

  const event = JSON.parse(req.body.toString());
  await handleAcepayEvent(event);
  res.sendStatus(200);
});
```

**Reply `2xx` within 10 seconds.** Anything else (or a timeout) is retried up to 5 times with growing
delays. Do slow work (emails, push notifications) in the background after replying.

### Events BooklyPH should handle

#### `payment.succeeded`: the student paid
```json
{
  "event": "payment.succeeded",
  "transaction_id": "c0ffee00-…",
  "subscription_id": null,
  "provider": "xendit",
  "amount": 50000,
  "currency": "PHP",
  "metadata": { "bookingId": "booking_9f2c", "sessionAt": "…" },
  "marketplace": {
    "merchant_id": "8f5c1c2e-…",
    "fee_percent": 10,
    "platform_fee": 5000,
    "merchant_amount": 45000
  },
  "timestamps": { "created_at": "…", "provider_completed_at": "…", "webhook_received_at": "…" }
}
```
→ Mark the booking **paid** (find it via `transaction_id` or `metadata.bookingId`). Tell the coach
"₱440 incoming".

#### `payment.failed`: the checkout expired unpaid
Same shape as above. → Release the time slot and ask the student to try again.

#### `merchant.activated` / `merchant.suspended`
```json
{
  "event": "merchant.activated",
  "merchant_id": "8f5c1c2e-…",
  "external_ref": "coach_42",
  "merchant_status": "active",
  "payout": null,
  "timestamps": { "occurred_at": "…" }
}
```
→ `activated`: the coach can now take bookings. `suspended`: stop offering this coach's slots and
contact the AcePay operator.

#### `merchant.payout_sent` / `merchant.payout_failed`
```json
{
  "event": "merchant.payout_sent",
  "merchant_id": "8f5c1c2e-…",
  "external_ref": "coach_42",
  "merchant_status": "active",
  "payout": {
    "id": "a1b2…",
    "run_id": "r9…",
    "amount": 482500,
    "currency": "PHP",
    "status": "succeeded",
    "channel_code": "PH_GCASH",
    "account": "•••• 4567",
    "failure_code": null,
    "failure_message": null,
    "estimated_arrival_at": "…",
    "completed_at": "…"
  },
  "timestamps": { "occurred_at": "…" }
}
```
→ `payout_sent`: notify the coach, e.g. "₱4,825 sent to your GCash •••• 4567".
→ `payout_failed`: the money is **safe in the coach's balance**. Ask the coach to check their payout
details (common `failure_code`s: `INVALID_DESTINATION`, `REJECTED_BY_CHANNEL`). When they fix them with
`PATCH /v1/merchants/:id`, the operator can retry.

---

## 8. A coach's earnings screen

| Show | Call |
|---|---|
| "₱4,850 available" | `GET /v1/merchants/:id/balance` |
| Payout history | `GET /v1/merchants/:id/payouts?page=1` |

```json
// GET /v1/merchants/:id/balance
{
  "merchantId": "8f5c1c2e-…",
  "currency": "PHP",
  "available": 487500,
  "payable": 485000,
  "inFlight": 0,
  "minPayout": 50000
}
```

| Field | Meaning |
|---|---|
| `available` | The coach's live balance with Xendit. |
| `payable` | What the next payout would send. A small amount stays behind to cover Xendit's payout fee. |
| `inFlight` | Payouts already sent but not yet confirmed by the bank. |
| `minPayout` | Below this, the balance rolls over to the next payout. |

Payment money may take a little while to settle before it counts toward `available`.

---

## 9. Changing BooklyPH's own settings

BooklyPH can adjust its **default platform fee** and **minimum payout** from its own system (for example,
from an internal admin screen) without asking the AcePay operator each time. The same endpoints work for
any AcePay app, each with its own API key and its own allowed range.

### Read: `GET /v1/app/config`
```json
{
  "appId": "…",
  "name": "BooklyPH",
  "slug": "booklyph",
  "marketplace": {
    "enabled": true,
    "feePercent": 10,
    "feeBounds": { "min": 10, "max": 15 },
    "minPayout": 50000
  }
}
```

### Change: `PATCH /v1/app/config`
```json
{ "feePercent": 13, "minPayout": 100000 }
```
Send one or both. The response is the updated config, in the same shape as above.

**The fee is set in AcePay.** The AcePay operator can change BooklyPH's fee at any time, so BooklyPH
doesn't hardcode it. It reads `feePercent` from `GET /v1/app/config` and adopts it as its own rate, so
receipt bookings and online payments always charge the same. BooklyPH does this in its reconcile job
(every 10 minutes) and on demand (`POST /api/admin/settings/acepay/sync`, or "Use N%" on its admin
Settings page). Each online payment also records the fee AcePay actually took, so a payment made
before the sync is still booked correctly.

**Rules and safety rails:**
- **Allowed range.** The fee must be inside `feeBounds`, a range only the AcePay operator can set.
  Outside it you get `400 fee_out_of_bounds`. If `feeBounds` is `null`, BooklyPH can't change its fee at
  all (`403 fee_change_not_allowed`) and should ask the operator. This protects the platform fee if the
  API key ever leaks.
- **Minimum payout.** Any amount from `0` to `100000000` (₱1,000,000), in centavos.
- **Only new payments are affected.** A new fee applies to payments created after the change; existing
  payments keep the fee they were charged at.
- **Coach overrides still win.** A coach's individual rate (e.g. the 10% founding-coach rate) still applies
  while it runs.
- **What BooklyPH can't change.** Turning marketplace mode on or off, the allowed range, and coach overrides
  stay with the AcePay operator.
- **Everything is logged.** Each change is recorded with the API key prefix that made it, and the operator
  sees it in the AcePay admin.

---

## 10. Errors

Every error looks like:
```json
{ "error": { "code": "merchant_not_active", "message": "Merchant … is paused and can't accept payments", "requestId": "…" } }
```

| Code | HTTP | What to do |
|---|---|---|
| `marketplace_not_enabled` | 403 | Ask the AcePay operator to turn on marketplace mode for BooklyPH. |
| `marketplace_fee_not_set` | 400 | Same: the fee isn't configured yet. |
| `merchant_not_found` | 404 | Wrong id, or a coach that belongs to a different app. |
| `merchant_exists` | 409 | Coach already onboarded. Look them up with `?externalRef=`. |
| `merchant_not_active` | 400 | Coach is pending, paused or suspended. Don't offer their slots. |
| `incomplete_payout_destination` | 400 | Send channel, account number and holder name together. |
| `idempotency_key_reused` | 409 | That booking id was already used for a different charge. |
| `not_refundable` / `amount_exceeds_refundable` | 400 | Only succeeded payments can be refunded, and only up to what's left. |
| `fee_out_of_bounds` | 400 | The new fee is outside the range the operator allowed (`feeBounds`). |
| `fee_change_not_allowed` | 403 | No fee range set: only the operator can change the fee. |
| `rate_limited` | 429 | Too many requests. Wait for the `Retry-After` header. |
| `provider_error` | 502 | Xendit had a problem before an invoice was made. Retry with the same `idempotencyKey`: AcePay re-invoices the same payment (same id, same fee) and returns a fresh `checkoutUrl`. |

---

## 11. Testing (Xendit test mode)

The AcePay operator runs AcePay with Xendit **test** keys for the test environment. No real money moves.

1. **Onboard test coaches** with these account numbers to see every payout outcome:

   | Account number | Payout result |
   |---|---|
   | any normal number | ✅ succeeds |
   | `121212` | ❌ `INVALID_DESTINATION` |
   | `999999` | ❌ `REJECTED_BY_CHANNEL` |
   | `98018521` | ❌ `TRANSFER_ERROR` |
   | `123456` | ❌ `TEMPORARY_TRANSFER_ERROR` |

2. **Book and pay** a session through the test checkout. Check that `payment.succeeded` marks the booking
   paid and that the 10% breakdown is right.
3. **Ask the operator** to run a payout. Check that `merchant.payout_sent` and
   `merchant.payout_failed` both reach BooklyPH.
4. **Cancel a booking** and refund it.
5. **Re-send** a webhook (the operator can retry one from the admin). Check that BooklyPH ignores the
   duplicate.

**Testing on one laptop.** Xendit can't call back to a gateway on `localhost:4001`, so nothing is
confirmed by Xendit itself. After paying in the test checkout, call `POST /v1/payments/:id/sync`:
AcePay asks Xendit for the status and sends `payment.succeeded`. Payouts work the same way through the
admin's payout sync. Webhooks are delivered by `payment-worker`, so Redis and the worker must be running.
A `/sync` re-send carries a **new** `x-acepay-event-id`; dedupe on the payment's state as well as the event id.

---

## 12. BooklyPH build checklist

- [ ] Server-side config: `ACEPAY_BASE_URL`, `ACEPAY_API_KEY`, `ACEPAY_WEBHOOK_SECRET` (never in the apps)
- [ ] Coach "Get paid" screen → `POST /v1/merchants`, store `acepayMerchantId`
- [ ] Coach edits payout details → `PATCH /v1/merchants/:id`
- [ ] Booking checkout → `POST /v1/payments` with `idempotencyKey = bookingId`, open `checkoutUrl`
- [ ] Webhook endpoint with signature check + duplicate guard (`x-acepay-event-id`)
- [ ] Handle `payment.succeeded` / `payment.failed`
- [ ] Handle `merchant.activated` / `merchant.suspended`
- [ ] Handle `merchant.payout_sent` / `merchant.payout_failed` + coach notifications
- [ ] Coach earnings screen → balance + payout history
- [ ] Cancellation → `POST /v1/payments/:id/refund`
- [ ] (Optional) Internal settings screen → `GET` / `PATCH /v1/app/config`
- [ ] Show coaches their real take-home (about 84%), not just "10%"
- [ ] Run the test-mode checklist in section 11
