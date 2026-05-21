# AcePay

A central payment gateway. Apps (Savi, CourtHub, Vehikol, etc.) connect to AcePay via API keys; AcePay holds the single Lemon Squeezy + Xendit accounts and routes traffic to the right provider. Apps never talk to providers directly. If we ever switch providers, app code doesn't change.

The full product spec lives in conversation history (originally pasted as `acepay-complete-spec.md`).

## Repo layout (Nx monorepo)

```
apps/
  payment-gateway/       NestJS API. All admin + app-facing + webhook receiver routes.
  payment-worker/        NestJS Bull worker. Empty scaffold; planned for slice 5 (async webhook
                         delivery retry, scheduled reconciliation).
  payment-admin/         Next.js 16 admin dashboard.
libs/                    Empty. We chose to keep code under apps/payment-gateway/src/ in
                         clean NestJS modules instead of full Nx libs (less scaffolding overhead).
```

## Stack

- **Backend:** NestJS 11, TypeORM 0.3, PostgreSQL 16, `@nestjs/swagger`, real `@lemonsqueezy/lemonsqueezy.js` + `xendit-node` SDKs.
- **Frontend:** Next.js 16 (App Router with **real file-based routes** under `apps/payment-admin/src/app/(admin)/`, all client components), Inter / JetBrains Mono / Instrument Serif via `next/font/google`. No Tailwind utility classes — design uses CSS variables + inline styles. SWR-style fetching is hand-rolled in [`useFetch`](apps/payment-admin/src/admin/api/use-fetch.ts).
- **Auth:** Two layers, both built with **Node's built-in `crypto`** (no bcrypt / jsonwebtoken / passport):
  - **Admin users** → `POST /admin/auth/login` returns an HMAC-SHA256-signed JWT. Used for `/admin/*` routes.
  - **Apps** → `x-api-key` header. Used for `/v1/*` (app-facing) routes.
  - Crypto helpers live in [common/crypto.ts](apps/payment-gateway/src/common/crypto.ts).

## Running it

Postgres on port **5433** (the user's setup; not the standard 5432). All gateway env vars in `apps/payment-gateway/.env` (gitignored). Admin env vars in `apps/payment-admin/.env.local`.

```bash
# 1. One-time DB + Redis setup
createdb acepay
brew install redis && brew services start redis
npm run db:migrate            # runs the initial + admin-users migrations
npm run seed:admin            # creates the admin user from .env

# 2. Each terminal session (3 processes)
npm run serve:gateway         # http://localhost:4001  (Swagger at /docs)
npm run serve:worker          # background Bull consumer (no HTTP)
npm run serve:admin           # http://localhost:4000
```

The npm scripts use `TS_NODE_PROJECT=apps/payment-gateway/tsconfig.app.json` so ts-node picks up `experimentalDecorators` + `emitDecoratorMetadata` (TypeORM needs both).

## Auth model in one paragraph

`/admin/auth/login` exchanges email+password for a Bearer JWT. Frontend stores it in `localStorage` ([api/client.ts](apps/payment-admin/src/admin/api/client.ts)) and attaches it to every request. Admin controllers use `@UseGuards(AdminGuard)` + `@ApiBearerAuth('admin')`. App-facing controllers use `@UseGuards(ApiKeyGuard)` + `@ApiSecurity('apiKey')` and inject the calling app via `@CurrentApp()`. Webhook receivers (`/v1/webhooks/{lemonsqueezy,xendit}`) are public and signature-verified inside the controller. There's no global `APP_GUARD` — guards are explicit per controller.

## Important conventions and gotchas

- **TypeORM nullable string columns must declare `type:`.** Without it, the `string | null` reflected type becomes `Object` and validation fails at boot. Pattern: `@Column({ type: 'varchar', length: N, nullable: true })`.
- **TypeORM QueryBuilder `orderBy()` takes the entity property name, not the snake_case DB column.** `orderBy('tx.createdAt', 'DESC')`, never `orderBy('tx.created_at', …)` — the latter explodes inside `getManyAndCount` with "Cannot read properties of undefined (reading 'databaseName')".
- **Webhook receivers need `rawBody: true`** when bootstrapping NestJS — set in [main.ts](apps/payment-gateway/src/main.ts). The receiver controllers read `req.rawBody` for signature verification.
- **CORS** is configured for `http://localhost:4000` by default (the admin); override with `CORS_ORIGINS` (comma-separated).
- **Don't use `@nestjs/typeorm`'s `find({ order: { snake_case: ... } })`** — same property-name rule as orderBy.
- **`webhookSecretEnc` is AES-256-GCM encrypted at rest.** Decrypt via `decryptSecret()` only at delivery time. `WEBHOOK_SECRET_ENCRYPTION_KEY` must be 32 bytes (hex or base64) — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- **Per-app idempotency** on `POST /v1/payments` is enforced by a unique constraint on `(app_id, idempotency_key)` — same key on same app returns the existing tx instead of creating a new one.
- **Lemon Squeezy is product-catalog-driven, not arbitrary-amount.** Every checkout must reference a Variant in your LS Store. AcePay uses one "Generic Charge" variant (`LEMONSQUEEZY_VARIANT_ID`) and overrides the price per checkout via `customPrice`. Apps still pass `amount + currency` like before — they never know about variants.
- **LS providerTxId starts as a checkout UUID, becomes an order id after payment.** `createCheckout` returns a UUID checkout id, which we stash. When the `order_created` webhook arrives, we swap `providerTxId` to the numeric order id (refunds + `getOrder` need an order id, not a checkout id). The adapter's `getPayment`/`refund` use the UUID-vs-numeric shape to decide which API to hit.
- **LS subscription flow same shape as payments.** `POST /v1/subscriptions` creates an AcePay subscription row up front (status=`active`, `metadata.awaitingFirstPayment=true`, `providerSubscriptionId` = checkout id), returns a checkout URL. When `subscription_created` webhook arrives, the handler swaps `providerSubscriptionId` to the real LS subscription id and clears `awaitingFirstPayment`. Subscription pause uses `updateSubscription({ pause: { mode: 'void' } })`; resume uses `{ pause: null }`; cancel uses `cancelSubscription()` (which schedules end-of-period cancel by default).
- **Plans map AcePay plans to provider plan ids.** `Plan.providerPlanId` is the LS Variant ID for a Subscription-priced variant. Operator registers plans via the admin Plans page **or inline during app registration** for subscription-mode apps. Apps reference plans by AcePay UUID, never by LS variant id.
- **AcePay is subscription-only right now.** `POST /v1/payments` is gone (deleted in Slice 3.6 to reduce confusion). New apps always register in subscription mode. The `apps.billing_mode` column still exists for forward compatibility, but the UI doesn't expose a choice — every Register App call sends `billingMode: 'subscription'`. To re-add one-time payments, restore the controller method, surface the toggle in Register App, and uncomment country routing in the deleted `routeByCountry` helper (see git history of `payments-app.service.ts`).
- **LS variant verification.** `GET /admin/lemonsqueezy/variants/:id` (admin-guarded) proxies to LS's `getVariant` + `getProduct` and returns a normalized `LookedUpVariant`. Used by the register-app + plans modal to pre-fill plan details and catch wrong-product-type mistakes early.
- **Refunds against LS** require an explicit `amount` (the SDK's `issueOrderRefund(orderId, amount)` doesn't take a "full refund" sentinel). Pass the original order total for full refunds.
- **LS webhook signature** is `X-Signature: <hex>` where `<hex>` is HMAC-SHA256 of the raw body using `LEMONSQUEEZY_WEBHOOK_SECRET`. The adapter verifies with `timingSafeEqual`.
- **LS test mode:** controlled by `LEMONSQUEEZY_TEST_MODE` (defaults to `true`). When `true`, checkouts are created in LS's sandbox.
- **Xendit replaces Paymongo (2026-05-18).** [XenditAdapter](apps/payment-gateway/src/payment-providers/xendit.adapter.ts) uses Xendit's **Invoice API** for one-time payments — gives a hosted checkout that accepts cards + GCash + Maya + GrabPay + bank transfer + OTC in one URL. Xendit expects amounts in **MAJOR units** (e.g. 299, not 29900) — the adapter divides by 100 before each call.
- **Xendit subscriptions are deferred.** The xendit-node v7 SDK has no first-class subscription module. Recurring requires saving a `PaymentMethod` with `reusability: 'MULTIPLE_USE'` and triggering `PaymentRequest`s on a scheduler — Slice 4 work. The adapter throws "Xendit subscriptions are not yet supported" for `createSubscription` / `getSubscription` / `cancelSubscription` / etc.
- **Xendit webhook verification** is a static token compare: `x-callback-token` header must equal `XENDIT_WEBHOOK_TOKEN` env var. Not HMAC — Xendit doesn't sign payloads.
- **Refunds against Xendit:** the stored `providerTxId` is the invoice id. Refunds need the underlying `payment_id` — the adapter fetches the invoice first to resolve it.

## Key files when extending

```
apps/payment-gateway/src/
  main.ts                                          # CORS, ValidationPipe, Swagger, raw body
  app/app.module.ts                                # imports every feature module
  database/
    data-source.ts                                 # TypeORM config (used by CLI + Nest)
    entities/                                      # 8 entities
    migrations/                                    # hand-written, not generated
    seed-admin.ts                                  # `npm run seed:admin`
  auth/
    api-key.guard.ts          ApiKeyGuard         # for /v1/* routes (apps)
    admin.guard.ts            AdminGuard          # for /admin/* routes (operator)
    admin-auth.controller.ts                      # POST /admin/auth/login + GET /me
  common/
    crypto.ts                                      # SHA-256, HMAC, AES-256-GCM, scrypt, JWT
    services/
      transaction-logger.service.ts               # writes transaction_logs rows
      metadata-validator.service.ts               # enforces app's required metadata schema
      webhook-delivery.service.ts                 # signs + POSTs to app's webhook URL
      payment-reconciler.service.ts               # syncs from provider + delivers missed webhook
  modules/
    apps/                                          # admin: register, list, regenerate keys
    stats/                                         # admin: dashboard stats + provider health
    transactions/                                  # admin: list, detail, refund, sync
    subscriptions/                                 # admin (list/detail/cancel/pause/resume) + app-facing (CRUD + cancel/pause/resume)
    plans/                                         # admin CRUD + app-facing read-only list
    customers/                                     # admin + app-facing
    webhook-events/                                # admin: list, detail, retry, stats
    activity-logs/                                 # admin: read-only feed of transaction_logs
    notifications/                                 # synthesized from webhooks + tx logs
    payments/                                      # app-facing: POST/GET/list/refund/sync
    webhooks/                                      # public receivers: lemonsqueezy + xendit (handles payment AND subscription events)
  payment-providers/
    provider.types.ts                              # PaymentProvider interface
    lemonsqueezy.adapter.ts                        # uses LS Checkouts + customPrice override
    xendit.adapter.ts                              # uses Xendit Invoice API for one-time; subs deferred to Slice 4

apps/payment-admin/src/
  app/                              # Next.js App Router — real file-based routes
    layout.tsx                      # root: html/body, fonts, AuthProvider
    login/page.tsx                  # /login
    (admin)/                        # route group — auth-gated, wraps Sidebar
      layout.tsx                    # auth gate + Sidebar
      page.tsx                      # / → DashboardPage
      apps/page.tsx                 # /apps
      apps/[id]/page.tsx            # /apps/<id>
      apps/register/page.tsx        # /apps/register
      apps/integrate/page.tsx       # /apps/integrate
      transactions/page.tsx         # /transactions (?app=<id> for filter)
      transactions/[id]/page.tsx
      subscriptions/{page,[id]/page}.tsx
      plans/page.tsx
      customers/page.tsx
      webhooks/{page,[id]/page}.tsx
      logs/page.tsx
      notifications/page.tsx
  admin/
    navigate.ts                     # useNavigate() — RoutePage → router.push translator
    layout.tsx                      # Sidebar (usePathname active, <Link> nav), Topbar
    api/client.ts                   # typed fetch wrapper, Bearer token, 401 → logout
    api/use-fetch.ts                # hand-rolled SWR-ish hook
    auth/auth-context.tsx           # localStorage-backed token + user
    pages/                          # one component per page; route files thin-wrap them
    pages/integrate.tsx             # plain-English integration guide for app developers
```

## Slice status (where we are in the build)

- ✅ **Slice 1 — Foundation:** Schema, auth, apps admin, all admin endpoints (stats, transactions, subs, customers, webhooks, logs, notifications), Swagger.
- ✅ **Slice 2 — App-facing surface:** `/v1/payments` (create, get, list, refund, sync), `/v1/customers` (upsert, get), `/v1/webhooks/{lemonsqueezy,xendit}` receivers with HMAC-signed outbound delivery (synchronous for now). Real Lemon Squeezy + Xendit SDKs wired.
- ✅ **Frontend integration:** payment-admin reads everything from real API; mock data deleted. Login page + auth guard.
- ✅ **Slice 3 — Subscriptions:** Plans CRUD (`/admin/plans` + `/v1/plans` read-only), `/v1/subscriptions` (create/get/list/cancel/pause/resume), `/admin/subscriptions/:id/{cancel,pause,resume}`, LS subscription webhook handling (subscription_created, _updated, _cancelled, _resumed, _paused, _expired, _payment_success/_failed/_recovered/_refunded), Plans admin UI page with register-plan modal, Subscription detail buttons wired to real API.
- ✅ **Slice 3.5 — App billing modes (2026-05-17):** Apps got a mutually-exclusive `billingMode` (`subscription` | `one_time`). One-time-payment routing by country (PH → Paymongo, else → LS) was wired. **Reverted later the same day** — see Slice 3.6.
- ✅ **Slice 3.6 — Subscription-only simplification (2026-05-17):** Per user feedback ("I'm getting confused"), the one-time payment path was removed: `POST /v1/payments` deleted, country-based routing helper removed, Register App page no longer asks for a billing mode (every app is subscription), Apps page no longer shows a billing-mode badge, `LEMONSQUEEZY_VARIANT_ID` removed from `.env.example`. Underlying schema kept (`apps.billing_mode`, `plans.country`, `customers.country`, `transactions.country`) so one-time can be re-introduced later without a migration. `GET /v1/payments`, `/v1/payments/:id`, refund, and sync still work — they operate on the subscription-payment Transactions created by webhooks.
- ✅ **Slice 3.7 — Xendit swap (2026-05-18):** Paymongo entirely replaced by Xendit. Xendit handles one-time payments via Invoice API (cards + GCash + Maya + GrabPay + bank transfer + OTC in one hosted checkout). Subscriptions throw "not supported" — same shape Paymongo had — because xendit-node v7 has no first-class Recurring module. Migration `1747000400000-XenditSwap` swaps the enum and renames the customers column.
- ✅ **Slice 4a — Worker foundation (2026-05-19):** Bull + Redis wired (`@nestjs/bull` + `ioredis`, defaults to `redis://localhost:6379`, override with `REDIS_URL`). The `payment-worker` Nx app is no longer a scaffold — it's a real NestJS app that imports the gateway's `DatabaseModule` + `CommonServicesModule` and registers three processors: **WebhookDeliveryProcessor**, **ReconcileStaleProcessor**, and **SubscriptionBillingProcessor**. Gateway-side, `WebhookDeliveryService.deliver` is no longer called synchronously — `WebhooksService`, `PaymentReconcilerService`, and `WebhookEventsAdminService.retry` now go through `WebhookDeliveryQueueService.enqueue` and return immediately.
- ✅ **Slice 4b — Xendit recurring (2026-05-19):** Customer entity gained `xenditPaymentMethodId` + `xenditPaymentMethodStatus` (migration `1747000500000-XenditPaymentMethod`). `XenditAdapter.createSubscription` now creates an Invoice with `should_save_payment_methods=true` for the first cycle — when the customer pays, Xendit fires `invoice.paid` with `payment_method_id`, the webhook handler saves that PM on the AcePay Customer and enqueues cycle 2 on the `subscription-billing` queue. `SubscriptionBillingProcessor` (in worker) drains that queue: loads sub/customer/plan, calls `XenditAdapter.chargeWithPaymentMethod` (uses `PaymentRequest.createPaymentRequest` against the saved PM), records a `subscription_payment` Transaction, advances `currentPeriodEnd`, and schedules the next cycle. On failure: marks sub `past_due` and emits `subscription.payment_failed` webhook (no Bull retry — failed payments aren't retried at the queue level, only via smart-retry which is a follow-up). Cancel via `/v1/subscriptions/:id/cancel` now removes queued billing jobs through `SubscriptionBillingQueueService.cancel`. Pause/resume still throw (Slice 4c).
- ⏳ **Slice 4c — E-wallet PaymentMethod link flow (next):** Extend the link/save flow to GCash / Maya / GrabPay. Today, cards work via the implicit "first invoice with should_save_payment_methods=true" flow; e-wallets need a separate `PaymentMethod.createPaymentMethod` call with `type=EWALLET` + customer-facing authorization URL (different UX from cards). Will also add pause/resume support by interleaving with the billing queue.

## When something doesn't load

The dashboard's "Internal server error" and similar are almost always:
1. Postgres on the wrong port → check `apps/payment-gateway/.env`.
2. New entity column without `type:` declaration → see TypeORM gotcha above.
3. New `orderBy` using a snake_case column name → use property name.
4. New module imported but its `AuthModule` or `CommonServicesModule` isn't imported.
5. Forgot to add `@UseGuards(AdminGuard)` on a new admin controller.

Dashboards live at:
- Swagger: `http://localhost:4001/docs`
- Admin: `http://localhost:4000`
