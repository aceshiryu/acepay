import { Provider } from './api/types';

/**
 * Per-provider identity. The colours themselves live in global.css under
 * `[data-provider="…"]`, which remaps the `--accent*` tokens every primitive
 * already reads — so wrapping a subtree in `data-provider` re-themes it.
 */
export interface ProviderTheme {
  id: Provider;
  label: string;
  short: string;
  /** Solid brand colour (CSS var), for header bands and badges. */
  brand: string;
  /** Text colour that is readable on `brand`. */
  onBrand: string;
  soft: string;
  ink: string;
  bestFor: string;
  dashboardUrl: string;
}

export const PROVIDERS: Provider[] = ['lemonsqueezy', 'xendit', 'paymongo'];

export const PROVIDER_THEME: Record<Provider, ProviderTheme> = {
  lemonsqueezy: {
    id: 'lemonsqueezy', label: 'Lemon Squeezy', short: 'LS',
    brand: 'var(--brand-lemon)', onBrand: 'var(--lemon-on)',
    soft: 'var(--lemon-bg)', ink: 'var(--lemon-ink)',
    bestFor: 'International card subscriptions. LS is the merchant of record and handles tax.',
    dashboardUrl: 'https://app.lemonsqueezy.com',
  },
  xendit: {
    id: 'xendit', label: 'Xendit', short: 'X',
    brand: 'var(--brand-xendit)', onBrand: '#FFFFFF',
    soft: 'var(--xendit-bg)', ink: 'var(--xendit-ink)',
    bestFor: 'PH subscriptions with cards, GCash, Maya and more. Supports marketplace payouts.',
    dashboardUrl: 'https://dashboard.xendit.co',
  },
  paymongo: {
    id: 'paymongo', label: 'PayMongo', short: 'PM',
    brand: 'var(--brand-paymongo)', onBrand: '#FFFFFF',
    soft: 'var(--paymongo-bg)', ink: 'var(--paymongo-ink)',
    bestFor: 'PH subscriptions billed by PayMongo itself. PHP only.',
    dashboardUrl: 'https://dashboard.paymongo.com',
  },
};

export function providerTheme(p: string | null | undefined): ProviderTheme | null {
  return p && p in PROVIDER_THEME ? PROVIDER_THEME[p as Provider] : null;
}

export function providerLabel(p: string | null | undefined): string {
  return providerTheme(p)?.label ?? (p || '—');
}
