# Slice 7 — PayMongo + one Integrations page

**Status:** ✅ 7a–7d built 2026-10-12 (not yet run against live PayMongo). Decisions taken 2026-10-12: A2 (encrypted
DB credentials), B plan-level choice, D subscriptions only. **C changed:** PayMongo forbids off-session charging of
vaulted cards, so recurring uses PayMongo's own Subscriptions API, with an AcePay-hosted pay page for the first
invoice (card + Maya). Cancel is immediate; pause/resume aren't supported (accepted).

## Goal

1. Add **PayMongo** as a third payment provider next to Lemon Squeezy and Xendit. Apps don't change —
   they still call `/v1/subscriptions` / `/v1/payments`; AcePay decides which provider handles it.
2. Give the operator **one Integrations page** in the admin (Configuration → Integrations) where every
   provider lives side by side: connected or not, test or live, webhook URL to paste, last webhook seen,
   and a "Test connection" button. Today that information is split across the Gateways page, the Settings
   page, and `.env`.

## Why it's mostly plumbing

The provider layer was built for this. Everything goes through the `PaymentProvider` interface
(`payment-providers/provider.types.ts`) and `ProviderRegistry.resolve(name)`. Plans, subscriptions,
transactions and webhook events already store a `provider` column. So "add PayMongo" means: one new
adapter, one new enum value, one new webhook route, and the registry case. The bigger change is the
Integrations page, *if* we move credentials out of `.env` (see Decision A).

## Part 1 — PayMongo adapter

### What PayMongo gives us (verify each against current docs before building)

| Need | PayMongo API | Notes |
|---|---|---|
| Hosted checkout (one-time) | **Checkout Sessions** `POST /v1/checkout_sessions` | One URL with cards, GCash, Maya, GrabPay, QR Ph, online banking. Closest match to Xendit Invoices. |
| Status lookup | `GET /v1/checkout_sessions/:id` → `payments[]` | Session id first, payment id after paid — same "id swap" shape as LS checkout → order. |
| Refund | `POST /v1/refunds` with `payment_id` | Needs the **payment id**, not the session id (like Xendit's invoice → payment_id). |
| Recurring | ⚠️ **Subscriptions API** (plans + subscriptions) — confirm it's GA for our account | If not available, do it the Xendit way: save the payment method and let the billing queue charge it. |
| Webhooks | Register once via `POST /v1/webhooks` or the dashboard | Events: `checkout_session.payment.paid`, `payment.paid`, `payment.failed`, `payment.refunded`, subscription events. |
| Auth | HTTP Basic with the secret key (`sk_test_…` / `sk_live_…`) | Test vs live is decided **by the key**, not a flag. |

- **Amounts are minor units (centavos)** — same as Lemon Squeezy, *opposite* of Xendit. Pin this with a
  table-driven spec exactly like the other two adapters (the "charge 100×" gotcha).
- **Webhook signature:** `Paymongo-Signature: t=<ts>,te=<test sig>,li=<live sig>`. Signature is
  HMAC-SHA256 of `"<t>.<rawBody>"` with the webhook secret; compare `te` in test mode, `li` in live,
  with `timingSafeEqual`. Reject timestamps older than ~5 min (replay protection — LS/Xendit don't give us this).
- **No official Node SDK.** Write a thin `fetch` client (`paymongo.client.ts`) like `XenditPlatformClient`,
  rather than pulling in an unmaintained community package.

### Backend changes

```
common/enums.ts                       Provider.Paymongo = 'paymongo'
database/migrations/…-Paymongo.ts     ALTER TYPE <each provider enum> ADD VALUE 'paymongo'
                                      (the XenditSwap migration removed it — four enum columns:
                                      transactions, plans, subscriptions, webhook_events)
                                      + customers.paymongo_customer_id / payment_method_id if we
                                      go the AcePay-managed recurring route
payment-providers/paymongo.client.ts  HTTP + Basic auth + error mapping → 502 via AllExceptionsFilter
payment-providers/paymongo.adapter.ts implements PaymentProvider
payment-providers/provider.registry.ts  + case Provider.Paymongo
modules/webhooks/                     POST /v1/webhooks/paymongo (public, rawBody, signature-checked)
modules/settings/settings-admin.service.ts  health(): add PayMongo row
modules/settings/                     simulate-webhook: add a synthetic PayMongo event
common/config/validate-env.ts         PAYMONGO_* optional (only required if a plan uses PayMongo)
.env.example                          PAYMONGO_SECRET_KEY, PAYMONGO_PUBLIC_KEY, PAYMONGO_WEBHOOK_SECRET
```

Reconciler (`payment-reconciler.service.ts`), refunds, admin transaction detail and the Gateways health
cards all go through the registry, so they pick PayMongo up for free once the adapter exists.

### How a request reaches PayMongo

Same rule as today: **the plan picks the provider.** An operator registers a plan with
`provider = paymongo`; any subscription on that plan goes to PayMongo. No country routing, no new app
setting. (Marketplace stays Xendit-only — PayMongo has no equivalent of Owned sub-accounts + split rules
that we'd want to depend on.)

## Part 2 — Integrations page

One page, one card per provider:

```
┌ Integrations ─────────────────────────────────────────────────────────┐
│ ┌ Lemon Squeezy ──────┐ ┌ Xendit ─────────────┐ ┌ PayMongo ──────────┐ │
│ │ ● Connected · TEST  │ │ ● Connected · LIVE  │ │ ○ Not connected    │ │
│ │ Store 12345         │ │ Platform acct …a91  │ │                    │ │
│ │ API key   ••••3f2a  │ │ Secret key ••••c0de │ │ [ Connect ]        │ │
│ │ Webhook  ✓ 2m ago   │ │ Webhook  ✓ 1h ago   │ │                    │ │
│ │ [Test] [Edit] [Sim] │ │ [Test] [Edit] [Sim] │ │                    │ │
│ └─────────────────────┘ └─────────────────────┘ └────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

Clicking a card opens a detail drawer: credential fields, test/live badge, the exact webhook URL to paste
into that provider's dashboard (built from the existing "Public webhook URL" setting), events to subscribe
to, provider-specific settings (LS store + variant, Xendit platform account + payout fee reserve,
PayMongo enabled payment methods), "Test connection" (a cheap read call — LS `getStore`, Xendit
`getBalance`, PayMongo `GET /v1/webhooks`), and "Send test webhook" (the existing simulate endpoint).

### Backend

```
modules/integrations/
  integrations-admin.controller.ts   GET  /admin/integrations
                                     GET  /admin/integrations/:provider
                                     PUT  /admin/integrations/:provider      (Decision A)
                                     POST /admin/integrations/:provider/test
  integrations.service.ts            merges config status + webhook health (reuses SettingsAdminService.health)
  provider-credentials.service.ts    single place adapters read credentials from (Decision A)
```

Adapters stop calling `config.get('XENDIT_SECRET_KEY')` directly and ask
`ProviderCredentialsService.get(Provider.Xendit)` instead. That's ~10 call sites across the three adapters +
`XenditPlatformClient`, and it's the refactor that makes "edit keys in the admin" possible.

### Frontend

- New route `apps/payment-admin/src/app/(admin)/integrations/page.tsx` + `admin/pages/integrations.tsx`.
- Sidebar: Configuration → **Integrations** (above Settings).
- Fold the Gateways page's "Providers" section and the Settings page's provider-health table into it, so
  provider info lives in exactly one place. Gateways keeps the connected-apps grid; Settings keeps the
  public webhook URL and general options.
- Secrets are **write-only** in the UI: show `••••` + last 4, never return the full value from the API.

## Decisions to make

**A. Where do provider credentials live?**
- **A1 — stay in `.env`; the page is read-only** (status, masked last-4, webhook URL, test buttons; editing
  keys still means editing `.env` and restarting). Smallest change, zero new secret-storage risk.
- **A2 — in the database, encrypted, editable from the page; `.env` is the fallback.** New
  `provider_credentials` table, each secret AES-256-GCM encrypted with the same key/helpers as
  `webhookSecretEnc`. Rotating a key no longer needs a redeploy. Every change audited (who/when, never the
  value). More work: credential cache + invalidation so the worker sees changes too.
- *Recommendation:* **A2**, since "all my integrations in one place in settings" implies editing there —
  but A1 is a fine first step and A2 can follow without redoing the page.

**B. What is PayMongo for, given Xendit already covers PH?**
- Plan-level choice (operator picks per plan) — *recommended, matches today's model*;
- Replace Xendit for PH subscriptions;
- Failover when Xendit is down (much bigger: needs routing + health checks).

**C. PayMongo recurring:** use PayMongo's own Subscriptions API (if it's available on the account), or
AcePay-managed like Xendit (save the card, Bull queue charges it — reuses dunning, pause/resume as-is).
*Recommendation:* AcePay-managed — dunning, pause/resume and the billing processor already exist and are
tested; one recurring engine is easier to reason about than two.

**D. One-time payments:** PayMongo checkout for one-time charges too, or subscriptions only (AcePay is
subscription-only outside marketplace)? *Recommendation:* subscriptions only for now, adapter's
`createPayment` implemented anyway since the subscription first cycle uses a checkout session.

## Suggested build order

1. ✅ **7a — Integrations page, read-only (A1).** Consolidate existing LS + Xendit info, add "Test
   connection". Ships value on its own, no new provider yet.
2. ✅ **7b — PayMongo adapter + webhook + migration**, env-configured, card appears on the page.
   Plans modal gets PayMongo as a provider option.
3. ✅ **7c — PayMongo recurring** via PayMongo's Subscriptions API + the AcePay pay page (Decision C changed — see Status).
4. ✅ **7d — Editable encrypted credentials (A2)** if we want it.

## Prerequisites (operator)

- PayMongo account, business verification done for live mode; test keys from Developers → API Keys.
- Confirm which payment methods are activated on the account (GCash/Maya need separate activation).
- Confirm Subscriptions API availability (Decision C) and refund rules for e-wallets.
