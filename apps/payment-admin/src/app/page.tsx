'use client';

import React from 'react';
import Link from 'next/link';
import { AceLogo, Icon } from '../admin/primitives';

export default function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <TopNav />
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '64px 28px 96px' }}>
        <Hero />
        <Features />
        <HowItWorks />
        <CtaBlock />
      </main>
      <Footer />
    </div>
  );
}

function TopNav() {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: 'var(--bg)', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        maxWidth: 1080, margin: '0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 28px',
      }}>
        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          color: 'var(--ink)', textDecoration: 'none',
        }}>
          <AceLogo size={22} />
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: -0.2 }}>AcePay</span>
        </Link>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <Link href="/how-to-use" style={navLink}>How to use AcePay</Link>
          <Link href="/login" style={{
            ...navLink,
            background: 'var(--ink)', color: 'var(--bg)',
            padding: '7px 14px', borderRadius: 6,
          }}>
            Admin sign-in
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section style={{ paddingTop: 32, paddingBottom: 56 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999,
        background: 'var(--accent-soft)', color: 'var(--accent)',
        fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4,
      }}>
        <Icon name="check" size={11} strokeWidth={2.6} />
        Central payment gateway
      </span>
      <h1
        className="serif"
        style={{
          margin: '20px 0 18px',
          fontSize: 56, lineHeight: 1.05, letterSpacing: -1.2,
          color: 'var(--ink)', maxWidth: 820,
        }}
      >
        One billing layer for every app you ship.
      </h1>
      <p style={{
        margin: 0, fontSize: 17, lineHeight: 1.6,
        color: 'var(--ink-2)', maxWidth: 640,
      }}>
        AcePay sits between your apps and the payment providers. You hold a single
        Lemon Squeezy + Xendit account, your apps hit one tidy API, and if you ever
        switch providers — nothing in your app code changes.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 28, flexWrap: 'wrap' }}>
        <Link href="/how-to-use" style={ctaPrimary}>
          Read the integration guide
          <Icon name="arrow" size={12} strokeWidth={2.4} />
        </Link>
        <Link href="/login" style={ctaSecondary}>
          Admin sign-in
        </Link>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section style={{ paddingTop: 24, paddingBottom: 48 }}>
      <SectionLabel>What you get</SectionLabel>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 18,
      }}>
        <Feature
          icon="sub"
          title="Subscription billing, end-to-end"
          body="Plans, signups, renewals, retries, cancels, refunds — one API. Webhooks tell your app every time something changes."
        />
        <Feature
          icon="apps"
          title="Multi-provider routing"
          body="Lemon Squeezy for international cards (MoR for tax). Xendit for the Philippines (cards + GCash + Maya + GrabPay + bank + OTC). Picked per plan, invisible to your app."
        />
        <Feature
          icon="hook"
          title="Signed webhooks, with retries"
          body="Every event your app receives is HMAC-signed. Failed deliveries retry up to 5 times automatically — and a sync endpoint lets you reconcile anytime."
        />
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps: { n: number; title: string; body: string }[] = [
    {
      n: 1,
      title: 'Register your app + plans',
      body: 'One-time setup in the admin dashboard. Add the plans you want to offer (Lemon Squeezy variants or Xendit-priced). Get an API key and a webhook secret.',
    },
    {
      n: 2,
      title: 'Start a subscription from your app',
      body: 'POST /v1/subscriptions with the plan id and the customer\'s details. AcePay creates (or reuses) the customer, asks the provider for a checkout URL, and returns it.',
    },
    {
      n: 3,
      title: 'Send the customer to checkout',
      body: 'Redirect them to the checkoutUrl. The provider collects the card or wallet token. AcePay handles the rest — renewals, retries, cancellations.',
    },
    {
      n: 4,
      title: 'Receive signed webhooks',
      body: 'Every billing event POSTs to your webhook URL: subscription.created, payment_succeeded, payment_failed, refund.succeeded, and more.',
    },
  ];

  return (
    <section style={{ paddingTop: 24, paddingBottom: 56 }}>
      <SectionLabel>How it works</SectionLabel>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {steps.map((s, i) => (
          <div key={s.n} style={{
            display: 'grid', gridTemplateColumns: '52px 1fr',
            padding: '20px 0',
            borderTop: i === 0 ? '1px solid var(--hairline)' : 'none',
            borderBottom: '1px solid var(--hairline)',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--ink)', color: 'var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700,
            }}>{s.n}</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{s.title}</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.6 }}>
                {s.body}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18 }}>
        <Link href="/how-to-use" style={{
          color: 'var(--accent)', textDecoration: 'none', fontWeight: 550, fontSize: 13.5,
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          Read the full integration guide
          <Icon name="arrow" size={11} strokeWidth={2.4} />
        </Link>
      </div>
    </section>
  );
}

function CtaBlock() {
  return (
    <section style={{
      marginTop: 24, padding: '40px 36px',
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 12,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 24, flexWrap: 'wrap',
    }}>
      <div style={{ maxWidth: 520 }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 30, letterSpacing: -0.6, lineHeight: 1.15 }}>
          Ready to wire it up?
        </h2>
        <p style={{ margin: '10px 0 0', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          The integration guide walks through the full flow — registering your app, calling the API,
          verifying webhooks, going live — with sample requests and responses for every endpoint.
        </p>
      </div>
      <Link href="/how-to-use" style={ctaPrimary}>
        How to use AcePay
        <Icon name="arrow" size={12} strokeWidth={2.4} />
      </Link>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{
      borderTop: '1px solid var(--border)', padding: '22px 28px',
      color: 'var(--muted)', fontSize: 12,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      maxWidth: 1080, margin: '0 auto',
    }}>
      <div>© {new Date().getFullYear()} AcePay</div>
      <div style={{ display: 'flex', gap: 18 }}>
        <Link href="/how-to-use" style={footerLink}>Integration guide</Link>
        <Link href="/login" style={footerLink}>Admin sign-in</Link>
      </div>
    </footer>
  );
}

function Feature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{
      padding: '20px 22px', borderRadius: 10,
      background: 'var(--surface)', border: '1px solid var(--border)',
      boxShadow: 'var(--shadow-1)',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: 'var(--accent-soft)', color: 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
      }}>
        <Icon name={icon} size={16} color="var(--accent)" strokeWidth={1.8} />
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 6, lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
      color: 'var(--muted)',
    }}>{children}</div>
  );
}

const navLink: React.CSSProperties = {
  fontSize: 13, color: 'var(--ink-2)', textDecoration: 'none', fontWeight: 500,
};

const ctaPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  padding: '11px 18px', borderRadius: 7,
  background: 'var(--ink)', color: 'var(--bg)',
  fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
};

const ctaSecondary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  padding: '11px 18px', borderRadius: 7,
  background: 'transparent', color: 'var(--ink)',
  border: '1px solid var(--border)',
  fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
};

const footerLink: React.CSSProperties = {
  color: 'var(--muted)', textDecoration: 'none',
};
