# Slice 6 — Marketplace payments + manual payouts (Xendit)

**Status:** ✅ AcePay side implemented 2026-10-04 (not yet run against live Xendit). BooklyPH integration not started. Plan written 2026-10-03.

## Goal

An app such as BooklyPH charges a customer for a booking (e.g. ₱500). Xendit splits the payment the moment
it's paid: **the platform (us) keeps a fee set per app** (BooklyPH: 12%) and the rest goes to the merchant (e.g. a coach). Once or twice a week the
operator clicks **one button** to pay every merchant's accumulated balance out to their GCash or bank account.

```
Customer pays ₱500 (BooklyPH booking)
        │  one Xendit invoice, created ON the merchant's sub-account, with a split rule
        ▼
 ┌───────────────────────┐
 │ Xendit splits at pay  │
 └───────────────────────┘
     │ 88% = ₱440 (minus Xendit fees) │ 12% = ₱60   (BooklyPH's rate)
     ▼                               ▼
 Merchant's Owned sub-account     Platform (master) Xendit account
     │
     │  operator clicks "Pay all merchants" (weekly)
     ▼
 Merchant's GCash / bank
```

## Key decisions already made

- **Xendit xenPlatform + Split Rules**, not "collect everything then pay out". Merchant money never mixes with
  the platform's; Xendit tracks who owns what.
- **Owned sub-accounts**, not Managed. Merchants (coaches) are mostly individuals who won't finish Xendit
  KYC; with Owned, AcePay creates the sub-account instantly and controls payouts.
- **One split rule can serve every merchant.** The invoice is created on the merchant's sub-account
  (`for-user-id`), and the rule only routes "<rate> → master". Each distinct rate (BooklyPH 12%, its 10% founding rate, another app's rate) gets its own rule,
  created once and reused.
- **Invoice on the merchant's sub-account**, so Xendit's per-transaction fee lands on the merchant's side
  rather than eating the platform fee. ⚠️ Confirm with Xendit (see Prerequisites).
- **Payouts are MANUAL only.** Operator previews → confirms → worker sends. No scheduled/automatic payout
  job in this slice — that's a later phase.
- **Platform fee is set per app — there is no global default.** Every app registered for marketplace mode
  must have its own `marketplaceFeePercent`; merchants always pay Xendit's fees.
- **BooklyPH: 12%** (decided 2026-10-03). BooklyPH founding coaches get **10% for a limited time** via a per-merchant override with an end date (`feeOverridePercent` +
  `feeOverrideEndsAt`), after which they fall back to the app default. Worked numbers for a ₱500 booking:
  platform ₱60, Xendit payment fee ≈ ₱27–28.50 (GCash ≈ 3.2% + ₱11, card ≈ 3.5% + ₱11 — confirm),
  coach ≈ ₱410 after their share of the weekly payout fee. At ₱20k/month costs, break-even ≈ 344
  bookings/month. Tell coaches the real take-home (≈ 82%), not just "12%".
- **Lemon Squeezy is out of scope.** LS is a Merchant of Record with no API to pay third parties; moving LS
  money into Xendit for payouts was discussed and dropped from this slice.

## Scope

### In
1. **Merchants** — new `merchants` table (belongs to an app): `externalRef` (app's own id, e.g. coachId),
   name, email, `xenditSubAccountId`, status, `feeOverridePercent` + `feeOverrideEndsAt` (optional; falls back to the app's fee, e.g. BooklyPH 12%), payout destination
   (`payoutChannelCode` e.g. `PH_GCASH` / `PH_BPI`, `accountNumber`, `accountHolderName`).
2. **Split booking payments** — restore `POST /v1/payments` (deleted in Slice 3.6) with a required
   `merchantId`. Computes fee (rounded to the centavo), creates the invoice on the merchant's sub-account with
   the split rule. Idempotency key = the app's booking id.
3. **Manual payout runs** — preview from each merchant's live sub-account balance → operator unticks anyone
   to skip → confirm → worker sends one Xendit payout per merchant → progress, retry failed, CSV export.
4. **Webhooks to the app** — `payment.succeeded` / `payment.failed` with the fee breakdown
   (`total`, `platformFee`, `merchantAmount`); `merchant.payout_sent` / `merchant.payout_failed`.
5. **Admin UI** — Merchants page (search, filter by app/status, balance, payout history, pause),
   Payout Runs page (preview, confirm, live progress, history), platform-fee-earned on the dashboard.

### Out (later phases)
- Automatic / scheduled payouts.
- Any BooklyPH implementation (AcePay endpoints will be ready and documented).
- Lemon Squeezy → Xendit funding.
- Managed sub-accounts.
- Merchants outside the Philippines (and any second provider such as Stripe Connect).

## Multiple apps on one Xendit account

More apps than BooklyPH will use this. All their merchants live under the **one** master Xendit account, so
the design keeps every app's money separate:

| Possible conflict | Rule |
|---|---|
| Same person on two apps | **One merchant + one sub-account per app.** Balances, refunds and payouts never mix across apps. |
| Two apps using the same id | `merchants` unique on `(app_id, external_ref)`, not `external_ref` alone. |
| Xendit references colliding | Everything sent to Xendit (sub-account reference, invoice external id, payout reference / idempotency key) uses AcePay UUIDs, never an app's ids. |
| Different fees per app | `apps.marketplace_fee_percent` (required per app, e.g. BooklyPH 12%) + optional per-merchant override. Split rules are cached **per rate** and reused by every app on that rate. |
| All platform fees in one balance | Each transaction stores `app_id` + `platform_fee_amount` → per-app fee reporting. |
| One Xendit webhook URL for all apps | Route by sub-account id → merchant → app; forward only to that app's webhook. `uq` on `xendit_sub_account_id`. |
| Payout runs | One run can cover all apps or be filtered to one app; each merchant pays out from its own sub-account. |
| Turning it on | `apps.marketplace_enabled` flag; `POST /v1/merchants` and split payments are rejected for apps without it. |

**Same person, same bank account, different apps.** Allowed. They're two merchants (one per app), each with
its own sub-account, fee % and balance, that happen to share a payout destination. A payout run sends **two
separate payouts** to that account, each labelled with its app (e.g. "BooklyPH payout — Oct 1–7") so the
person can tell them apart and each app's books stay clean. Cost: two Xendit payout fees instead of one; the
minimum payout amount keeps that in check. Combining them into one transfer (a person-level "payee" that
pools several merchants' balances) is deferred — it means moving money between sub-accounts and breaks
per-app accounting.
AcePay stores a fingerprint of each payout destination (channel + account number) to:
- show the admin "this account also receives payouts from: <other app>" — informational, never blocking;
- **flag** the same account on several merchants *within one app* — a possible duplicate or abuse.

Shared-account risks AcePay can't fully remove:
- One app's fraud / chargebacks affect the master account's standing for **all** apps → per-app pause switch
  and per-app dispute-rate tracking.
- Card statements may show the master company name, not the app → ask Xendit whether invoices can carry the
  app's or merchant's name (unrecognised charges get disputed more).

## Providers considered (and why Xendit)

- **Lemon Squeezy — not used for bookings.** It's a Merchant of Record with no split payments, sub-accounts
  or third-party payout API; its fee (~5% + 50¢, about 11% of a ₱500 booking) would eat most of the platform fee;
  and in-person/third-party services may not be eligible products. LS stays for subscriptions.
- **PayMongo Platforms** — the one real PH alternative (sub-merchants, automatic splits with platform fees,
  bulk payouts). Get a quote to compare against xenPlatform; switching later would mean a new adapter only,
  apps unaffected.
- **Stripe Connect** — needs the platform company registered in a Stripe country; PH payouts limited.
  Deferred, no slice planned.

## International users

- **Students abroad: supported.** Xendit PH accepts foreign Visa / Mastercard / JCB. Charge in **PHP**
  (the cardholder's bank converts); USD card acceptance can be enabled in the Xendit dashboard but would
  make sub-account balances multi-currency, so stay PHP-only. Keep 3-D Secure on; foreign-card fees are
  higher — check the rate.
- **Coaches abroad: not supported in this slice.** Payouts go to PH banks / e-wallets only, so merchants must
  have a PH payout destination. Revisit only if there's real demand (would mean a second provider, e.g.
  Stripe Connect, plus a foreign entity).

## App-facing API (what BooklyPH will call later)

| Purpose | Endpoint |
|---|---|
| Onboard a merchant (coach) | `POST /v1/merchants` `{ externalRef, name, email, payoutChannelCode, accountNumber, accountHolderName }` |
| Update payout details | `PATCH /v1/merchants/:id` |
| Charge a booking | `POST /v1/payments` `{ amount, currency: "PHP", merchantId, idempotencyKey, metadata, redirect, customer }` → `checkoutUrl` |
| Merchant earnings screen | `GET /v1/merchants/:id/balance`, `GET /v1/merchants/:id/payouts` |
| Cancellation | `POST /v1/payments/:id/refund` |

All `/v1/merchants*` reads are scoped by `appId` — another app's merchant is a plain 404 (tenant rule).

## Payout run — how the one click works

1. **Preview** snapshots each merchant's settled sub-account balance. Excluded with a reason: below the
   minimum payout (rolls over), missing payout details, paused.
2. **Confirm** shows totals (merchants, amount, fees) and enqueues the run on a worker queue.
3. **Worker** sends one payout per merchant (`Payout.createPayout` with `forUserId`), paced for Xendit's
   rate limits. 1,000 merchants takes minutes; the operator can close the page.
4. **Idempotency key = `runId + merchantId`** — double-click, refresh, or worker crash can never pay a
   merchant twice; re-running a half-finished run just finishes it.
5. **Partial failure** (bad GCash number) never stops the run. The money stays in the merchant's
   sub-account, the app gets `merchant.payout_failed`, and the operator can retry from the run page.
6. **Status updates** come from Xendit payout webhooks (`payout.succeeded` / `payout.failed` /
   `payout.reversed`) on a new receiver route `POST /v1/webhooks/xendit/payouts`, plus a manual Sync.
7. Bookings paid (or not yet settled by Xendit) after the preview snapshot go into the **next** run.
   Refunds during the week reduce the balance **before** payout.

## Build order

1. **DB** — `merchants`, `payout_runs`, `payouts`; transactions gain `merchant_id`, `platform_fee_amount`,
   `merchant_amount`, `split_rule_id`. One hand-written migration.
2. **Xendit adapter** — new raw-HTTP calls (xendit-node v7 has no xenPlatform Accounts / Split Rules
   support, and its Invoice API can't attach a split rule): create Owned sub-account, create/reuse split
   rule, create invoice with `for-user-id` + `with-split-rule` headers. Reuse SDK `Balance.getBalance` and
   `Payout.createPayout` / `getPayoutById` / `cancelPayout`, all with `forUserId`. Keep the major-units
   rule (adapter divides by 100).
3. **Merchants module** — admin + app-facing controllers/services, appId-scoped.
4. **Split payments** — restore `POST /v1/payments`; fee math; reject inactive merchants.
5. **Payout runs** — preview, confirm → `payout-runs` Bull queue → `PayoutRunProcessor` in the worker;
   payout webhook receiver.
6. **Admin UI** — Merchants page, Payout Runs page, dashboard platform-fee tile.
7. **Tests** — fee math (rounding, custom %), tenant scoping (404), split rule attached on every booking
   payment, preview/confirm, crash-resume without double pay, partial failure, webhook routing.
8. **Docs** — CLAUDE.md slice entry + gotchas, `.env.example` (any new xenPlatform settings).

## Testing in Xendit test mode

Use a **Development API key** (`xnd_development_…`). Payouts in test mode move no real money.

- A valid payout to **any** account number/holder name goes to `SUCCEEDED` by default.
- Magic account numbers to force failures
  ([Xendit docs](https://docs.xendit.co/docs/test-scenarios-payouts)):

  | Account number | Result |
  |---|---|
  | `98018521` | FAILED — `TRANSFER_ERROR` |
  | `123456` | FAILED — `TEMPORARY_TRANSFER_ERROR` |
  | `999999` | FAILED — `REJECTED_BY_CHANNEL` |
  | `121212` | FAILED — `INVALID_DESTINATION` |

- Payout larger than the balance → `INSUFFICIENT_BALANCE`.
- Key without Money-out write permission → `REQUEST_FORBIDDEN_ERROR`.
- Still to confirm with Xendit: how to fund a test (sub-account) balance, reversed-payout simulation, and
  `for-user-id` behaviour in test mode. Likely path: pay test invoices on the sub-account to build its
  balance, then pay it out.
- Seed a "test merchants" set using the magic numbers so one payout run exercises success + every failure
  path together.

## Prerequisites from Xendit

- [ ] xenPlatform enabled on the account.
- [ ] Limit on Owned sub-accounts, and any per-sub-account fee.
- [ ] Which account is charged the transaction fee for an invoice on a sub-account with a split rule.
- [ ] Secret key has Money-out **write** permission.
- [ ] Webhook URLs set for payouts and xenPlatform events.
- [ ] Ask whether holding merchant funds ~1 week in Owned sub-accounts is fine (also ask an accountant
      about BIR invoicing for the platform fee and any BSP considerations).

## Decided

- Platform fee is **per app** (no global default; required when marketplace mode is turned on).
- **BooklyPH: 12%** of the booking price, with a **10% founding-coach rate** that has an end date. Other apps: decided when each is onboarded.
- Merchants pay Xendit's payment fee (invoice is created on their sub-account).

## Open decisions

1. Who pays Xendit's payout fee — working assumption: the merchant (deducted from each payout), consistent
   with merchants paying Xendit's payment fee. Confirm.
2. Minimum payout amount (₱500 used as a placeholder).
3. Refunds — taken from the merchant's balance (or next payout if already paid out)? Is the platform's
   platform fee returned?
4. Same person on two apps — confirm separate merchant + sub-account per app (recommended), given any
   per-sub-account Xendit pricing.

## Implementation notes (2026-10-04)

- Decisions taken where the plan left them open (change if needed):
  - **Payout fee:** paid by the merchant — the run leaves `XENDIT_PAYOUT_FEE_RESERVE` (default ₱25) in the
    sub-account and pays out the rest.
  - **Minimum payout:** per app (`apps.marketplace_min_payout`, default ₱500).
  - **Refunds:** come out of the merchant's sub-account; the platform fee is **not** returned.
  - **Same person on two apps:** separate merchant + sub-account per app.
- A payout preview expires after 1 hour; only one payout run can be open at a time.
- Extra Xendit checklist items found while building:
  - [ ] `/v2/accounts` (type OWNED) is marked **legacy**; v3 requires legal identity. Confirm v2 OWNED stays
        available for PH, or plan the v3 + KYC flow.
  - [ ] Confirm invoice-paid callbacks for invoices on OWNED sub-accounts reach the master's invoice
        callback URL (`/v1/webhooks/xendit`).
  - [ ] Set the actual payout fee in `XENDIT_PAYOUT_FEE_RESERVE`.
