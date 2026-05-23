#!/usr/bin/env node
/**
 * Writes a .env file at the given path from whitelisted process.env keys.
 *
 * Usage:
 *   node scripts/create-env.js <out-path>
 *
 * Each cloudbuild step injects only the keys its service needs (via the
 * step's `secretEnv:` block). Keys not present in process.env are skipped,
 * so a single whitelist serves both gateway and worker.
 */

const fs = require('fs');
const path = require('path');

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/create-env.js <out-path>');
  process.exit(1);
}

// Must match every env var the gateway / worker / data-source actually read.
// Cloud Build's secretEnv populates process.env; this script then filters by
// this whitelist when writing the deploy-time .env. Names not in this list
// silently disappear from the .env even if Secret Manager has them.
const KEYS = [
  // Runtime
  'NODE_ENV',
  'PORT',
  'CORS_ORIGINS',
  'PUBLIC_BASE_URL',
  // Database (Postgres / Supabase) — discrete vars, not a URL
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'DB_SSL',
  'DB_LOGGING',
  // Redis (Bull queues)
  'REDIS_URL',
  // Crypto
  'ADMIN_JWT_SECRET',
  'ADMIN_JWT_TTL_HOURS',
  'WEBHOOK_SECRET_ENCRYPTION_KEY',
  // Lemon Squeezy
  'LEMONSQUEEZY_API_KEY',
  'LEMONSQUEEZY_STORE_ID',
  'LEMONSQUEEZY_WEBHOOK_SECRET',
  'LEMONSQUEEZY_VARIANT_ID',
  'LEMONSQUEEZY_TEST_MODE',
  // Xendit
  'XENDIT_SECRET_KEY',
  'XENDIT_WEBHOOK_TOKEN',
  // Admin seed (gateway only — npm run seed:admin)
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_PASSWORD',
];

const escape = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

const lines = KEYS
  .filter((k) => process.env[k] !== undefined && process.env[k] !== '')
  .map((k) => `${k}=${escape(process.env[k])}`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`create-env: wrote ${lines.length} vars → ${out}`);
