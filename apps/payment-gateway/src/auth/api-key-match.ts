/**
 * Pure API-key matching with expiry + rotation grace.
 *
 * An app can hold two keys at once: the current key, and (briefly, during a
 * rotation) the previous key with its own expiry. This lets an operator rotate
 * a key without instantly breaking a running app — the old key keeps working
 * until `apiKeyPreviousExpiresAt`.
 */
export interface KeyMatchable {
  apiKeyHash: string;
  apiKeyExpiresAt?: Date | string | null;
  apiKeyPreviousHash?: string | null;
  apiKeyPreviousExpiresAt?: Date | string | null;
}

export type KeyMatch = 'current' | 'previous' | 'expired' | null;

function asTime(v: Date | string | null | undefined): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Classify a presented key hash against an app:
 *  - 'current'  → matches the current hash and is not expired
 *  - 'previous' → matches the previous hash and is still within the grace window
 *  - 'expired'  → matched a hash, but that key's expiry has passed
 *  - null       → no hash match at all
 */
export function classifyApiKey(app: KeyMatchable, presentedHash: string, now: Date = new Date()): KeyMatch {
  const nowMs = now.getTime();

  if (presentedHash === app.apiKeyHash) {
    const exp = asTime(app.apiKeyExpiresAt);
    if (exp !== null && nowMs >= exp) return 'expired';
    return 'current';
  }

  if (app.apiKeyPreviousHash && presentedHash === app.apiKeyPreviousHash) {
    const exp = asTime(app.apiKeyPreviousExpiresAt);
    // A previous key with no expiry set is treated as already retired.
    if (exp === null || nowMs >= exp) return 'expired';
    return 'previous';
  }

  return null;
}

/** Convenience: is this key currently usable (current or in-grace previous)? */
export function isApiKeyValid(app: KeyMatchable, presentedHash: string, now: Date = new Date()): boolean {
  const m = classifyApiKey(app, presentedHash, now);
  return m === 'current' || m === 'previous';
}
