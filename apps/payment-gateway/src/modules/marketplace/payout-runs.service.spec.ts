jest.mock('../../database/entities', () => ({
  App: class App {}, Customer: class Customer {}, Plan: class Plan {}, Subscription: class Subscription {},
  Transaction: class Transaction {}, TransactionLog: class TransactionLog {}, User: class User {},
  WebhookEvent: class WebhookEvent {}, Merchant: class Merchant {}, Payout: class Payout {},
  PayoutRun: class PayoutRun {}, XenditSplitRule: class XenditSplitRule {},
}));

import { ConflictException } from '@nestjs/common';
import { FindOperator, Repository } from 'typeorm';
import { MerchantStatus, PayoutRunStatus, PayoutStatus } from '../../common/enums';
import { PayoutRunQueueService } from '../../common/queue/payout-run-queue.service';
import { App, Merchant, Payout, PayoutRun } from '../../database/entities';
import { XenditPlatformClient } from '../../payment-providers/xendit-platform.client';
import { MerchantEventsService } from './merchant-events.service';
import { PayoutRunsService, RUN_PREVIEW_TTL_MS } from './payout-runs.service';

// ─── A tiny in-memory repository: enough of TypeORM for this service ──────

type Row = Record<string, unknown> & { id: string };

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v instanceof FindOperator) {
      if (v.type === 'in') return (v.value as unknown[]).includes(row[k]);
      throw new Error(`unsupported operator ${v.type}`);
    }
    return row[k] === v;
  });
}

let seq = 0;
class FakeRepo<T extends Row> {
  rows: T[] = [];
  constructor(private readonly prefix: string) {}
  create = jest.fn((v: Partial<T>) => ({ ...v }) as T);
  findOne = jest.fn(async (o: { where?: Record<string, unknown> }) => this.rows.find((r) => matches(r, o.where)) ?? null);
  find = jest.fn(async (o: { where?: Record<string, unknown>; order?: Record<string, string> } = {}) =>
    this.rows.filter((r) => matches(r, o.where)));
  save = jest.fn(async (v: T | T[]) => {
    const list = Array.isArray(v) ? v : [v];
    for (const item of list) {
      if (!item.id) {
        // uuid-shaped, like Postgres — the webhook matcher only trusts uuids.
        const n = String(++seq).padStart(12, '0');
        Object.assign(item, { id: `00000000-0000-4000-8000-${n}`, createdAt: new Date(Date.now() + seq) });
      }
      const i = this.rows.findIndex((r) => r.id === item.id);
      if (i >= 0) this.rows[i] = item; else this.rows.push(item);
    }
    return v;
  });
  update = jest.fn(async (where: Record<string, unknown>, patch: Partial<T>) => {
    this.rows.filter((r) => matches(r, where)).forEach((r) => Object.assign(r, patch));
  });
  delete = jest.fn(async (where: Record<string, unknown>) => {
    this.rows = this.rows.filter((r) => !matches(r, where));
  });
}

// ─── fixtures ─────────────────────────────────────────────────────────────

const BOOKLY = { id: 'app-bookly', name: 'BooklyPH', marketplaceEnabled: true, marketplaceFeePercent: 12, marketplaceMinPayout: 50000 };
const OTHER = { id: 'app-other', name: 'OtherApp', marketplaceEnabled: true, marketplaceFeePercent: 5, marketplaceMinPayout: 10000 };

function merchant(id: string, o: Partial<Merchant> = {}): Row {
  return {
    id, appId: BOOKLY.id, name: `Coach ${id}`, email: `${id}@x.com`, status: MerchantStatus.Active,
    xenditAccountId: `sub-${id}`, payoutChannelCode: 'PH_GCASH', payoutAccountNumber: `0917${id}`,
    payoutAccountHolderName: `Holder ${id}`, ...o,
  } as unknown as Row;
}

describe('PayoutRunsService', () => {
  let runs: FakeRepo<Row>;
  let payouts: FakeRepo<Row>;
  let merchants: FakeRepo<Row>;
  let apps: FakeRepo<Row>;
  let xendit: Record<string, jest.Mock>;
  let queue: { enqueue: jest.Mock };
  let events: { emit: jest.Mock };
  let service: PayoutRunsService;
  let balances: Record<string, number>;

  beforeEach(() => {
    seq = 0;
    runs = new FakeRepo('run');
    payouts = new FakeRepo('po');
    merchants = new FakeRepo('m');
    apps = new FakeRepo('app');
    apps.rows.push(BOOKLY as unknown as Row, OTHER as unknown as Row);
    balances = {};
    xendit = {
      getBalance: jest.fn(async (sub: string) => {
        if (!(sub in balances)) throw new Error(`Xendit balance unavailable for ${sub}`);
        return balances[sub];
      }),
      payoutFeeReserve: jest.fn().mockReturnValue(2500),
      createPayout: jest.fn(async (p: { referenceId: string }) => ({
        id: `disb-${p.referenceId}`, referenceId: p.referenceId, providerStatus: 'ACCEPTED',
        status: PayoutStatus.Pending, failureCode: null, estimatedArrivalAt: null, raw: {},
      })),
      findPayoutByReference: jest.fn().mockResolvedValue(null),
      getPayout: jest.fn(),
    };
    queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    events = { emit: jest.fn().mockResolvedValue(undefined) };

    const byClass = new Map<unknown, FakeRepo<Row>>([[PayoutRun, runs], [Payout, payouts], [Merchant, merchants]]);
    const em = {
      findOne: (cls: unknown, o: { where: Record<string, unknown> }) => byClass.get(cls)!.findOne(o),
      find: (cls: unknown, o: { where: Record<string, unknown> }) => byClass.get(cls)!.find(o),
      save: (cls: unknown, v: Row | Row[]) => byClass.get(cls)!.save(v),
    };
    (runs as unknown as { manager: unknown }).manager = { transaction: (cb: (e: unknown) => unknown) => cb(em) };

    service = new PayoutRunsService(
      runs as unknown as Repository<PayoutRun>,
      payouts as unknown as Repository<Payout>,
      merchants as unknown as Repository<Merchant>,
      apps as unknown as Repository<App>,
      xendit as unknown as XenditPlatformClient,
      queue as unknown as PayoutRunQueueService,
      events as unknown as MerchantEventsService,
    );
  });

  async function builtRun(appId?: string) {
    const run = await service.create({ appId }, 'ops@acepay');
    await service.build(run.id);
    return runs.rows.find((r) => r.id === run.id)!;
  }

  // ─── create ─────────────────────────────────────────────────────────

  it('starts a run in building and queues the balance read', async () => {
    const run = await service.create({}, 'ops@acepay');
    expect(run).toEqual(expect.objectContaining({ status: PayoutRunStatus.Building, createdBy: 'ops@acepay' }));
    expect(queue.enqueue).toHaveBeenCalledWith({ type: 'build', runId: run.id });
  });

  it('allows only one open run at a time', async () => {
    const first = await service.create({}, null);
    await expect(service.create({}, null)).rejects.toMatchObject({ response: { error: 'payout_run_open', details: { runId: first.id } } });
  });

  it('refuses an app without marketplace mode', async () => {
    apps.rows.push({ id: 'app-off', name: 'Off', marketplaceEnabled: false } as unknown as Row);
    await expect(service.create({ appId: 'app-off' }, null)).rejects.toMatchObject({ response: { error: 'marketplace_not_enabled' } });
  });

  // ─── build ──────────────────────────────────────────────────────────

  describe('build', () => {
    it('drafts balance − fee reserve for payable merchants and explains every exclusion', async () => {
      merchants.rows.push(
        merchant('a'),                                                        // pays
        merchant('b', { status: MerchantStatus.Paused }),                    // paused
        merchant('c', { payoutAccountNumber: null }),                        // no details
        merchant('d'),                                                        // below minimum
        merchant('e'),                                                        // balance error
        merchant('f', { xenditAccountId: null }),                            // no sub-account
        merchant('g', { status: MerchantStatus.Suspended }),                 // ignored entirely
        merchant('h'),                                                        // payout already in flight
        merchant('o', { appId: OTHER.id }),                                  // other app, lower minimum
      );
      balances = { 'sub-a': 485000, 'sub-c': 90000, 'sub-d': 52000, 'sub-h': 100000, 'sub-o': 20000 };
      payouts.rows.push({ id: 'po-old', merchantId: 'h', status: PayoutStatus.Pending, amount: 1 } as unknown as Row);

      const run = await builtRun();

      expect(run.status).toBe(PayoutRunStatus.Draft);
      const drafts = payouts.rows.filter((p) => p.runId === run.id);
      expect(drafts.map((p) => [p.merchantId, p.amount, p.status])).toEqual(expect.arrayContaining([
        ['a', 482500, PayoutStatus.Draft],
        ['o', 17500, PayoutStatus.Draft],
      ]));
      expect(drafts).toHaveLength(2);
      expect(drafts.find((p) => p.merchantId === 'a')).toEqual(expect.objectContaining({
        balanceAtBuild: 485000, channelCode: 'PH_GCASH', accountNumber: '0917a', xenditAccountId: 'sub-a',
        description: 'BooklyPH payout',
      }));
      expect(run.totalAmount).toBe(500000);
      expect(run.payoutCount).toBe(2);

      const reasons = Object.fromEntries((run.excluded as Array<{ merchantId: string; reason: string }>).map((e) => [e.merchantId, e.reason]));
      expect(reasons).toEqual({
        b: 'paused', c: 'no_payout_destination', d: 'below_minimum', e: 'balance_error',
        f: 'no_sub_account', h: 'payout_in_progress',
      });
      expect(xendit.getBalance).not.toHaveBeenCalledWith('sub-b', expect.anything());
    });

    it('limits a run to one app when asked', async () => {
      merchants.rows.push(merchant('a'), merchant('o', { appId: OTHER.id }));
      balances = { 'sub-a': 100000, 'sub-o': 100000 };
      const run = await builtRun(BOOKLY.id);
      expect(payouts.rows.filter((p) => p.runId === run.id).map((p) => p.merchantId)).toEqual(['a']);
    });

    it('skips apps whose marketplace mode is off', async () => {
      apps.rows.find((a) => a.id === OTHER.id)!.marketplaceEnabled = false;
      merchants.rows.push(merchant('o', { appId: OTHER.id }));
      balances = { 'sub-o': 100000 };
      const run = await builtRun();
      expect(run.payoutCount).toBe(0);
    });

    it('a retried build starts clean (no duplicate drafts)', async () => {
      merchants.rows.push(merchant('a'));
      balances = { 'sub-a': 100000 };
      const run = await service.create({}, null);
      await service.build(run.id);
      runs.rows[0].status = PayoutRunStatus.Building; // simulate a Bull retry
      await service.build(run.id);
      expect(payouts.rows.filter((p) => p.runId === run.id)).toHaveLength(1);
    });
  });

  // ─── confirm / discard ──────────────────────────────────────────────

  describe('confirm', () => {
    beforeEach(() => {
      merchants.rows.push(merchant('a'), merchant('b'), merchant('c'));
      balances = { 'sub-a': 100000, 'sub-b': 200000, 'sub-c': 300000 };
    });

    it('queues ticked payouts, skips unticked ones, and starts sending', async () => {
      const run = await builtRun();
      await service.confirm(run.id as string, { skipMerchantIds: ['b'] }, 'ops@acepay');

      const byMerchant = Object.fromEntries(payouts.rows.map((p) => [p.merchantId, p.status]));
      expect(byMerchant).toEqual({ a: PayoutStatus.Queued, b: PayoutStatus.Skipped, c: PayoutStatus.Queued });
      expect(run).toEqual(expect.objectContaining({
        status: PayoutRunStatus.Queued, payoutCount: 2, totalAmount: 97500 + 297500, confirmedBy: 'ops@acepay',
      }));
      expect(queue.enqueue).toHaveBeenLastCalledWith({ type: 'execute', runId: run.id });
    });

    it('re-snapshots the merchant’s latest payout details', async () => {
      const run = await builtRun();
      merchants.rows.find((m) => m.id === 'a')!.payoutAccountNumber = '09990000000';
      await service.confirm(run.id as string, {}, null);
      expect(payouts.rows.find((p) => p.merchantId === 'a')!.accountNumber).toBe('09990000000');
    });

    it('skips a merchant paused after the preview', async () => {
      const run = await builtRun();
      merchants.rows.find((m) => m.id === 'a')!.status = MerchantStatus.Paused;
      await service.confirm(run.id as string, {}, null);
      expect(payouts.rows.find((p) => p.merchantId === 'a')!.status).toBe(PayoutStatus.Skipped);
    });

    it('completes immediately when everything is unticked', async () => {
      const run = await builtRun();
      queue.enqueue.mockClear();
      await service.confirm(run.id as string, { skipMerchantIds: ['a', 'b', 'c'] }, null);
      expect(run.status).toBe(PayoutRunStatus.Completed);
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('refuses a stale preview', async () => {
      const run = await builtRun();
      run.builtAt = new Date(Date.now() - RUN_PREVIEW_TTL_MS - 1000);
      await expect(service.confirm(run.id as string, {}, null)).rejects.toMatchObject({ response: { error: 'run_stale' } });
    });

    it('refuses a second confirm (double click)', async () => {
      const run = await builtRun();
      await service.confirm(run.id as string, {}, null);
      await expect(service.confirm(run.id as string, {}, null)).rejects.toBeInstanceOf(ConflictException);
    });

    it('discard sends nothing', async () => {
      const run = await builtRun();
      await service.discard(run.id as string);
      expect(run.status).toBe(PayoutRunStatus.Discarded);
      expect(payouts.rows.every((p) => p.status === PayoutStatus.Skipped)).toBe(true);
    });
  });

  // ─── execute ────────────────────────────────────────────────────────

  describe('execute', () => {
    async function confirmedRun() {
      merchants.rows.push(merchant('a'), merchant('b'), merchant('c'));
      balances = { 'sub-a': 100000, 'sub-b': 200000, 'sub-c': 300000 };
      const run = await builtRun();
      await service.confirm(run.id as string, {}, null);
      return run;
    }

    it('sends each payout from its own sub-account with its id as the idempotency key', async () => {
      const run = await confirmedRun();
      await service.execute(run.id as string, { lastAttempt: false });

      expect(xendit.createPayout).toHaveBeenCalledTimes(3);
      const pa = payouts.rows.find((p) => p.merchantId === 'a')!;
      expect(xendit.createPayout).toHaveBeenCalledWith(expect.objectContaining({
        forUserId: 'sub-a', referenceId: pa.id, channelCode: 'PH_GCASH', accountNumber: '0917a',
        accountHolderName: 'Holder a', amount: 97500, currency: 'PHP', email: 'a@x.com',
      }));
      expect(pa).toEqual(expect.objectContaining({ status: PayoutStatus.Pending, xenditPayoutId: `disb-${pa.id}` }));
      expect(run.status).toBe(PayoutRunStatus.Processing);
    });

    it('one rejected payout never stops the rest', async () => {
      const run = await confirmedRun();
      xendit.createPayout.mockImplementationOnce(async () => {
        throw Object.assign(new Error('Xendit says no'), { status: '400', errorCode: 'INVALID_DESTINATION' });
      });
      await service.execute(run.id as string, { lastAttempt: false });
      const statuses = payouts.rows.map((p) => p.status);
      expect(statuses.filter((s) => s === PayoutStatus.Failed)).toHaveLength(1);
      expect(statuses.filter((s) => s === PayoutStatus.Pending)).toHaveLength(2);
      const failed = payouts.rows.find((p) => p.status === PayoutStatus.Failed)!;
      expect(failed.failureCode).toBe('INVALID_DESTINATION');
      expect(events.emit).toHaveBeenCalledWith('merchant.payout_failed', expect.anything(), expect.objectContaining({ payout: failed }));
    });

    it('recovers a payout whose response was lost by looking it up by reference', async () => {
      const run = await confirmedRun();
      xendit.createPayout.mockImplementationOnce(async () => { throw new Error('socket hang up'); });
      xendit.findPayoutByReference.mockImplementationOnce(async (ref: string) => ({
        id: 'disb-found', referenceId: ref, providerStatus: 'ACCEPTED', status: PayoutStatus.Pending, failureCode: null, raw: {},
      }));
      await service.execute(run.id as string, { lastAttempt: false });
      expect(payouts.rows.some((p) => p.xenditPayoutId === 'disb-found' && p.status === PayoutStatus.Pending)).toBe(true);
    });

    it('leaves a transport failure queued and throws so Bull retries — then a retry sends only that one', async () => {
      const run = await confirmedRun();
      xendit.createPayout.mockImplementationOnce(async () => { throw new Error('ECONNRESET'); });
      await expect(service.execute(run.id as string, { lastAttempt: false })).rejects.toThrow(/retrying/);
      expect(payouts.rows.filter((p) => p.status === PayoutStatus.Queued)).toHaveLength(1);

      xendit.createPayout.mockClear();
      await service.execute(run.id as string, { lastAttempt: false });
      expect(xendit.createPayout).toHaveBeenCalledTimes(1);
      expect(payouts.rows.filter((p) => p.status === PayoutStatus.Queued)).toHaveLength(0);
    });

    it('marks a transport failure failed on the last attempt', async () => {
      const run = await confirmedRun();
      xendit.createPayout.mockImplementationOnce(async () => { throw new Error('ECONNRESET'); });
      await service.execute(run.id as string, { lastAttempt: true });
      expect(payouts.rows.find((p) => p.status === PayoutStatus.Failed)!.failureCode).toBe('send_error');
    });

    it('does nothing for a run that is not queued/processing', async () => {
      merchants.rows.push(merchant('a'));
      balances = { 'sub-a': 100000 };
      const run = await builtRun();
      await service.execute(run.id as string, { lastAttempt: false });
      expect(xendit.createPayout).not.toHaveBeenCalled();
    });
  });

  // ─── webhooks → settling the run ────────────────────────────────────

  describe('payout webhooks', () => {
    async function sentRun() {
      merchants.rows.push(merchant('a'), merchant('b'));
      balances = { 'sub-a': 100000, 'sub-b': 200000 };
      const run = await builtRun();
      await service.confirm(run.id as string, {}, null);
      await service.execute(run.id as string, { lastAttempt: false });
      return run;
    }
    const pFor = (m: string) => payouts.rows.find((p) => p.merchantId === m && !p.retryOf)!;
    const hook = (p: Row, providerStatus: string, status: PayoutStatus, failureCode: string | null = null) =>
      service.applyWebhook({ xenditPayoutId: p.xenditPayoutId as string, referenceId: p.id, providerStatus, status, failureCode, raw: {} });

    it('settles the run as completed once every payout succeeded, telling the app each time', async () => {
      const run = await sentRun();
      await hook(pFor('a'), 'SUCCEEDED', PayoutStatus.Succeeded);
      expect(run.status).toBe(PayoutRunStatus.Processing);
      await hook(pFor('b'), 'SUCCEEDED', PayoutStatus.Succeeded);
      expect(run.status).toBe(PayoutRunStatus.Completed);
      expect(events.emit.mock.calls.filter((c) => c[0] === 'merchant.payout_sent')).toHaveLength(2);
      expect(pFor('a').completedAt).toBeInstanceOf(Date);
    });

    it('settles as completed_with_failures when one fails', async () => {
      const run = await sentRun();
      await hook(pFor('a'), 'SUCCEEDED', PayoutStatus.Succeeded);
      await hook(pFor('b'), 'FAILED', PayoutStatus.Failed, 'INVALID_DESTINATION');
      expect(run.status).toBe(PayoutRunStatus.CompletedWithFailures);
      expect(pFor('b').failureCode).toBe('INVALID_DESTINATION');
    });

    it('ignores a duplicate or out-of-order callback', async () => {
      await sentRun();
      await hook(pFor('a'), 'SUCCEEDED', PayoutStatus.Succeeded);
      events.emit.mockClear();
      const r1 = await hook(pFor('a'), 'SUCCEEDED', PayoutStatus.Succeeded);
      const r2 = await hook(pFor('a'), 'ACCEPTED', PayoutStatus.Pending);
      expect([r1.changed, r2.changed]).toEqual([false, false]);
      expect(pFor('a').status).toBe(PayoutStatus.Succeeded);
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('a bounce-back after success re-opens a completed run as failed', async () => {
      const run = await sentRun();
      await hook(pFor('a'), 'SUCCEEDED', PayoutStatus.Succeeded);
      await hook(pFor('b'), 'SUCCEEDED', PayoutStatus.Succeeded);
      await hook(pFor('a'), 'REVERSED', PayoutStatus.Reversed);
      expect(pFor('a').status).toBe(PayoutStatus.Reversed);
      expect(run.status).toBe(PayoutRunStatus.CompletedWithFailures);
    });

    it('matches by reference when the Xendit id is unknown, and reports unknown payouts', async () => {
      await sentRun();
      const p = pFor('a');
      const byRef = await service.applyWebhook({ xenditPayoutId: 'disb-unseen', referenceId: p.id, providerStatus: 'SUCCEEDED', status: PayoutStatus.Succeeded, failureCode: null, raw: {} });
      expect(byRef.matched).toBe(true);
      const unknown = await service.applyWebhook({ xenditPayoutId: 'disb-nope', referenceId: 'not-a-uuid', providerStatus: 'SUCCEEDED', status: PayoutStatus.Succeeded, failureCode: null, raw: {} });
      expect(unknown).toEqual({ matched: false, changed: false });
    });
  });

  // ─── retry ──────────────────────────────────────────────────────────

  describe('retryFailed', () => {
    it("re-sends failed payouts as new payouts with the merchant's corrected details", async () => {
      merchants.rows.push(merchant('a'), merchant('b'));
      balances = { 'sub-a': 100000, 'sub-b': 200000 };
      const run = await builtRun();
      await service.confirm(run.id as string, {}, null);
      await service.execute(run.id as string, { lastAttempt: false });
      const pa = payouts.rows.find((p) => p.merchantId === 'a')!;
      const pb = payouts.rows.find((p) => p.merchantId === 'b')!;
      await service.applyWebhook({ xenditPayoutId: pa.xenditPayoutId as string, referenceId: pa.id, providerStatus: 'SUCCEEDED', status: PayoutStatus.Succeeded, failureCode: null, raw: {} });
      await service.applyWebhook({ xenditPayoutId: pb.xenditPayoutId as string, referenceId: pb.id, providerStatus: 'FAILED', status: PayoutStatus.Failed, failureCode: 'INVALID_DESTINATION', raw: {} });
      expect(run.status).toBe(PayoutRunStatus.CompletedWithFailures);

      merchants.rows.find((m) => m.id === 'b')!.payoutAccountNumber = '09171112222'; // coach fixed it
      const result = await service.retryFailed(run.id as string);

      expect(result.retried).toBe(1);
      const retry = payouts.rows.find((p) => p.retryOf === pb.id)!;
      expect(retry).toEqual(expect.objectContaining({
        status: PayoutStatus.Queued, amount: pb.amount, accountNumber: '09171112222', merchantId: 'b',
      }));
      expect(retry.id).not.toBe(pb.id); // new idempotency key
      expect(run.status).toBe(PayoutRunStatus.Queued);
      expect(queue.enqueue).toHaveBeenLastCalledWith({ type: 'execute', runId: run.id });

      // A second click doesn't retry the same failure twice.
      expect((await service.retryFailed(run.id as string)).retried).toBe(0);

      // Once the retry succeeds, the run is complete — the old failure no longer counts.
      await service.execute(run.id as string, { lastAttempt: false });
      await service.applyWebhook({ xenditPayoutId: retry.xenditPayoutId as string, referenceId: retry.id, providerStatus: 'SUCCEEDED', status: PayoutStatus.Succeeded, failureCode: null, raw: {} });
      expect(run.status).toBe(PayoutRunStatus.Completed);
    });

    it('does not retry a merchant that is no longer payable', async () => {
      merchants.rows.push(merchant('a'));
      balances = { 'sub-a': 100000 };
      const run = await builtRun();
      await service.confirm(run.id as string, {}, null);
      xendit.createPayout.mockImplementationOnce(async () => { throw Object.assign(new Error('no'), { status: '400' }); });
      await service.execute(run.id as string, { lastAttempt: false });
      merchants.rows[0].status = MerchantStatus.Paused;
      const r = await service.retryFailed(run.id as string);
      expect(r.retried).toBe(0);
      expect(r.notRetried).toEqual([expect.objectContaining({ reason: 'merchant_not_payable' })]);
    });
  });

  // ─── export ─────────────────────────────────────────────────────────

  it('exports a CSV in major units and neutralises formula injection', async () => {
    merchants.rows.push(merchant('a', { name: '=HYPERLINK("evil")' }));
    balances = { 'sub-a': 100000 };
    const run = await builtRun();
    (payouts.rows[0] as Record<string, unknown>).merchant = merchants.rows[0];
    const csv = await service.exportCsv(run.id as string);
    const [header, line] = csv.trim().split('\n');
    expect(header.split(',')).toContain('amount');
    expect(line).toContain('975.00');
    expect(line).toContain(`"'=HYPERLINK(""evil"")"`);
  });
});
