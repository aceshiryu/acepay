import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { decryptSecret } from '../../common/crypto';
import { signedPost } from '../../common/services/signed-post';
import { App } from '../../database/entities';

/** An app gets this long to answer a test webhook (real deliveries get 10s too). */
const PING_TIMEOUT_MS = 10_000;

export interface PingResult {
  ok: boolean;
  /** The app's HTTP status; 0 when it could not be reached. */
  status: number;
  ms: number | null;
  /** What happened, in words an operator can act on. */
  detail: string;
  /** The start of the app's answer, for debugging. */
  bodySnippet: string | null;
  at: string;
}

/**
 * "Send test webhook": a signed `app.ping` to the app's webhook URL, sent
 * right away (not queued) so the result can be shown at once. It is signed
 * exactly like every real webhook, so a 2xx proves the URL is reachable AND
 * the app checks signatures with the right secret — an app that verifies
 * signatures answers 401 to a wrong one. Nothing is recorded as a webhook
 * event; the last result is kept on the app for its setup checklist.
 */
@Injectable()
export class WebhookPingService {
  constructor(@InjectRepository(App) private readonly apps: Repository<App>) {}

  async pingById(appId: string): Promise<PingResult> {
    const app = await this.apps.findOne({ where: { id: appId } });
    if (!app) throw new NotFoundException({ error: 'app_not_found', message: 'App not found' });
    return this.ping(app);
  }

  async ping(app: App, now = new Date()): Promise<PingResult> {
    const result = await this.send(app, now);
    await this.apps.update({ id: app.id }, {
      lastPingAt: now,
      lastPingOk: result.ok,
      lastPingDetail: result.detail.slice(0, 300),
    });
    return result;
  }

  private async send(app: App, now: Date): Promise<PingResult> {
    const at = now.toISOString();
    if (!app.webhookUrl) {
      return { ok: false, status: 0, ms: null, at, bodySnippet: null, detail: 'No webhook URL is set for this app.' };
    }
    if (!app.webhookSecretEnc) {
      return { ok: false, status: 0, ms: null, at, bodySnippet: null, detail: 'This app has no webhook secret. Rotate it to make one.' };
    }
    const body = JSON.stringify({ event: 'app.ping', appId: app.id, appSlug: app.slug, sentAt: at });
    try {
      const resp = await signedPost({
        url: app.webhookUrl,
        secret: decryptSecret(app.webhookSecretEnc),
        eventType: 'app.ping',
        eventId: `ping_${randomUUID()}`,
        body,
        timeoutMs: PING_TIMEOUT_MS,
        now,
      });
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        ms: resp.ms,
        at,
        bodySnippet: resp.body ? resp.body.slice(0, 300) : null,
        detail: describeAnswer(resp.status, resp.ms),
      };
    } catch (err) {
      return { ok: false, status: 0, ms: null, at, bodySnippet: null, detail: describeFailure(err, app.webhookUrl) };
    }
  }
}

export function describeAnswer(status: number, ms: number): string {
  if (status >= 200 && status < 300) return `The app answered ${status} in ${ms} ms: webhooks reach it and the signature checks out.`;
  if (status === 401 || status === 403) {
    return `The app refused the signature (${status}): its webhook secret is not this app's current one. Copy the secret again, or rotate it and update the app.`;
  }
  if (status === 404) return 'The app answered 404: the webhook URL path is wrong (for BooklyPH it ends in /api/webhooks/acepay).';
  return `The app answered ${status}. It must answer 2xx to app.ping.`;
}

export function describeFailure(err: unknown, url: string): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message ?? '')) return `No answer from ${url} within 10 seconds.`;
  if (e?.code === 'ECONNREFUSED') return `Nothing is listening at ${url}. Is the app running?`;
  if (e?.code === 'ENOTFOUND') return `${url} does not resolve. Check the host name.`;
  return `Could not reach ${url}: ${e?.message ?? 'unknown error'}.`;
}
