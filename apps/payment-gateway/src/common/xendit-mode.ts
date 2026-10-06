export type XenditMode = 'test' | 'live' | 'unknown';

/**
 * Test or live, read from the Xendit secret key itself: test keys start
 * `xnd_development_`, live keys `xnd_production_`. AcePay has no separate
 * switch, so the key is the truth — and it is what decides whether money is real.
 */
export function xenditMode(secretKey: string | undefined | null): XenditMode {
  const key = (secretKey ?? '').trim();
  if (key.startsWith('xnd_development_')) return 'test';
  if (key.startsWith('xnd_production_')) return 'live';
  return 'unknown';
}
