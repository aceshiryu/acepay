import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import { MerchantStatus, PayoutRunStatus, PayoutStatus } from '../../common/enums';
import { PayoutRunQueueService } from '../../common/queue/payout-run-queue.service';
import { App, Merchant, Payout, PayoutRun } from '../../database/entities';
import { ExcludedMerchant } from '../../database/entities/payout-run.entity';
import {
  XenditPayoutResult, XenditPlatformClient,
} from '../../payment-providers/xendit-platform.client';
import { ConfirmPayoutRunDto, CreatePayoutRunDto, ListPayoutRunsDto } from './dto/payout-run.dto';
import { MerchantEventsService } from './merchant-events.service';
import { payoutView } from './merchants.service';
import { canTransitionPayout, errorMessage, mapWithConcurrency, settledRunStatus } from './marketplace.util';

const PAYOUT_CURRENCY = 'PHP';
/** Balances move all the time; a preview older than this must be rebuilt. */
export const RUN_PREVIEW_TTL_MS = 60 * 60 * 1000;
/** Parallel balance reads while building — keeps 1,000 merchants inside Xendit's limits. */
const BALANCE_READ_CONCURRENCY = 5;

const OPEN_RUN_STATUSES = [
  PayoutRunStatus.Building, PayoutRunStatus.Draft, PayoutRunStatus.Queued, PayoutRunStatus.Processing,
];

/** A Xendit answer that will never change on retry (4xx), vs. a transport
 *  problem where the payout may or may not exist on Xendit. */
function isDefinitiveRejection(err: unknown): boolean {
  const status = Number((err as { status?: unknown })?.status);
  return Number.isFinite(status) && status >= 400 && status < 500;
}

function errorCode(err: unknown): string | null {
  const e = err as { errorCode?: string; code?: string };
  return e?.errorCode ?? e?.code ?? null;
}

/**
 * Manual payout runs (Slice 6). Nothing here runs on a schedule:
 *
 *   create  → run `building`; the worker reads every merchant's live balance
 *   build   → draft payouts + an "excluded, and why" list; run `draft`
 *   confirm → operator unticks anyone, confirms; payouts `queued`, run `queued`
 *   execute → worker sends each payout (idempotency key = payout id)
 *   webhook → payout results arrive; run settles to completed / with failures
 *
 * Each payout's money comes from its merchant's own sub-account, so a run never
 * moves money between merchants or apps.
 */
@Injectable()
export class PayoutRunsService {
  private readonly logger = new Logger(PayoutRunsService.name);

  constructor(
    @InjectRepository(PayoutRun) private readonly runs: Repository<PayoutRun>,
    @InjectRepository(Payout) private readonly payouts: Repository<Payout>,
    @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
    @InjectRepository(App) private readonly apps: Repository<App>,
    private readonly xendit: XenditPlatformClient,
    private readonly queue: PayoutRunQueueService,
    private readonly events: MerchantEventsService,
  ) {}

  // ─── Operator actions ────────────────────────────────────────────────

  async create(dto: CreatePayoutRunDto, createdBy: string | null): Promise<PayoutRun> {
    const open = await this.runs.findOne({ where: { status: In(OPEN_RUN_STATUSES) } });
    if (open) {
      throw new ConflictException({
        error: 'payout_run_open',
        message: `Payout run ${open.code} is still ${open.status}. Finish or discard it before starting another.`,
        details: { runId: open.id, runCode: open.code },
      });
    }
    if (dto.appId) {
      const app = await this.apps.findOne({ where: { id: dto.appId } });
      if (!app) throw new NotFoundException({ error: 'app_not_found', message: `App ${dto.appId} not found` });
      if (!app.marketplaceEnabled) {
        throw new BadRequestException({ error: 'marketplace_not_enabled', message: `${app.name} doesn't have marketplace payments turned on` });
      }
    }
    const run = await this.runs.save(this.runs.create({
      appId: dto.appId ?? null,
      status: PayoutRunStatus.Building,
      currency: PAYOUT_CURRENCY,
      createdBy,
    }));
    await this.queue.enqueue({ type: 'build', runId: run.id });
    return run;
  }

  async confirm(runId: string, dto: ConfirmPayoutRunDto, confirmedBy: string | null) {
    const run = await this.getRun(runId);
    if (run.status !== PayoutRunStatus.Draft) {
      throw new ConflictException({ error: 'run_not_draft', message: `Run is ${run.status}; only a draft can be confirmed` });
    }
    if (!run.builtAt || Date.now() - new Date(run.builtAt).getTime() > RUN_PREVIEW_TTL_MS) {
      throw new ConflictException({
        error: 'run_stale',
        message: 'This preview is more than an hour old and balances may have changed. Discard it and start a new run.',
      });
    }
    const skip = new Set(dto.skipMerchantIds ?? []);

    const queuedCount = await this.runs.manager.transaction(async (em) => {
      // Lock the run so a double-clicked confirm can't queue twice.
      const locked = await em.findOne(PayoutRun, { where: { id: runId }, lock: { mode: 'pessimistic_write' } });
      if (!locked || locked.status !== PayoutRunStatus.Draft) {
        throw new ConflictException({ error: 'run_not_draft', message: 'Run was already confirmed or discarded' });
      }
      const drafts = await em.find(Payout, { where: { runId, status: PayoutStatus.Draft } });
      const merchants = drafts.length
        ? await em.find(Merchant, { where: { id: In(drafts.map((p) => p.merchantId)) } })
        : [];
      const byId = new Map(merchants.map((m) => [m.id, m]));

      let total = 0;
      let count = 0;
      for (const p of drafts) {
        const m = byId.get(p.merchantId);
        const eligible = m && m.status === MerchantStatus.Active && m.xenditAccountId
          && m.payoutChannelCode && m.payoutAccountNumber && m.payoutAccountHolderName;
        if (skip.has(p.merchantId) || !eligible) {
          p.status = PayoutStatus.Skipped;
          if (!skip.has(p.merchantId)) p.failureMessage = 'Merchant changed since the preview (paused or details removed)';
        } else {
          // Re-snapshot: the merchant may have fixed their account since the build.
          p.status = PayoutStatus.Queued;
          p.channelCode = m.payoutChannelCode;
          p.accountNumber = m.payoutAccountNumber;
          p.accountHolderName = m.payoutAccountHolderName;
          p.xenditAccountId = m.xenditAccountId;
          total += p.amount;
          count += 1;
        }
      }
      await em.save(Payout, drafts);

      locked.totalAmount = total;
      locked.payoutCount = count;
      locked.confirmedBy = confirmedBy;
      locked.confirmedAt = new Date();
      locked.status = count > 0 ? PayoutRunStatus.Queued : PayoutRunStatus.Completed;
      if (count === 0) locked.completedAt = new Date();
      await em.save(PayoutRun, locked);
      return count;
    });

    if (queuedCount > 0) await this.queue.enqueue({ type: 'execute', runId });
    return this.detail(runId);
  }

  async discard(runId: string) {
    const run = await this.getRun(runId);
    if (run.status !== PayoutRunStatus.Draft && run.status !== PayoutRunStatus.BuildFailed) {
      throw new ConflictException({ error: 'run_not_discardable', message: `A ${run.status} run can't be discarded` });
    }
    await this.payouts.update({ runId, status: PayoutStatus.Draft }, { status: PayoutStatus.Skipped });
    run.status = PayoutRunStatus.Discarded;
    run.completedAt = new Date();
    await this.runs.save(run);
    return this.detail(runId);
  }

  /** Re-sends a run's failed / reversed payouts as NEW payouts (new idempotency
   *  keys), snapshotting each merchant's current details — the usual fix is a
   *  coach correcting a wrong GCash number. */
  async retryFailed(runId: string) {
    const run = await this.getRun(runId);
    // Queued is allowed so a second click while a retry is pending is a no-op
    // (already-retried payouts are skipped), not an error.
    const retryable = [PayoutRunStatus.CompletedWithFailures, PayoutRunStatus.Processing, PayoutRunStatus.Queued];
    if (!retryable.includes(run.status)) {
      throw new ConflictException({ error: 'nothing_to_retry', message: `Run is ${run.status}` });
    }
    const failed = await this.payouts.find({
      where: { runId, status: In([PayoutStatus.Failed, PayoutStatus.Reversed, PayoutStatus.Canceled]) },
    });
    const alreadyRetried = new Set(
      failed.length
        ? (await this.payouts.find({ where: { runId, retryOf: In(failed.map((p) => p.id)) } })).map((p) => p.retryOf)
        : [],
    );
    const candidates = failed.filter((p) => !alreadyRetried.has(p.id));
    const merchants = candidates.length
      ? await this.merchants.find({ where: { id: In(candidates.map((p) => p.merchantId)) } })
      : [];
    const byId = new Map(merchants.map((m) => [m.id, m]));

    const retries: Payout[] = [];
    const notRetried: Array<{ payoutId: string; payoutCode: string; reason: string }> = [];
    for (const p of candidates) {
      const m = byId.get(p.merchantId);
      if (!m || m.status !== MerchantStatus.Active || !m.xenditAccountId
        || !m.payoutChannelCode || !m.payoutAccountNumber || !m.payoutAccountHolderName) {
        notRetried.push({ payoutId: p.id, payoutCode: p.code, reason: 'merchant_not_payable' });
        continue;
      }
      retries.push(this.payouts.create({
        runId,
        merchantId: m.id,
        appId: m.appId,
        amount: p.amount,
        currency: p.currency,
        balanceAtBuild: p.balanceAtBuild,
        description: p.description,
        status: PayoutStatus.Queued,
        channelCode: m.payoutChannelCode,
        accountNumber: m.payoutAccountNumber,
        accountHolderName: m.payoutAccountHolderName,
        xenditAccountId: m.xenditAccountId,
        retryOf: p.id,
      }));
    }
    if (retries.length) {
      await this.payouts.save(retries);
      run.status = PayoutRunStatus.Queued;
      run.completedAt = null;
      await this.runs.save(run);
      await this.queue.enqueue({ type: 'execute', runId });
    }
    return { retried: retries.length, notRetried, run: await this.detail(runId) };
  }

  /** Pulls one payout's state from Xendit — for a lost webhook. */
  async syncPayout(payoutId: string) {
    const payout = await this.payouts.findOne({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException({ error: 'payout_not_found', message: `Payout ${payoutId} not found` });
    if (payout.status === PayoutStatus.Draft || payout.status === PayoutStatus.Skipped) {
      return payoutView(payout, false);
    }
    const result = payout.xenditPayoutId
      ? await this.xendit.getPayout(payout.xenditPayoutId, payout.xenditAccountId)
      : await this.xendit.findPayoutByReference(payout.id, payout.xenditAccountId);
    if (result) await this.applyResult(payout, result);
    return payoutView(payout, false);
  }

  // ─── Reads ───────────────────────────────────────────────────────────

  async list(q: ListPayoutRunsDto): Promise<Paged<PayoutRun>> {
    const qb = this.runs.createQueryBuilder('r').leftJoinAndSelect('r.app', 'app');
    if (q.status) qb.andWhere('r.status = :status', { status: q.status });
    if (q.appId) qb.andWhere('r.app_id = :appId', { appId: q.appId });
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    qb.orderBy('r.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return toPaged(data, total, page, pageSize);
  }

  async detail(runId: string) {
    const run = await this.runs.findOne({ where: { id: runId }, relations: { app: true } });
    if (!run) throw new NotFoundException({ error: 'payout_run_not_found', message: `Payout run ${runId} not found` });
    const payouts = await this.payouts.find({
      where: { runId },
      relations: { merchant: true, app: true },
      order: { createdAt: 'ASC' },
    });
    const counts: Partial<Record<PayoutStatus, number>> = {};
    const amounts: Partial<Record<PayoutStatus, number>> = {};
    for (const p of payouts) {
      counts[p.status] = (counts[p.status] ?? 0) + 1;
      amounts[p.status] = (amounts[p.status] ?? 0) + p.amount;
    }
    return {
      ...run,
      previewExpiresAt: run.builtAt ? new Date(new Date(run.builtAt).getTime() + RUN_PREVIEW_TTL_MS) : null,
      counts,
      amounts,
      payouts: payouts.map((p) => ({
        ...payoutView(p, false),
        merchantName: p.merchant?.name ?? null,
        merchantExternalRef: p.merchant?.externalRef ?? null,
        appName: p.app?.name ?? null,
        balanceAtBuild: p.balanceAtBuild ?? null,
      })),
    };
  }

  async exportCsv(runId: string): Promise<string> {
    const d = await this.detail(runId);
    // Display codes, not UUIDs. retry_of points at a payout in the same run.
    const codeById = new Map(d.payouts.map((p) => [p.id, p.code]));
    const header = [
      'run', 'payout', 'app', 'merchant', 'external_ref', 'channel', 'account_number',
      'account_holder', 'amount', 'currency', 'status', 'failure_code', 'failure_message',
      'xendit_payout_id', 'retry_of', 'sent_at', 'completed_at',
    ];
    const rows = d.payouts.map((p) => [
      d.code, p.code, p.appName, p.merchantName, p.merchantExternalRef, p.channelCode, p.accountNumber,
      p.accountHolderName, ((p.amount as number) / 100).toFixed(2), p.currency, p.status, p.failureCode,
      p.failureMessage, p.xenditPayoutId, p.retryOf ? codeById.get(p.retryOf) ?? null : null, iso(p.sentAt), iso(p.completedAt),
    ]);
    return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  }

  // ─── Worker: build ───────────────────────────────────────────────────

  async build(runId: string): Promise<void> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run || run.status !== PayoutRunStatus.Building) return;

    try {
      // A retried build starts clean.
      await this.payouts.delete({ runId, status: PayoutStatus.Draft });

      const apps = await this.apps.find({
        where: run.appId ? { id: run.appId, marketplaceEnabled: true } : { marketplaceEnabled: true },
      });
      const appById = new Map(apps.map((a) => [a.id, a]));
      const merchants = apps.length
        ? await this.merchants.find({
            where: { appId: In(apps.map((a) => a.id)), status: In([MerchantStatus.Active, MerchantStatus.Paused]) },
            order: { name: 'ASC' },
          })
        : [];
      const inFlight = new Set(
        (merchants.length
          ? await this.payouts.find({
              where: {
                merchantId: In(merchants.map((m) => m.id)),
                status: In([PayoutStatus.Queued, PayoutStatus.Pending]),
              },
              select: { merchantId: true },
            })
          : []).map((p) => p.merchantId),
      );
      const reserve = this.xendit.payoutFeeReserve();
      const excluded: ExcludedMerchant[] = [];
      const drafts: Payout[] = [];

      await mapWithConcurrency(merchants, BALANCE_READ_CONCURRENCY, async (m): Promise<void> => {
        const app = appById.get(m.appId);
        if (!app) return;
        const exclude = (reason: ExcludedMerchant['reason'], balance: number | null, detail?: string): void => {
          excluded.push({ merchantId: m.id, merchantName: m.name, appId: m.appId, balance, reason, detail });
        };

        if (m.status === MerchantStatus.Paused) { exclude('paused', null); return; }
        if (!m.xenditAccountId) { exclude('no_sub_account', null); return; }
        if (inFlight.has(m.id)) { exclude('payout_in_progress', null); return; }

        let balance: number;
        try {
          balance = await this.xendit.getBalance(m.xenditAccountId, PAYOUT_CURRENCY);
        } catch (err) {
          exclude('balance_error', null, errorMessage(err));
          return;
        }
        if (!m.payoutChannelCode || !m.payoutAccountNumber || !m.payoutAccountHolderName) {
          exclude('no_payout_destination', balance);
          return;
        }
        // Xendit charges its payout fee on top of the amount, so leave it behind.
        const amount = balance - reserve;
        if (amount <= 0 || amount < app.marketplaceMinPayout) {
          exclude('below_minimum', balance, `Payable ${Math.max(0, amount)} < minimum ${app.marketplaceMinPayout}`);
          return;
        }
        drafts.push(this.payouts.create({
          runId,
          merchantId: m.id,
          appId: m.appId,
          amount,
          currency: PAYOUT_CURRENCY,
          balanceAtBuild: balance,
          description: `${app.name} payout`,
          status: PayoutStatus.Draft,
          channelCode: m.payoutChannelCode,
          accountNumber: m.payoutAccountNumber,
          accountHolderName: m.payoutAccountHolderName,
          xenditAccountId: m.xenditAccountId,
        }));
      });

      if (drafts.length) await this.payouts.save(drafts, { chunk: 200 });
      run.excluded = excluded;
      run.totalAmount = drafts.reduce((s, p) => s + p.amount, 0);
      run.payoutCount = drafts.length;
      run.builtAt = new Date();
      run.status = PayoutRunStatus.Draft;
      run.errorMessage = null;
      await this.runs.save(run);
    } catch (err) {
      this.logger.error(`Payout run ${runId} build failed: ${errorMessage(err)}`);
      run.status = PayoutRunStatus.BuildFailed;
      run.errorMessage = errorMessage(err);
      await this.runs.save(run);
    }
  }

  // ─── Worker: execute ─────────────────────────────────────────────────

  /**
   * Sends every `queued` payout in the run, one at a time. Safe to re-run:
   * only `queued` payouts are sent, and each uses its own id as the Xendit
   * idempotency key. On a transport error the payout stays queued and this
   * throws so Bull retries; on the last attempt it's marked failed instead.
   */
  async execute(runId: string, opts: { lastAttempt: boolean }): Promise<void> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run || (run.status !== PayoutRunStatus.Queued && run.status !== PayoutRunStatus.Processing)) return;
    if (run.status !== PayoutRunStatus.Processing) {
      run.status = PayoutRunStatus.Processing;
      await this.runs.save(run);
    }

    const queued = await this.payouts.find({ where: { runId, status: PayoutStatus.Queued }, order: { createdAt: 'ASC' } });
    const merchants = queued.length
      ? await this.merchants.find({ where: { id: In(queued.map((p) => p.merchantId)) } })
      : [];
    const emailById = new Map(merchants.map((m) => [m.id, m.email]));
    let transportErrors = 0;

    for (const payout of queued) {
      // confirm() snapshots all four; a row without them can't be sent.
      const { xenditAccountId, channelCode, accountNumber, accountHolderName } = payout;
      if (!xenditAccountId || !channelCode || !accountNumber || !accountHolderName) {
        await this.markFailed(payout, 'missing_destination', 'Payout has no sub-account or payout destination');
        continue;
      }
      try {
        const result = await this.xendit.createPayout({
          forUserId: xenditAccountId,
          referenceId: payout.id,
          channelCode,
          accountNumber,
          accountHolderName,
          amount: payout.amount,
          currency: payout.currency,
          description: payout.description,
          email: emailById.get(payout.merchantId) ?? null,
        });
        payout.sentAt = new Date();
        await this.applyResult(payout, result, { fromQueued: true });
      } catch (err) {
        if (isDefinitiveRejection(err)) {
          await this.markFailed(payout, errorCode(err) ?? 'rejected', errorMessage(err));
          continue;
        }
        // The request may or may not have reached Xendit — look it up by reference.
        const found = await this.xendit.findPayoutByReference(payout.id, payout.xenditAccountId).catch(() => null);
        if (found) {
          payout.sentAt = new Date();
          await this.applyResult(payout, found, { fromQueued: true });
          continue;
        }
        if (opts.lastAttempt) {
          await this.markFailed(payout, 'send_error', errorMessage(err));
        } else {
          payout.failureMessage = `Send attempt failed, will retry: ${errorMessage(err)}`;
          await this.payouts.save(payout);
          transportErrors += 1;
        }
      }
    }

    await this.refreshRunStatus(runId);
    if (transportErrors > 0) {
      throw new Error(`${transportErrors} payout(s) in run ${runId} hit transport errors; retrying`);
    }
  }

  // ─── Status updates (worker + webhook + sync) ────────────────────────

  /** Applies a Xendit payout result. Out-of-order or repeated callbacks are
   *  ignored by canTransitionPayout; app webhooks fire only on a real change. */
  async applyResult(
    payout: Payout,
    result: XenditPayoutResult | { id: string; providerStatus: string; status: PayoutStatus; failureCode: string | null; estimatedArrivalAt?: Date | null; raw: Record<string, unknown> },
    opts: { fromQueued?: boolean } = {},
  ): Promise<boolean> {
    payout.xenditPayoutId ??= result.id;
    payout.providerStatus = result.providerStatus;
    payout.raw = result.raw;
    if (result.estimatedArrivalAt) payout.estimatedArrivalAt = result.estimatedArrivalAt;

    const before = payout.status;
    const changed = canTransitionPayout(before, result.status);
    if (changed) {
      payout.status = result.status;
      if (result.status === PayoutStatus.Failed || result.status === PayoutStatus.Reversed) {
        payout.failureCode = result.failureCode ?? payout.failureCode ?? null;
      } else {
        payout.failureMessage = null;
      }
      if ([PayoutStatus.Succeeded, PayoutStatus.Failed, PayoutStatus.Reversed, PayoutStatus.Canceled].includes(result.status)) {
        payout.completedAt = new Date();
      }
    }
    await this.payouts.save(payout);
    if (changed) await this.notify(payout);
    if (changed && !opts.fromQueued && payout.runId) await this.refreshRunStatus(payout.runId);
    return changed;
  }

  /** Webhook entry point: finds the payout by Xendit id or by our reference. */
  async applyWebhook(update: {
    xenditPayoutId: string;
    referenceId: string | null;
    providerStatus: string;
    status: PayoutStatus;
    failureCode: string | null;
    raw: Record<string, unknown>;
  }): Promise<{ matched: boolean; changed: boolean }> {
    let payout = await this.payouts.findOne({ where: { xenditPayoutId: update.xenditPayoutId } });
    if (!payout && update.referenceId && UUID_RE.test(update.referenceId)) {
      payout = await this.payouts.findOne({ where: { id: update.referenceId } });
    }
    if (!payout) return { matched: false, changed: false };
    const changed = await this.applyResult(payout, { id: update.xenditPayoutId, ...update });
    return { matched: true, changed };
  }

  private async markFailed(payout: Payout, code: string, message: string): Promise<void> {
    if (!canTransitionPayout(payout.status, PayoutStatus.Failed)) return;
    payout.status = PayoutStatus.Failed;
    payout.failureCode = code;
    payout.failureMessage = message;
    payout.completedAt = new Date();
    await this.payouts.save(payout);
    await this.notify(payout);
  }

  private async notify(payout: Payout): Promise<void> {
    const merchant = await this.merchants.findOne({ where: { id: payout.merchantId } });
    if (!merchant) return;
    if (payout.status === PayoutStatus.Succeeded) {
      await this.events.emit('merchant.payout_sent', merchant, { eventKey: `${payout.id}_succeeded`, payout, raw: payout.raw });
    } else if ([PayoutStatus.Failed, PayoutStatus.Reversed, PayoutStatus.Canceled].includes(payout.status)) {
      await this.events.emit('merchant.payout_failed', merchant, { eventKey: `${payout.id}_${payout.status}`, payout, raw: payout.raw });
    }
  }

  async refreshRunStatus(runId: string): Promise<void> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run || (run.status !== PayoutRunStatus.Processing && run.status !== PayoutRunStatus.Queued
      && run.status !== PayoutRunStatus.Completed && run.status !== PayoutRunStatus.CompletedWithFailures)) return;
    const payouts = await this.payouts.find({ where: { runId }, select: { status: true, retryOf: true, id: true } });
    // A failed payout that has been retried no longer counts against the run.
    const retried = new Set(payouts.map((p) => p.retryOf).filter(Boolean));
    const relevant = payouts.filter((p) => p.status !== PayoutStatus.Skipped && !retried.has(p.id)).map((p) => p.status);
    const settled = settledRunStatus(relevant);
    if (settled && settled !== run.status) {
      run.status = settled;
      run.completedAt = new Date();
      await this.runs.save(run);
    } else if (!settled && run.status !== PayoutRunStatus.Processing && run.status !== PayoutRunStatus.Queued) {
      // e.g. a succeeded payout bounced back after the run had completed.
      run.status = PayoutRunStatus.Processing;
      run.completedAt = null;
      await this.runs.save(run);
    }
  }

  private async getRun(runId: string): Promise<PayoutRun> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException({ error: 'payout_run_not_found', message: `Payout run ${runId} not found` });
    return run;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function iso(v: unknown): string {
  return v ? new Date(v as string).toISOString() : '';
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  // Neutralise spreadsheet formula injection and quote anything with separators.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
