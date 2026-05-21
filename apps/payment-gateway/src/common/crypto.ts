import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes,
  scrypt as scryptCb, timingSafeEqual,
} from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer, salt: string | Buffer, keylen: number,
) => Promise<Buffer>;

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function generateApiKey(slug: string, mode: 'live' | 'test' = 'live'): string {
  const random = randomBytes(24).toString('base64url');
  return `pk_${mode}_${slug}_${random}`;
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

export function apiKeyPrefix(key: string): string {
  // store enough to disambiguate at lookup time but not enough to leak the secret
  return key.slice(0, 16);
}

const IV_LEN = 12;
const TAG_LEN = 16;

function getEncryptionKey(): Buffer {
  const raw = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY env var is required (32-byte hex or base64)');
  }
  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`WEBHOOK_SECRET_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length})`);
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ── Password hashing (scrypt) ──────────────────────────────────────────────
// Format: scrypt$N=16384,r=8,p=1$<saltHex>$<hashHex>

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ── Compact JWT (HMAC-SHA256) — header.payload.sig in base64url ───────────

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? 0 : 4 - (str.length % 4);
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad), 'base64');
}

export function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + ttlSeconds, ...payload };
  const headerB64 = b64urlEncode(Buffer.from(JSON.stringify(header)));
  const bodyB64 = b64urlEncode(Buffer.from(JSON.stringify(body)));
  const data = `${headerB64}.${bodyB64}`;
  const sig = b64urlEncode(createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

export function verifyJwt<T = Record<string, unknown>>(token: string, secret: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sig] = parts;
  const expected = b64urlEncode(createHmac('sha256', secret).update(`${headerB64}.${bodyB64}`).digest());
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const body = JSON.parse(b64urlDecode(bodyB64).toString('utf8')) as { exp?: number };
    if (typeof body.exp === 'number' && Math.floor(Date.now() / 1000) >= body.exp) return null;
    return body as T;
  } catch {
    return null;
  }
}
