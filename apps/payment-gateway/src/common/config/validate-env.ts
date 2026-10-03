/**
 * Fail-fast environment validation, wired into ConfigModule.forRoot({ validate }).
 *
 * Goal: turn a misconfigured deploy into a clear boot-time error instead of a
 * cryptic runtime failure the first time a payment or login is attempted.
 *
 * Kept dependency-free (no class-validator schema) so it can run before the DI
 * container and be unit-tested in isolation.
 */

// Always required for the gateway to function at all.
const REQUIRED = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'ADMIN_JWT_SECRET',
  'WEBHOOK_SECRET_ENCRYPTION_KEY',
] as const;

export function decodeEncryptionKey(raw: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return Buffer.from(raw, 'base64');
}

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];

  for (const key of REQUIRED) {
    const v = config[key];
    if (v === undefined || v === null || String(v).trim() === '') {
      errors.push(`  - ${key} is required but missing`);
    }
  }

  // Encryption key must decode to exactly 32 bytes (AES-256).
  const rawKey = config.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (typeof rawKey === 'string' && rawKey.trim() !== '') {
    let len = -1;
    try {
      len = decodeEncryptionKey(rawKey).length;
    } catch {
      len = -1;
    }
    if (len !== 32) {
      errors.push(
        `  - WEBHOOK_SECRET_ENCRYPTION_KEY must decode to 32 bytes ` +
          `(got ${len < 0 ? 'undecodable value' : `${len} bytes`}); ` +
          `generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
    }
  }

  // DB_PORT, if present, must be a valid port number.
  if (config.DB_PORT !== undefined && config.DB_PORT !== '') {
    const port = Number(config.DB_PORT);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      errors.push(`  - DB_PORT must be a valid port number (got "${String(config.DB_PORT)}")`);
    }
  }

  // At least one payment provider must be configured, or nothing can be charged.
  const hasLemon = !!config.LEMONSQUEEZY_API_KEY;
  const hasXendit = !!config.XENDIT_SECRET_KEY;
  if (!hasLemon && !hasXendit) {
    errors.push(
      '  - No payment provider configured: set LEMONSQUEEZY_API_KEY and/or XENDIT_SECRET_KEY',
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `AcePay gateway env validation failed:\n${errors.join('\n')}\n` +
        `See apps/payment-gateway/.env.example for the full list.`,
    );
  }

  return config;
}
