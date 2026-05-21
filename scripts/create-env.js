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

const KEYS = [
  // Runtime
  'NODE_ENV',
  'PORT',
  'CORS_ORIGINS',
  // Data layer
  'DATABASE_URL',
  'REDIS_URL',
  // Crypto
  'JWT_SECRET',
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
  // Admin seed (gateway only)
  'ADMIN_USER_EMAIL',
  'ADMIN_USER_PASSWORD',
];

const escape = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

const lines = KEYS
  .filter((k) => process.env[k] !== undefined && process.env[k] !== '')
  .map((k) => `${k}=${escape(process.env[k])}`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`create-env: wrote ${lines.length} vars → ${out}`);
