/**
 * Self-contained HTML for the PayMongo pay page. No framework, no external
 * assets: the only network call the page makes is to api.paymongo.com, which
 * is all the Content-Security-Policy allows (see `payPageCsp`).
 */

export interface PayFormView {
  nonce: string;
  planName: string;
  amountLabel: string;
  email: string;
  publicKey: string;
  clientKey: string;
  paymentIntentId: string;
  returnUrl: string;
  cancelUrl: string;
  errorMessage: string | null;
  testMode: boolean;
}

export interface PayMessageView {
  nonce: string;
  title: string;
  body: string;
  /** Primary button. */
  link?: { label: string; href: string } | null;
  /** Re-load the page after N seconds (used while PayMongo confirms). */
  refreshSeconds?: number | null;
}

export function payPageCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    'connect-src https://api.paymongo.com',
    'img-src data:',
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** JSON safe to drop inside a <script> block. */
function js(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const STYLES = `
:root { --bg:#F4F6FA; --card:#fff; --ink:#0F172A; --muted:#64748B; --line:#E2E8F0; --accent:#1DB37E; --bad:#DC2626; }
@media (prefers-color-scheme: dark) { :root { --bg:#0B1220; --card:#111A2E; --ink:#E5E7EB; --muted:#94A3B8; --line:#1F2A44; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px 16px;
  background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
main { width:100%; max-width:420px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:24px; }
h1 { font-size:18px; margin:0 0 4px; }
.amount { font-size:30px; font-weight:700; letter-spacing:-0.5px; margin:10px 0 2px; }
.muted { color:var(--muted); font-size:13px; }
label { display:block; font-size:12px; font-weight:600; color:var(--muted); margin:14px 0 5px; }
input { width:100%; padding:11px 12px; font-size:15px; border:1px solid var(--line); border-radius:8px; background:transparent; color:var(--ink); }
input:focus { outline:2px solid var(--accent); outline-offset:-1px; }
.row { display:flex; gap:10px; } .row > div { flex:1; min-width:0; }
button { width:100%; padding:12px; margin-top:18px; font-size:15px; font-weight:650; border-radius:8px; border:0; cursor:pointer; }
.primary { background:var(--accent); color:#fff; }
.secondary { background:transparent; color:var(--ink); border:1px solid var(--line); margin-top:10px; }
button:disabled { opacity:.6; cursor:default; }
.error { color:var(--bad); font-size:13px; margin-top:14px; min-height:1em; }
.or { text-align:center; color:var(--muted); font-size:12px; margin:16px 0 0; }
.badge { display:inline-block; font-size:11px; font-weight:700; padding:2px 8px; border-radius:99px; background:#FEF3C7; color:#92400E; margin-bottom:10px; }
a.cancel { display:block; text-align:center; margin-top:16px; color:var(--muted); font-size:13px; }
.foot { margin-top:18px; font-size:11.5px; color:var(--muted); text-align:center; }
`;

function shell(nonce: string, title: string, inner: string, head = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
${head}
<style nonce="${nonce}">${STYLES}</style>
</head>
<body>
<main>${inner}</main>
</body>
</html>`;
}

export function renderPayForm(v: PayFormView): string {
  const inner = `
${v.testMode ? '<span class="badge">TEST MODE</span>' : ''}
<h1>${escapeHtml(v.planName)}</h1>
<div class="amount">${escapeHtml(v.amountLabel)}</div>
<div class="muted">First payment. Your card or Maya account is saved for the next billing cycles.</div>

<div id="card-form">
  <label for="name">Name on card</label>
  <input id="name" autocomplete="cc-name" required>
  <label for="number">Card number</label>
  <input id="number" inputmode="numeric" autocomplete="cc-number" placeholder="1234 5678 9012 3456" required>
  <div class="row">
    <div><label for="exp">Expiry (MM/YY)</label><input id="exp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" required></div>
    <div><label for="cvc">CVC</label><input id="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" required></div>
  </div>
  <button class="primary" id="pay-card" type="button">Pay with card</button>
</div>
<div class="or">or</div>
<button class="secondary" id="pay-maya" type="button">Pay with Maya</button>
<div class="error" id="error" role="alert">${v.errorMessage ? escapeHtml(v.errorMessage) : ''}</div>
<a class="cancel" href="${escapeHtml(v.cancelUrl)}">Cancel and go back</a>
<div class="foot">Card details go straight to PayMongo, our payment processor. They never reach our servers.</div>

<script nonce="${v.nonce}">
(function () {
  var PK = ${js(v.publicKey)}, CK = ${js(v.clientKey)}, PI = ${js(v.paymentIntentId)};
  var RETURN_URL = ${js(v.returnUrl)}, EMAIL = ${js(v.email)};
  var API = 'https://api.paymongo.com/v1';
  var errBox = document.getElementById('error');
  var buttons = [document.getElementById('pay-card'), document.getElementById('pay-maya')];

  function busy(on) { buttons.forEach(function (b) { b.disabled = on; }); }
  function fail(msg) { errBox.textContent = msg; busy(false); }
  function call(path, attributes) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + btoa(PK + ':'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { attributes: attributes } })
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) {
          var e = body && body.errors && body.errors[0];
          throw new Error((e && e.detail) || 'Payment could not be started. Please try again.');
        }
        return body.data;
      });
    });
  }
  function pay(methodAttrs) {
    busy(true); errBox.textContent = '';
    call('/payment_methods', methodAttrs)
      .then(function (pm) {
        return call('/payment_intents/' + PI + '/attach', { payment_method: pm.id, client_key: CK, return_url: RETURN_URL });
      })
      .then(function (pi) {
        var a = pi.attributes || {};
        if (a.status === 'awaiting_next_action' && a.next_action && a.next_action.redirect) {
          window.location.assign(a.next_action.redirect.url);   // 3-D Secure / Maya login
        } else if (a.status === 'succeeded' || a.status === 'processing') {
          window.location.assign(RETURN_URL);
        } else {
          var e = a.last_payment_error;
          fail((e && (e.failed_message || e.detail)) || 'The payment was declined. Please try another card.');
        }
      })
      .catch(function (e) { fail(e.message); });
  }

  document.getElementById('pay-card').addEventListener('click', function () {
    var number = document.getElementById('number').value.replace(/\\D/g, '');
    var exp = document.getElementById('exp').value.replace(/\\s/g, '').split('/');
    var cvc = document.getElementById('cvc').value.replace(/\\D/g, '');
    var name = document.getElementById('name').value.trim();
    var month = parseInt(exp[0], 10), year = parseInt(exp[1], 10);
    if (year < 100) year += 2000;
    if (!number || !month || !year || !cvc || !name) return fail('Fill in every card field.');
    pay({
      type: 'card',
      details: { card_number: number, exp_month: month, exp_year: year, cvc: cvc },
      billing: { name: name, email: EMAIL }
    });
  });
  document.getElementById('pay-maya').addEventListener('click', function () {
    pay({ type: 'paymaya', billing: { name: document.getElementById('name').value.trim() || EMAIL, email: EMAIL } });
  });
})();
</script>`;
  return shell(v.nonce, `Pay — ${v.planName}`, inner);
}

export function renderPayMessage(v: PayMessageView): string {
  const refresh = v.refreshSeconds ? `<meta http-equiv="refresh" content="${Math.max(1, Math.round(v.refreshSeconds))}">` : '';
  const inner = `
<h1>${escapeHtml(v.title)}</h1>
<p class="muted">${escapeHtml(v.body)}</p>
${v.link ? `<a class="cancel" href="${escapeHtml(v.link.href)}">${escapeHtml(v.link.label)}</a>` : ''}`;
  return shell(v.nonce, v.title, inner, refresh);
}
