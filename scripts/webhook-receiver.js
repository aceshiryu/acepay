#!/usr/bin/env node
/**
 * Local stand-in for BooklyPH's webhook endpoint. Prints every webhook AcePay
 * delivers so you can test the flow before the real app exists.
 *
 *   node scripts/webhook-receiver.js
 *   ACEPAY_WEBHOOK_SECRET=<secret> node scripts/webhook-receiver.js   # also verify signatures
 *
 * Set the app's webhook URL in the AcePay admin to:
 *   http://localhost:4100/webhooks/acepay
 *
 * Signature check (the same one BooklyPH must do):
 *   x-acepay-signature: sha256=<hex HMAC-SHA256 of "<x-acepay-timestamp>.<raw body>" with the webhook secret>
 */
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 4100;
const PATH = '/webhooks/acepay';
const SECRET = process.env.ACEPAY_WEBHOOK_SECRET || '';

function verify(headers, raw) {
  if (!SECRET) return 'not checked (start with ACEPAY_WEBHOOK_SECRET to verify)';
  const ts = headers['x-acepay-timestamp'];
  const sig = String(headers['x-acepay-signature'] || '').replace(/^sha256=/, '');
  if (!ts || !sig) return 'INVALID (missing signature headers)';
  const expected = crypto.createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'valid' : 'INVALID (signature mismatch)';
}

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== PATH) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end(`POST ${PATH} only\n`);
  }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body = raw;
    try { body = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* not JSON — print as-is */ }
    console.log(`\n── ${new Date().toLocaleTimeString()}  ${req.headers['x-acepay-event'] || '(no event header)'}`);
    console.log(`   signature: ${verify(req.headers, raw)}`);
    console.log(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"received":true}');
  });
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — another receiver is probably running.`);
    console.error(`Stop it (lsof -i :${PORT} to find it) or run with PORT=<other port>.`);
    process.exit(1);
  }
  throw err;
}).listen(PORT, () => {
  console.log(`AcePay webhook receiver listening on http://localhost:${PORT}${PATH}`);
  console.log(SECRET ? 'Signature verification: ON' : 'Signature verification: OFF (set ACEPAY_WEBHOOK_SECRET to enable)');
});
