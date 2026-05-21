'use client';

import React, { ReactNode } from 'react';
import { API_BASE_URL } from '../api/client';
import { PageShell } from '../layout';
import { Button, Card, Icon } from '../primitives';
import { CodeBlock } from '../shared';
import { Navigate } from '../types';

type Mode = 'test' | 'live';

export function IntegrationGuidePage({ onNavigate, onBack }: { onNavigate: Navigate; onBack: () => void }) {
  const [mode, setMode] = React.useState<Mode>('test');

  const apiKey = mode === 'live'
    ? 'pk_live_yourapp_8f3kJq2nP9bV4xT7mR1cWzS6aL5dE0gH'
    : 'pk_test_yourapp_a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuV';

  return (
    <PageShell
      title="How to use AcePay"
      breadcrumbs={[{ label: 'Apps', onClick: onBack }, { label: 'Integration' }]}
      actions={
        <Button variant="secondary" size="md" leading={<Icon name="ext" size={12} />}
          onClick={() => window.open(`${API_BASE_URL}/docs`, '_blank')}>
          See full API reference
        </Button>
      }
    >
      <div style={{ maxWidth: 880, display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* Hero */}
        <Card padding={26} style={{ background: 'var(--surface-2)' }}>
          <div className="serif" style={{ fontSize: 28, letterSpacing: -0.5, lineHeight: 1.15 }}>
            Take recurring subscription payments without touching the payment providers.
          </div>
          <p style={{ fontSize: 14, color: 'var(--ink-2)', marginTop: 12, lineHeight: 1.65 }}>
            Your app talks to AcePay. AcePay talks to Lemon Squeezy (international) or
            Xendit (Philippines). When the customer subscribes, the provider bills them on
            schedule — and AcePay tells your app each time a payment clears (or fails).
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
            You never run a billing cron. You never store a card. You never call the providers directly.
          </p>
        </Card>

        {/* Visual diagrams */}
        <DiagramsCard />

        {/* Big-picture flow */}
        <Card title="Here's what happens, start to finish" padding={0}>
          <div style={{ padding: '18px 22px 22px' }}>
            <FlowStep n={1} label="Operator registers plans in AcePay" detail="One-time setup: register your app + its subscription plans (e.g. Pro Monthly ₱299, Pro Annual ₱2,990). Each plan picks a provider — Lemon Squeezy or Xendit." />
            <FlowStep n={2} label="Customer wants to subscribe" detail="They click a 'Subscribe' button in your app." />
            <FlowStep n={3} label="Your app calls AcePay" detail="One POST with the plan ID, the customer ID, and where to send the customer back. AcePay routes to whichever provider the plan uses." />
            <FlowStep n={4} label="AcePay returns a checkout link" detail="A URL hosted by the provider where the customer enters their card (LS) or picks a payment method (Xendit — card / GCash / Maya / GrabPay / bank / OTC)." />
            <FlowStep n={5} label="Customer pays for the first time" detail="The provider collects the card or wallet token, saves it for future renewals, and redirects back to your success URL." />
            <FlowStep n={6} label="AcePay tells your app the subscription is live" detail="A POST to your webhook URL: 'subscription.created' with all your original metadata." />
            <FlowStep n={7} label="Every month / year, the subscription auto-renews" detail="For LS: LS bills automatically. For Xendit: AcePay's worker charges the saved card. Either way, you get 'subscription.payment_succeeded' on your webhook." />
            <FlowStep n={8} label="When the customer cancels, you call AcePay" detail="AcePay tells the provider (or just stops scheduling, for Xendit). Access continues until the end of the paid period." last />
          </div>
        </Card>

        {/* Mode toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Toggle
            label="Show examples for"
            options={[
              { value: 'test', label: 'Test mode' },
              { value: 'live', label: 'Live mode' },
            ]}
            value={mode}
            onChange={(v) => setMode(v as Mode)}
          />
          <ModeBanner mode={mode} />
        </div>

        {/* Step 1 — Get your keys */}
        <Section
          number={1}
          title="Get your two keys"
          subtitle="One unlocks the API, one proves messages from us are really from us."
        >
          <p style={{ ...prose }}>
            Click <button onClick={() => onNavigate('register-app')} style={linkBtn}>Register App</button>.
            You&apos;ll be asked to add your subscription plans inline (see step 2). When you save, AcePay shows you two strings:
          </p>
          <ul style={{ ...list }}>
            <li>
              <strong>API key</strong> — like a password. Send it on every request to AcePay.
              <br />
              <code className="mono" style={code}>{apiKey}</code>
            </li>
            <li>
              <strong>Webhook secret</strong> — used to confirm that messages we send to your app
              actually came from us, not someone pretending. We&apos;ll use it in step 6.
            </li>
          </ul>
          <Callout icon="warn">
            <strong>You only see them once.</strong> Save them in your app&apos;s secrets manager
            (env vars, Vault, AWS Secrets Manager, etc.) — there&apos;s no way to look them up later.
          </Callout>
          <p style={{ ...prose, marginTop: 4 }}>
            Two flavors of keys:
          </p>
          <ul style={{ ...list }}>
            <li><code className="mono">pk_test_…</code> uses <strong>test mode</strong> — fake card numbers, no real money. Use this while you&apos;re building.</li>
            <li><code className="mono">pk_live_…</code> uses <strong>live mode</strong> — real customers, real money. Use this once you&apos;ve tested everything.</li>
          </ul>
        </Section>

        {/* Step 2 — Plans setup (operator side) */}
        <Section
          number={2}
          title="Set up your subscription plans"
          subtitle="One-time operator setup in the AcePay dashboard — your app never touches this."
        >
          <p style={{ ...prose }}>
            Before your customers can subscribe to anything, you (the operator) need to tell AcePay what your plans are.
            The flow differs slightly per provider.
          </p>
          <Callout icon="info">
            <strong>If you already added plans during app registration, skip to step 3.</strong> This section is for
            adding plans to an existing app or understanding how the setup works.
          </Callout>

          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginTop: 4 }}>
            For Lemon Squeezy plans
          </div>
          <ol style={{ ...list, paddingLeft: 22 }}>
            <li>
              <strong>In Lemon Squeezy:</strong> create a new product (Products → New product), pick
              <strong> Subscription</strong> pricing, set the price + interval (monthly or yearly), save.
              Click into the variant and copy the variant ID from the URL.
            </li>
            <li>
              <strong>In AcePay:</strong> go to <button onClick={() => onNavigate('plans')} style={linkBtn}>Plans</button> →
              click <strong>Add Plan</strong> → pick <em>Lemon Squeezy</em> → fill in title,
              paste the variant ID → click <strong>Verify</strong> → AcePay fetches the
              price/currency/interval from LS and pre-fills everything.
            </li>
            <li>Save. The AcePay plan id is what your app will reference.</li>
          </ol>
          <Callout icon="info">
            <strong>If the LS variant&apos;s price ever changes,</strong> open the plan in AcePay and click
            <strong> Verify</strong> — AcePay re-syncs from Lemon Squeezy. Existing subscriptions keep
            their original price; only new subscriptions use the updated values.
          </Callout>

          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginTop: 14 }}>
            For Xendit plans
          </div>
          <ol style={{ ...list, paddingLeft: 22 }}>
            <li>
              <strong>Nothing to do in Xendit.</strong> Xendit doesn&apos;t have a plan resource —
              AcePay manages the schedule. Skip straight to AcePay.
            </li>
            <li>
              <strong>In AcePay:</strong> <button onClick={() => onNavigate('plans')} style={linkBtn}>Plans</button> →
              <strong> Add Plan</strong> → pick <em>Xendit</em> → enter title, amount, currency, interval directly.
            </li>
            <li>Save. The AcePay plan id is what your app references.</li>
          </ol>
          <Callout icon="info">
            <strong>For Xendit, the AcePay plan IS the source of truth.</strong> Change the price in AcePay
            and the next renewal charges the new amount automatically — no re-sync needed.
          </Callout>
        </Section>

        {/* Step 3 — List plans */}
        <Section
          number={3}
          title="Show pricing in your app"
          subtitle="GET /v1/plans returns the plans you registered, so your app can render a pricing page."
        >
          <CodeBlock>{`// In your backend
const response = await fetch('${API_BASE_URL}/v1/plans', {
  headers: { 'x-api-key': '${apiKey}' },
});

const { data: plans } = await response.json();
// plans → [{ id, name, amount, currency, interval, description, country, ... }]

// Render them on your /pricing page however you like.
// Example: filter by country if you have region-specific plans.
const phPlans = plans.filter(p => p.country === 'PH' || p.country === null);`}</CodeBlock>
          <p style={{ ...prose }}>
            You can also fetch a single plan with <code className="mono">GET /v1/plans/&#123;id&#125;</code> if you only need one.
          </p>
        </Section>

        {/* Step 4 — Customer */}
        <Section
          number={4}
          title="Create the customer in AcePay"
          subtitle="Before someone subscribes, AcePay needs to know who they are."
        >
          <p style={{ ...prose }}>
            For each user that&apos;s about to subscribe, register them with AcePay first. If you call
            this for a user that already exists (matched by your <code className="mono">externalId</code>),
            AcePay just returns the existing customer — safe to call repeatedly.
          </p>
          <CodeBlock>{`const customer = await fetch('${API_BASE_URL}/v1/customers', {
  method: 'POST',
  headers: {
    'x-api-key': '${apiKey}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    externalId: 'user_42',         // your app's user id (whatever format)
    email: 'jane@example.com',
    name: 'Jane Doe',
  }),
}).then(r => r.json());

// customer.id is the AcePay UUID — save this with the user record in your DB.
const acepayCustomerId = customer.id;`}</CodeBlock>
        </Section>

        {/* Step 5 — Create subscription */}
        <Section
          number={5}
          title="Start the subscription"
          subtitle="POST /v1/subscriptions. AcePay returns a checkoutUrl — that's where you send the customer."
        >
          <p style={{ ...prose }}>
            This is where your customer commits to a plan. AcePay creates the subscription record, generates a
            Lemon Squeezy checkout, and returns the URL you redirect to.
          </p>
          <CodeBlock>{`const { subscription, checkoutUrl } = await fetch(
  '${API_BASE_URL}/v1/subscriptions',
  {
    method: 'POST',
    headers: {
      'x-api-key': '${apiKey}',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      planId:     'plan_uuid_for_pro_monthly',   // from step 3
      customerId: acepayCustomerId,              // from step 4
      redirect: {
        success: 'https://yourapp.com/subscribe/success',
        failed:  'https://yourapp.com/subscribe/canceled',
      },
      metadata: {                                // anything — comes back in webhooks
        user_id: 'user_42',
        promo:   'spring_sale',
      },
    }),
  }
).then(r => r.json());

// subscription.id is the AcePay UUID. Save it on the user record.
// Then send them to checkout:
res.redirect(checkoutUrl);`}</CodeBlock>
          <Callout icon="info">
            <strong>The subscription doesn&apos;t bill immediately.</strong> It&apos;s in an
            &quot;awaiting first payment&quot; state until the customer completes checkout. The flag
            <code className="mono"> metadata.awaitingFirstPayment </code> clears automatically when the
            provider confirms the first charge via webhook (step 6).
          </Callout>
          <Callout icon="info">
            <strong>Your app doesn&apos;t need to know which provider it&apos;s using.</strong> AcePay
            picks the provider from the plan you reference and gives you back a <code className="mono">checkoutUrl</code>.
            Lemon Squeezy and Xendit hosted checkouts look different to your customer, but the API contract
            here is identical.
          </Callout>
          <p style={{ ...prose }}>
            <strong>Mobile apps:</strong> the <code className="mono">redirect</code> URLs can be deep links
            (<code className="mono">yourapp://subscribe/success</code>) so the browser bounces back into
            your app after payment. Just make sure your deep-link handler is set up.
          </p>
        </Section>

        {/* Step 6 — Listen for webhooks */}
        <Section
          number={6}
          title="Listen for AcePay to call you back"
          subtitle="Every important subscription moment — first payment, renewals, failures, cancels — POSTs to your webhook URL."
        >
          <p style={{ ...prose }}>
            Set the webhook URL when you registered your app. AcePay POSTs a JSON body like this:
          </p>
          <CodeBlock>{`{
  "event": "subscription.payment_succeeded",  // see all events below
  "subscription_id": "sub_abc123…",           // AcePay subscription id
  "transaction_id":  "tx_def456…",            // this billing cycle's transaction
  "provider": "lemonsqueezy",
  "amount": 29900,                            // smallest unit (centavos)
  "currency": "PHP",
  "metadata": {                               // what you sent in step 5
    "user_id": "user_42",
    "promo":   "spring_sale"
  },
  "timestamps": {
    "created_at": "2026-06-17T08:00:00Z",
    "provider_completed_at": "2026-06-17T08:00:00Z",
    "webhook_received_at":   "2026-06-17T08:00:01Z"
  }
}`}</CodeBlock>

          <p style={{ ...prose }}>
            <strong>The events you&apos;ll receive:</strong>
          </p>
          <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <EventRow event="subscription.created" when="First payment cleared" todo="Unlock the feature for the user" />
            <EventRow event="subscription.payment_succeeded" when="Every successful renewal" todo="Extend access for another period" />
            <EventRow event="subscription.payment_failed" when="A renewal failed" todo="Notify the user; LS will auto-retry — don't revoke yet" />
            <EventRow event="subscription.past_due" when="LS gave up after several retries" todo="Soft-degrade access; ask the user to update their card" />
            <EventRow event="subscription.paused" when="Subscription paused (operator or LS)" todo="Decide whether to pause access too" />
            <EventRow event="subscription.resumed" when="Paused sub came back" todo="Re-enable access" />
            <EventRow event="subscription.canceled" when="Cancel requested" todo="Schedule revoke at end of period (access continues until then)" />
            <EventRow event="subscription.expired" when="Final period ended after cancel" todo="Revoke access" />
            <EventRow event="refund.succeeded" when="A specific billing cycle was refunded" todo="Adjust your records; optionally revoke access" />
          </div>

          <p style={{ ...prose }}>
            <strong>The simplest possible handler:</strong>
          </p>
          <CodeBlock>{`app.post('/webhooks/acepay', express.json(), (req, res) => {
  const ev = req.body;
  const userId = ev.metadata?.user_id;

  switch (ev.event) {
    case 'subscription.created':
    case 'subscription.payment_succeeded':
    case 'subscription.resumed':
      extendAccess(userId, '1 month');
      break;

    case 'subscription.payment_failed':
      notifyUser(userId, "Your card was declined — we'll retry.");
      break;

    case 'subscription.past_due':
      softDegrade(userId);
      notifyUser(userId, 'Subscription past due. Update your card.');
      break;

    case 'subscription.canceled':
    case 'subscription.expired':
      revokeAccess(userId);
      break;
  }

  res.sendStatus(200);
});`}</CodeBlock>

          <div style={{
            background: 'var(--bad-soft)', border: '1px solid var(--bad)',
            borderRadius: 6, padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon name="warn" size={14} color="var(--bad)" />
              <strong style={{ color: 'var(--bad)', fontSize: 13 }}>
                Important: confirm the message is really from us
              </strong>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>
              Anyone could send a fake POST to your webhook URL pretending to be us — and accidentally
              extend free access to users who didn&apos;t pay. Each AcePay request includes a signature you
              compare against your <strong>webhook secret</strong> from step 1. If it doesn&apos;t match,
              reject the request.
            </p>
          </div>
          <CodeBlock>{`import { createHmac, timingSafeEqual } from 'crypto';
import express from 'express';

const app = express();

app.post(
  '/webhooks/acepay',
  express.raw({ type: 'application/json' }),    // raw body required for signature
  (req, res) => {
    // 1. Read the headers AcePay sent
    const timestamp = req.header('x-acepay-timestamp');
    const sentSig   = req.header('x-acepay-signature').replace('sha256=', '');

    // 2. Compute what the signature SHOULD be, using your webhook secret
    const expected = createHmac('sha256', process.env.ACEPAY_WEBHOOK_SECRET)
      .update(\`\${timestamp}.\${req.body}\`)
      .digest('hex');

    // 3. If they don't match, it's a fake — reject
    const matches =
      sentSig.length === expected.length &&
      timingSafeEqual(Buffer.from(sentSig), Buffer.from(expected));

    if (!matches) return res.status(401).send('bad signature');

    // 4. Looks legit — handle the event (see the switch above)
    const ev = JSON.parse(req.body.toString());
    handleEvent(ev);
    res.sendStatus(200);
  },
);`}</CodeBlock>
          <Callout icon="info">
            <strong>Reply within 10 seconds.</strong> If your handler is slow or returns an error,
            AcePay assumes the message didn&apos;t reach you and tries again — up to 5 times. To
            avoid double-processing the same event, check the <code className="mono">x-acepay-event-id</code>
            header and skip it if you&apos;ve seen it before.
          </Callout>
        </Section>

        {/* Step 7 — Cancel / pause / resume */}
        <Section
          number={7}
          title="Cancel, pause, or resume from your app"
          subtitle="One POST. AcePay tells Lemon Squeezy what to do."
        >
          <p style={{ ...prose }}>
            When a customer hits &quot;Cancel my subscription&quot; in your settings page, your app calls:
          </p>
          <CodeBlock>{`// Cancel — scheduled to take effect at the end of the current paid period.
// Customer keeps access until then.
await fetch(
  '${API_BASE_URL}/v1/subscriptions/sub_abc123/cancel',
  {
    method: 'POST',
    headers: { 'x-api-key': '${apiKey}', 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'too expensive' }),
  }
);

// Pause — no billing until resumed; access decision is yours
await fetch(
  '${API_BASE_URL}/v1/subscriptions/sub_abc123/pause',
  { method: 'POST', headers: { 'x-api-key': '${apiKey}' } }
);

// Resume — billing restarts immediately
await fetch(
  '${API_BASE_URL}/v1/subscriptions/sub_abc123/resume',
  { method: 'POST', headers: { 'x-api-key': '${apiKey}' } }
);`}</CodeBlock>
          <p style={{ ...prose }}>
            You don&apos;t need to immediately revoke access on cancel — wait for the
            <code className="mono"> subscription.expired</code> webhook when the paid period ends.
          </p>
          <Callout icon="warn">
            <strong>Pause / resume only work on Lemon Squeezy plans right now.</strong> Xendit
            subscriptions are AcePay-managed, and pause/resume requires interleaving with the billing
            queue (planned for a future slice). Calling pause/resume on a Xendit subscription returns a
            clear error.
          </Callout>
        </Section>

        {/* Step 8 — What if your webhook was down */}
        <Section
          number={8}
          title="What if your server was down when we called?"
          subtitle="Don't worry — AcePay keeps a record of every event and lets you ask 'what's the current state?' any time."
        >
          <p style={{ ...prose }}>
            AcePay automatically retries failed webhook deliveries up to 5 times with exponential backoff.
            For longer outages or paranoid double-checking, your app can poll AcePay directly:
          </p>
          <CodeBlock>{`// What's the current state of this subscription?
const sub = await fetch(
  '${API_BASE_URL}/v1/subscriptions/sub_abc123',
  { headers: { 'x-api-key': '${apiKey}' } }
).then(r => r.json());

if (sub.status === 'active' && !sub.metadata?.awaitingFirstPayment) {
  // ✓ Subscription is live and billing normally
}

// List every billing cycle (one transaction per renewal)
const { data: cycles } = await fetch(
  '${API_BASE_URL}/v1/payments?subscriptionId=sub_abc123',
  { headers: { 'x-api-key': '${apiKey}' } }
).then(r => r.json());

// Or force AcePay to check LS RIGHT NOW for a specific transaction
// and re-send the webhook if anything changed:
await fetch(
  '${API_BASE_URL}/v1/payments/tx_def456/sync',
  { method: 'POST', headers: { 'x-api-key': '${apiKey}' } }
);`}</CodeBlock>
        </Section>

        {/* Step 9 — Refunds */}
        <Section
          number={9}
          title="Refund a specific billing cycle"
          subtitle="Each renewal is a Transaction in AcePay — refund individual cycles, not the whole subscription."
        >
          <CodeBlock>{`// Refund one billing cycle (full amount of that cycle)
await fetch(
  '${API_BASE_URL}/v1/payments/tx_def456/refund',
  {
    method: 'POST',
    headers: { 'x-api-key': '${apiKey}', 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Service outage credit' }),
  }
);`}</CodeBlock>
          <p style={{ ...prose }}>
            When the refund clears (a few minutes to a few hours, depending on the provider),
            AcePay POSTs <code className="mono">refund.succeeded</code> to your webhook with the
            original <code className="mono">transaction_id</code> so you know which cycle it refers to.
          </p>
          <p style={{ ...prose }}>
            <strong>To stop future billing</strong>, also call <code className="mono">/cancel</code>
            (step 7) — refunding alone doesn&apos;t cancel the subscription.
          </p>
        </Section>

        {/* Step 10 — Going live */}
        <Section
          number={10}
          title="Switching from test mode to live mode"
          subtitle="Once everything works with test cards, you're ready for real customers."
        >
          <p style={{ ...prose }}>
            Quick checklist before flipping the switch:
          </p>
          <ol style={{ ...list, paddingLeft: 22 }}>
            <li>You verify the signature on every webhook and reject bad ones (the red callout in step 6).</li>
            <li>Your handler returns 200 for every event type you care about — within 10 seconds.</li>
            <li>You&apos;ve walked through the full flow with test cards: create subscription, first payment succeeds, renewal succeeds, renewal fails, cancel, expire.</li>
            <li>You handle the case where the webhook never arrives (step 8 — sync endpoint).</li>
            <li>
              <strong>Lemon Squeezy plans:</strong> live variants are configured in
              <strong> Subscription</strong> pricing mode (not Single payment, not Pay-what-you-want),
              and AcePay&apos;s plans point at the live variant IDs.
            </li>
            <li>
              <strong>Xendit plans:</strong> your <code className="mono">XENDIT_SECRET_KEY</code> is
              the live key (starts with <code className="mono">xnd_production_</code>) and the worker
              process is running so renewals actually fire.
            </li>
          </ol>
          <p style={{ ...prose }}>
            Then go to your app&apos;s settings, generate a live key, and swap it into your
            production env vars. The first live subscription will appear on the dashboard immediately.
          </p>
        </Section>

        {/* Footer help */}
        <Card padding={20} style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <Icon name="bell" size={18} color="var(--accent)" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                Stuck? Look here first.
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.55 }}>
                Every API call and every webhook delivery is logged. If something doesn&apos;t work,
                the answer is usually right there.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <Button variant="secondary" size="sm" onClick={() => onNavigate('logs')}>
                  Activity Logs
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onNavigate('webhooks')}>
                  Webhook Events
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onNavigate('subscriptions')}>
                  Subscriptions
                </Button>
                <Button variant="secondary" size="sm" leading={<Icon name="ext" size={11} />}
                  onClick={() => window.open(`${API_BASE_URL}/docs`, '_blank')}>
                  Full API reference
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────

const prose: React.CSSProperties = {
  fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.65, margin: 0,
};
const list: React.CSSProperties = {
  fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.7,
  paddingLeft: 22, margin: '4px 0 0', display: 'flex', flexDirection: 'column', gap: 6,
};
const code: React.CSSProperties = {
  fontSize: 11.5, background: 'var(--surface-2)', padding: '2px 6px',
  borderRadius: 4, color: 'var(--ink)',
};
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0,
  color: 'var(--accent)', fontWeight: 550, cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 'inherit', textDecoration: 'underline',
};

function FlowStep({ n, label, detail, last }: { n: number; label: string; detail: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 14, paddingBottom: last ? 0 : 14, position: 'relative' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: 'var(--accent)', color: 'var(--accent-ink)',
        fontSize: 13, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{n}</div>
      {!last && (
        <div style={{
          position: 'absolute', left: 13, top: 32, bottom: -2, width: 2,
          background: 'var(--border)',
        }} />
      )}
      <div style={{ flex: 1, paddingTop: 3 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{label}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.55 }}>
          {detail}
        </div>
      </div>
    </div>
  );
}

function Section({ number, title, subtitle, children }: {
  number: number; title: string; subtitle: string; children: ReactNode;
}) {
  return (
    <Card padding={0}>
      <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 24, height: 24, borderRadius: '50%',
            background: 'var(--accent)', color: 'var(--accent-ink)',
            fontSize: 12, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{number}</span>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6, marginLeft: 34, lineHeight: 1.55 }}>
          {subtitle}
        </div>
      </div>
      <div style={{ padding: '16px 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
    </Card>
  );
}

function Toggle({ label, options, value, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '4px 6px 4px 10px',
    }}>
      <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>
        {label}
      </span>
      <div style={{ display: 'inline-flex', gap: 2 }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              style={{
                padding: '4px 12px', borderRadius: 6, border: 'none',
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? 'var(--accent-ink)' : 'var(--ink-2)',
                fontSize: 12, fontWeight: 550, cursor: 'pointer',
              }}
            >{o.label}</button>
          );
        })}
      </div>
    </div>
  );
}

function ModeBanner({ mode }: { mode: Mode }) {
  return mode === 'test' ? (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 11px', borderRadius: 999,
      background: 'var(--info-soft)', color: 'var(--info)',
      fontSize: 12, fontWeight: 600,
    }}>
      <Icon name="bell" size={12} color="var(--info)" />
      Test mode · no real money
    </span>
  ) : (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 11px', borderRadius: 999,
      background: 'var(--ok-soft)', color: 'var(--ok)',
      fontSize: 12, fontWeight: 600,
    }}>
      <Icon name="check" size={12} color="var(--ok)" strokeWidth={2.4} />
      Live mode · real charges
    </span>
  );
}

function Callout({ icon, children }: { icon: 'info' | 'warn'; children: ReactNode }) {
  const styles = icon === 'warn'
    ? { fg: 'var(--warn)', bg: 'var(--warn-soft)', name: 'warn' as const }
    : { fg: 'var(--accent)', bg: 'var(--accent-soft)', name: 'bell' as const };
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '12px 14px', borderRadius: 6,
      background: styles.bg,
      fontSize: 12.5, lineHeight: 1.6,
    }}>
      <Icon name={styles.name} size={14} color={styles.fg} />
      <div style={{ color: 'var(--ink-2)', flex: 1 }}>{children}</div>
    </div>
  );
}

function EventRow({ event, when, todo }: { event: string; when: string; todo: string }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '220px 1fr 1fr',
      padding: '10px 14px', borderTop: '1px solid var(--hairline)',
      fontSize: 12, alignItems: 'baseline', gap: 12,
    }}>
      <code className="mono" style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>{event}</code>
      <span style={{ color: 'var(--muted)' }}>{when}</span>
      <span style={{ color: 'var(--ink-2)' }}>{todo}</span>
    </div>
  );
}

// ─── Diagrams ─────────────────────────────────────────────────────────────

type DiagramTab = 'flow' | 'architecture' | 'lifecycle';

function DiagramsCard() {
  const [tab, setTab] = React.useState<DiagramTab>('flow');
  const tabs: { id: DiagramTab; label: string; subtitle: string }[] = [
    { id: 'flow',         label: 'Integration flow',     subtitle: 'How a single subscription happens, end-to-end' },
    { id: 'architecture', label: 'System architecture',  subtitle: 'The moving pieces and what talks to what' },
    { id: 'lifecycle',    label: 'Subscription lifecycle', subtitle: 'What happens after the first payment, over time' },
  ];

  return (
    <Card padding={0}>
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--hairline)',
        background: 'var(--surface-2)',
      }}>
        {tabs.map((t) => {
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: '12px 16px', textAlign: 'left',
                background: isActive ? 'var(--surface)' : 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: isActive ? 'var(--ink)' : 'var(--ink-2)' }}>{t.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{t.subtitle}</div>
            </button>
          );
        })}
      </div>

      <div style={{ padding: 22 }}>
        {tab === 'flow'         && <FlowDiagram />}
        {tab === 'architecture' && <ArchitectureDiagram />}
        {tab === 'lifecycle'    && <LifecycleDiagram />}
      </div>
    </Card>
  );
}

// ── Actor pill ────────────────────────────────────────────────────────────

type Actor = 'customer' | 'app' | 'acepay' | 'provider' | 'worker' | 'operator';

const ACTOR_STYLES: Record<Actor, { label: string; bg: string; fg: string }> = {
  customer: { label: 'Customer', bg: '#E7F0FF',           fg: '#1F4FB5' },
  app:      { label: 'Your App', bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  acepay:   { label: 'AcePay',   bg: '#FFF1DE',           fg: '#A2620C' },
  provider: { label: 'Provider', bg: 'var(--surface-2)',  fg: 'var(--ink-2)' },
  worker:   { label: 'Worker',   bg: '#EBE7F4',           fg: '#5851B0' },
  operator: { label: 'Operator', bg: 'var(--ok-soft)',    fg: 'var(--ok)' },
};

function ActorPill({ actor }: { actor: Actor }) {
  const s = ACTOR_STYLES[actor];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: 999,
      background: s.bg, color: s.fg,
      fontSize: 11, fontWeight: 600, lineHeight: 1.4, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

function ArrowRight() {
  return (
    <svg width="16" height="10" viewBox="0 0 16 10" fill="none" aria-hidden>
      <path d="M0 5h13M10 1l4 4-4 4" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Integration flow ──────────────────────────────────────────────────────

interface FlowItem {
  from: Actor;
  to: Actor;
  action: string;
  detail: string;
  phase?: string;
}

function FlowDiagram() {
  const steps: FlowItem[] = [
    { phase: 'One-time setup',
      from: 'operator', to: 'acepay', action: 'Register app + plans', detail: 'Operator clicks Register App in the AcePay admin, gets back an API key and webhook secret, adds subscription plans.' },

    { phase: 'First subscription',
      from: 'customer', to: 'app', action: 'Click "Subscribe"', detail: 'On your pricing page or settings screen.' },
    { from: 'app',      to: 'acepay',   action: 'POST /v1/customers',     detail: 'Upsert the customer by email or externalId. Returns AcePay customer ID.' },
    { from: 'app',      to: 'acepay',   action: 'POST /v1/subscriptions', detail: 'Body: { planId, customerId, redirect: { success, failed } }.' },
    { from: 'acepay',   to: 'provider', action: 'createSubscription',     detail: 'Xendit Invoice with shouldSavePaymentMethods=true, or Lemon Squeezy Checkout. Provider returns a hosted checkout URL.' },
    { from: 'acepay',   to: 'app',      action: 'Returns { checkoutUrl }', detail: 'Your app redirects the customer to this URL.' },
    { from: 'customer', to: 'provider', action: 'Pays on hosted checkout', detail: 'Card · GCash · Maya · GrabPay · bank · OTC (Xendit), or card (LS).' },

    { phase: 'Webhook back to AcePay',
      from: 'provider', to: 'acepay',   action: 'invoice.paid / order_created', detail: 'AcePay saves the payment method on the Customer (Xendit) and enqueues the next billing cycle.' },
    { from: 'acepay',   to: 'app',      action: 'subscription.created (signed webhook)', detail: 'Your app marks the user as subscribed.' },

    { phase: 'Recurring (every cycle, automatic)',
      from: 'worker',   to: 'provider', action: 'PaymentRequest (Xendit only)', detail: 'Worker charges the saved PM. Zero customer touch. Lemon Squeezy bills itself; AcePay just receives the webhook.' },
    { from: 'acepay',   to: 'app',      action: 'payment_succeeded (signed webhook)', detail: 'Update billing UI, send receipt. On failure: payment_failed and sub goes past_due.' },
  ];

  return (
    <div>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          {s.phase && <PhaseHeader label={s.phase} />}
          <FlowRow n={i + 1} item={s} />
        </React.Fragment>
      ))}
    </div>
  );
}

function PhaseHeader({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 4px 8px' }}>
      <span style={{
        fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 0.6, color: 'var(--muted)',
      }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
    </div>
  );
}

function FlowRow({ n, item }: { n: number; item: FlowItem }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '34px 1fr',
      gap: 12, padding: '10px 0',
    }}>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 1 }}>
        <span style={{
          width: 24, height: 24, borderRadius: '50%',
          background: 'var(--surface-2)', color: 'var(--ink-2)',
          fontSize: 11, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid var(--border)',
        }}>{n}</span>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <ActorPill actor={item.from} />
          <ArrowRight />
          <ActorPill actor={item.to} />
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', marginLeft: 4 }}>{item.action}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>{item.detail}</div>
      </div>
    </div>
  );
}

// ── System architecture ───────────────────────────────────────────────────

function ArchitectureDiagram() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <ArchBanner>Customers (web · mobile)</ArchBanner>
      <ArchDownConnector />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <ArchTile actor="app" title="Savi" subtitle="your app" />
        <ArchTile actor="app" title="CourtHub" subtitle="your app" />
        <ArchTile actor="app" title="Vehikol" subtitle="your app" />
      </div>
      <ArchDownConnector label="x-api-key" />
      <ArchBigBox
        actor="acepay"
        title="AcePay Gateway"
        port="NestJS · :4001"
        lines={[
          { mono: '/v1/subscriptions   /v1/customers   /v1/plans' },
          { mono: '/v1/webhooks/{xendit,lemonsqueezy}', note: 'inbound from providers' },
          { mono: '/admin/*', note: 'operator endpoints (used by AcePay Admin)' },
        ]}
      />

      <ArchDownConnector />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <ArchTile actor="data" title="Postgres" subtitle=":5433" footnote="subs · txs · customers · plans" />
        <ArchTile actor="data" title="Redis" subtitle="Bull queues" footnote="webhook-delivery · sub-billing · reconcile" />
        <ArchTile actor="provider" title="Lemon Squeezy" subtitle="API" footnote="international · auto-bills" />
        <ArchTile actor="provider" title="Xendit" subtitle="API" footnote="PH · invoice + PaymentRequest" />
      </div>

      <ArchDownConnector />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ArchBigBox
          actor="worker"
          title="AcePay Worker"
          port="NestJS · Bull consumer"
          lines={[
            { mono: 'WebhookDeliveryProcessor', note: 'outbound webhooks to your app' },
            { mono: 'SubscriptionBillingProcessor', note: 'Xendit recurring charges' },
            { mono: 'ReconcileStaleProcessor', note: 'every 15 min' },
          ]}
        />
        <ArchBigBox
          actor="admin"
          title="AcePay Admin"
          port="Next.js · :4000"
          lines={[
            { mono: 'Operator dashboard' },
            { mono: 'Reads /admin/* on Gateway' },
            { mono: 'No business logic of its own' },
          ]}
        />
      </div>
    </div>
  );
}

const ARCH_COLORS: Record<string, { border: string; bg: string; ink: string; tagBg: string; tagFg: string }> = {
  app:      { border: 'var(--accent)',    bg: 'var(--accent-soft)', ink: 'var(--accent)',   tagBg: 'var(--accent)',  tagFg: 'var(--accent-ink)' },
  acepay:   { border: '#A2620C',          bg: '#FFF1DE',            ink: '#5C3B0A',         tagBg: '#A2620C',        tagFg: '#FFF' },
  data:     { border: 'var(--border)',    bg: 'var(--surface)',     ink: 'var(--ink)',      tagBg: 'var(--surface-2)', tagFg: 'var(--ink-2)' },
  provider: { border: 'var(--border)',    bg: 'var(--surface)',     ink: 'var(--ink)',      tagBg: 'var(--surface-2)', tagFg: 'var(--ink-2)' },
  worker:   { border: '#5851B0',          bg: '#EBE7F4',            ink: '#3A3478',         tagBg: '#5851B0',        tagFg: '#FFF' },
  admin:    { border: 'var(--border)',    bg: 'var(--surface)',     ink: 'var(--ink)',      tagBg: 'var(--surface-2)', tagFg: 'var(--ink-2)' },
};

function ArchBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
      textAlign: 'center', fontWeight: 600, fontSize: 12.5, color: 'var(--ink-2)',
    }}>{children}</div>
  );
}

function ArchTile({ actor, title, subtitle, footnote }: {
  actor: keyof typeof ARCH_COLORS; title: string; subtitle?: string; footnote?: string;
}) {
  const c = ARCH_COLORS[actor];
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 8,
      background: c.bg, border: `1px solid ${c.border}`,
      display: 'flex', flexDirection: 'column', gap: 2, minHeight: 64,
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{subtitle}</div>}
      {footnote && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>{footnote}</div>}
    </div>
  );
}

function ArchBigBox({ actor, title, port, lines }: {
  actor: keyof typeof ARCH_COLORS;
  title: string;
  port: string;
  lines: { mono: string; note?: string }[];
}) {
  const c = ARCH_COLORS[actor];
  return (
    <div style={{
      padding: 0, borderRadius: 8,
      background: c.bg, border: `1px solid ${c.border}`,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${c.border}`,
        background: c.bg,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>{title}</span>
        <span style={{
          fontSize: 10.5, fontWeight: 600,
          padding: '2px 8px', borderRadius: 4,
          background: c.tagBg, color: c.tagFg,
        }}>{port}</span>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <code className="mono" style={{ fontSize: 11.5, color: c.ink }}>{l.mono}</code>
            {l.note && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {l.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ArchDownConnector({ label }: { label?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '6px 0',
    }}>
      <svg width="10" height="22" viewBox="0 0 10 22" fill="none" aria-hidden>
        <path d="M5 0v19M1 16l4 4 4-4" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label && (
        <span style={{
          fontSize: 10.5, fontWeight: 600, color: 'var(--muted)',
          background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 999,
        }}>{label}</span>
      )}
    </div>
  );
}

// ── Subscription lifecycle ────────────────────────────────────────────────

type EventKind = 'in' | 'out' | 'api' | 'db' | 'q' | 'resp' | 'ext' | 'stop' | 'note';

const EVENT_STYLES: Record<EventKind, { label: string; bg: string; fg: string }> = {
  in:   { label: 'WEBHOOK IN',  bg: 'var(--warn-soft)',     fg: '#A66A00' },
  out:  { label: 'WEBHOOK OUT', bg: 'var(--ok-soft)',       fg: 'var(--ok)' },
  api:  { label: 'API CALL',    bg: '#E7F0FF',              fg: '#1F4FB5' },
  db:   { label: 'DB',          bg: 'var(--accent-soft)',   fg: 'var(--accent)' },
  q:    { label: 'QUEUE',       bg: '#EBE7F4',              fg: '#5851B0' },
  resp: { label: 'RESPONSE',    bg: 'var(--surface-2)',     fg: 'var(--ink-2)' },
  ext:  { label: 'EXTERNAL',    bg: 'var(--surface-2)',     fg: 'var(--ink-2)' },
  stop: { label: 'STOP',        bg: 'var(--bad-soft)',      fg: 'var(--bad)' },
  note: { label: 'NOTE',        bg: 'var(--surface-2)',     fg: 'var(--muted)' },
};

interface LifecyclePhase {
  time: string;
  title: string;
  events: { kind: EventKind; text: string }[];
}

function LifecycleDiagram() {
  const phases: LifecyclePhase[] = [
    {
      time: 'T = 0',
      title: 'Customer subscribes',
      events: [
        { kind: 'api',  text: 'App → AcePay: POST /v1/subscriptions' },
        { kind: 'api',  text: 'AcePay → Provider: createSubscription (Xendit Invoice w/ shouldSavePaymentMethods=true, or LS Checkout)' },
        { kind: 'db',   text: 'subscriptions row: status=active, metadata.awaitingFirstPayment=true' },
        { kind: 'resp', text: 'AcePay → App: { checkoutUrl }' },
        { kind: 'ext',  text: 'Customer pays on provider hosted checkout' },
      ],
    },
    {
      time: 'T = 0+',
      title: 'Provider fires invoice.paid (within seconds of payment)',
      events: [
        { kind: 'in',  text: 'Provider → AcePay: POST /v1/webhooks/xendit' },
        { kind: 'db',  text: 'Customer.xenditPaymentMethodId saved — KEY for recurring' },
        { kind: 'db',  text: 'Subscription.currentPeriodEnd = T0 + plan.interval' },
        { kind: 'q',   text: 'Bull enqueue: SubscriptionBillingProcessor (delay = interval)' },
        { kind: 'out', text: 'AcePay → App: signed webhook subscription.payment_succeeded' },
      ],
    },
    {
      time: 'T = interval',
      title: 'Worker auto-charges (no customer action)',
      events: [
        { kind: 'q',   text: 'Worker drains the queued billing job' },
        { kind: 'api', text: 'Xendit.chargeWithPaymentMethod (uses saved PM)' },
        { kind: 'db',  text: 'On success: subscription_payment Transaction · advance currentPeriodEnd · enqueue next cycle' },
        { kind: 'db',  text: 'On failure: sub.status = past_due (no auto-retry today)' },
        { kind: 'out', text: 'AcePay → App: signed webhook (payment_succeeded | payment_failed)' },
      ],
    },
    {
      time: 'T = 2·interval, 3·interval, …',
      title: 'Self-perpetuating loop',
      events: [
        { kind: 'note', text: 'Repeats forever — every successful charge schedules the next one. Until one of:' },
        { kind: 'stop', text: 'Customer cancels → DELETE /v1/subscriptions/:id (queued jobs cleared)' },
        { kind: 'stop', text: 'A charge fails → status=past_due, loop stops' },
        { kind: 'stop', text: 'Provider revokes the PM → next charge fails, loop stops' },
      ],
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {phases.map((p, i) => (
        <LifecyclePhaseBlock key={p.time} phase={p} isLast={i === phases.length - 1} />
      ))}

      <div style={{
        marginTop: 18, padding: '10px 14px',
        background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        fontSize: 11, color: 'var(--muted)',
      }}>
        <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>Legend:</span>
        {(Object.keys(EVENT_STYLES) as EventKind[]).map((k) => (
          <EventBadge key={k} kind={k} />
        ))}
      </div>
    </div>
  );
}

function LifecyclePhaseBlock({ phase, isLast }: { phase: LifecyclePhase; isLast: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', columnGap: 18 }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        paddingTop: 4, position: 'relative',
      }}>
        <code className="mono" style={{
          fontSize: 11.5, fontWeight: 700, color: 'var(--ink)',
          background: 'var(--surface-2)', padding: '4px 10px', borderRadius: 4,
        }}>{phase.time}</code>
      </div>
      <div style={{
        position: 'relative', paddingLeft: 18, paddingBottom: isLast ? 0 : 18,
        borderLeft: isLast ? 'none' : '2px solid var(--hairline)',
      }}>
        <span style={{
          position: 'absolute', left: -7, top: 8,
          width: 12, height: 12, borderRadius: '50%',
          background: 'var(--accent)', border: '2px solid var(--surface)',
        }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>{phase.title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {phase.events.map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <EventBadge kind={e.kind} />
              <span style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.55, flex: 1 }}>{e.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EventBadge({ kind }: { kind: EventKind }) {
  const s = EVENT_STYLES[kind];
  return (
    <span style={{
      flexShrink: 0,
      fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4,
      padding: '2px 7px', borderRadius: 3,
      background: s.bg, color: s.fg,
      marginTop: 2, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

