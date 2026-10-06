jest.mock('../../database/entities', () => ({ App: class App {} }));

import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { encryptSecret, hmacSha256 } from '../../common/crypto';
import { describeAnswer, WebhookPingService } from './webhook-ping.service';

process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = 'b'.repeat(64);
const SECRET = 'whsec_test_secret';

/** A tiny app that verifies AcePay signatures like a real one would. */
function receiver(answer: 'verify' | number): Promise<{ url: string; server: Server; seen: Array<Record<string, string>> }> {
  const seen: Array<Record<string, string>> = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const h = req.headers as Record<string, string>;
      seen.push({ ...h, body });
      if (typeof answer === 'number') {
        res.statusCode = answer;
        return res.end('{}');
      }
      const ok = h['x-acepay-signature'] === `sha256=${hmacSha256(SECRET, `${h['x-acepay-timestamp']}.${body}`)}`;
      res.statusCode = ok ? 200 : 401;
      res.end(ok ? '{"received":true}' : '{"error":"invalid signature"}');
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/acepay`, server, seen }),
    ),
  );
}

function service() {
  const repo = { findOne: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };
  return { svc: new WebhookPingService(repo as never), repo };
}

const app = (over: Record<string, unknown> = {}) =>
  ({ id: 'app-1', slug: 'bookly-ph', webhookUrl: null, webhookSecretEnc: encryptSecret(SECRET), ...over }) as never;

describe('WebhookPingService — "Send test webhook"', () => {
  let open: Server[] = [];
  afterEach(() => {
    open.forEach((s) => s.close());
    open = [];
  });

  it('signs app.ping like a real webhook; an app that verifies it answers 2xx', async () => {
    const r = await receiver('verify');
    open.push(r.server);
    const { svc, repo } = service();
    const result = await svc.ping(app({ webhookUrl: r.url }));
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(result.detail).toMatch(/signature checks out/);
    expect(r.seen[0]['x-acepay-event']).toBe('app.ping');
    expect(r.seen[0]['x-acepay-event-id']).toMatch(/^ping_/);
    expect(JSON.parse(r.seen[0].body)).toMatchObject({ event: 'app.ping', appSlug: 'bookly-ph' });
    expect(repo.update).toHaveBeenCalledWith({ id: 'app-1' }, expect.objectContaining({ lastPingOk: true }));
  });

  it('a wrong secret on the app side shows up as a refused signature', async () => {
    const r = await receiver('verify');
    open.push(r.server);
    const { svc } = service();
    const result = await svc.ping(app({ webhookUrl: r.url, webhookSecretEnc: encryptSecret('whsec_other') }));
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(result.detail).toMatch(/webhook secret/);
  });

  it('says plainly when nothing is listening', async () => {
    const r = await receiver(200);
    const url = r.url;
    await new Promise((done) => r.server.close(done));
    const { svc, repo } = service();
    const result = await svc.ping(app({ webhookUrl: url }));
    expect(result).toMatchObject({ ok: false, status: 0 });
    expect(result.detail).toMatch(/Nothing is listening|Could not reach/);
    expect(repo.update).toHaveBeenCalledWith({ id: 'app-1' }, expect.objectContaining({ lastPingOk: false }));
  });

  it('needs a webhook URL first', async () => {
    const { svc } = service();
    expect((await svc.ping(app())).detail).toBe('No webhook URL is set for this app.');
  });

  it('explains a 404 and other answers', () => {
    expect(describeAnswer(404, 5)).toMatch(/path is wrong/);
    expect(describeAnswer(500, 5)).toMatch(/must answer 2xx/);
  });
});
