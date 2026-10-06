import axios from 'axios';
import { hmacSha256 } from '../crypto';

export interface SignedPostResult {
  status: number;
  /** The response body, at most 4,000 characters. */
  body: string;
  ms: number;
}

/**
 * POSTs `body` to an app's webhook URL, signed the way every AcePay webhook
 * is: `x-acepay-signature: sha256=HMAC_SHA256(secret, "<timestamp>.<body>")`
 * plus the timestamp, event type and event id headers. Never throws on a
 * non-2xx answer (that is the caller's to judge); throws on a network error
 * or the timeout.
 */
export async function signedPost(p: {
  url: string;
  secret: string;
  eventType: string;
  eventId: string;
  body: string;
  timeoutMs: number;
  now?: Date;
}): Promise<SignedPostResult> {
  const timestamp = Math.floor((p.now ?? new Date()).getTime() / 1000).toString();
  const signature = hmacSha256(p.secret, `${timestamp}.${p.body}`);
  const started = Date.now();
  const resp = await axios.post(p.url, p.body, {
    timeout: p.timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      'x-acepay-signature': `sha256=${signature}`,
      'x-acepay-timestamp': timestamp,
      'x-acepay-event': p.eventType,
      'x-acepay-event-id': p.eventId,
    },
    validateStatus: () => true,
  });
  const text = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data ?? '');
  return { status: resp.status, body: text.slice(0, 4000), ms: Date.now() - started };
}
