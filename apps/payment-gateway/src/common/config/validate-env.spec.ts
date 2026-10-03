import { validateEnv } from './validate-env';

const HEX_KEY = 'a'.repeat(64); // 32 bytes in hex

function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DB_HOST: 'localhost',
    DB_PORT: '5433',
    DB_NAME: 'acepay',
    DB_USER: 'postgres',
    ADMIN_JWT_SECRET: 'super-secret',
    WEBHOOK_SECRET_ENCRYPTION_KEY: HEX_KEY,
    XENDIT_SECRET_KEY: 'xnd_key',
    ...overrides,
  };
}

describe('validateEnv', () => {
  it('passes a complete, valid config and returns it unchanged', () => {
    const env = baseEnv();
    expect(validateEnv(env)).toBe(env);
  });

  it('accepts a base64-encoded 32-byte key', () => {
    expect(() => validateEnv(baseEnv({ WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') })))
      .not.toThrow();
  });

  it('throws listing every missing required var', () => {
    expect(() => validateEnv({ WEBHOOK_SECRET_ENCRYPTION_KEY: HEX_KEY, XENDIT_SECRET_KEY: 'x' }))
      .toThrow(/DB_HOST is required[\s\S]*ADMIN_JWT_SECRET is required/);
  });

  it('rejects an encryption key of the wrong length', () => {
    expect(() => validateEnv(baseEnv({ WEBHOOK_SECRET_ENCRYPTION_KEY: 'deadbeef' })))
      .toThrow(/must decode to 32 bytes/);
  });

  it('treats an empty-string required var as missing', () => {
    expect(() => validateEnv(baseEnv({ DB_NAME: '' }))).toThrow(/DB_NAME is required/);
  });

  it('rejects an invalid DB_PORT', () => {
    expect(() => validateEnv(baseEnv({ DB_PORT: 'not-a-port' }))).toThrow(/DB_PORT must be a valid port/);
    expect(() => validateEnv(baseEnv({ DB_PORT: '70000' }))).toThrow(/DB_PORT must be a valid port/);
  });

  it('requires at least one payment provider', () => {
    expect(() => validateEnv(baseEnv({ XENDIT_SECRET_KEY: undefined, LEMONSQUEEZY_API_KEY: undefined })))
      .toThrow(/No payment provider configured/);
  });

  it('accepts Lemon Squeezy alone as the provider', () => {
    expect(() => validateEnv(baseEnv({ XENDIT_SECRET_KEY: undefined, LEMONSQUEEZY_API_KEY: 'ls_key' })))
      .not.toThrow();
  });
});
