import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Provider } from '../../common/enums';
import { Merchant, Transaction } from '../../database/entities';
import { XenditAdapter } from '../../payment-providers/xendit.adapter';
import { parseMarketplaceWebhook } from '../../payment-providers/xendit-platform.client';
import { MerchantsService } from './merchants.service';
import { PayoutRunsService } from './payout-runs.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Receives the Xendit callbacks the marketplace needs, all on one URL:
 * payout results, sub-account status, and split results. Every handler is
 * idempotent (state transitions only move forward), so Xendit's retries and
 * duplicates are harmless. Unknown references get a 200 — a 4xx would make
 * Xendit retry something AcePay can never match.
 *
 * Invoice "paid" callbacks for marketplace payments still go to the existing
 * /v1/webhooks/xendit receiver: the invoice external_id is the AcePay
 * transaction id, so the normal payment pipeline handles them.
 */
@Injectable()
export class MarketplaceWebhooksService {
  private readonly logger = new Logger(MarketplaceWebhooksService.name);

  constructor(
    @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    private readonly xenditAdapter: XenditAdapter,
    private readonly merchantsService: MerchantsService,
    private readonly payoutRuns: PayoutRunsService,
  ) {}

  async handle(rawBody: Buffer, token: string | undefined) {
    let payload: unknown;
    try {
      payload = this.xenditAdapter.verifyWebhook(rawBody, token);
    } catch (err) {
      throw new BadRequestException({ error: 'invalid_signature', message: err instanceof Error ? err.message : String(err) });
    }
    const evt = parseMarketplaceWebhook(payload);

    switch (evt.kind) {
      case 'payout': {
        const r = await this.payoutRuns.applyWebhook(evt);
        if (!r.matched) this.logger.warn(`Payout callback for unknown payout ${evt.xenditPayoutId} (ref ${evt.referenceId})`);
        return { ok: true, kind: evt.kind, ...r };
      }
      case 'account': {
        const merchant = await this.merchants.findOne({ where: { xenditAccountId: evt.accountId } });
        if (!merchant) {
          this.logger.warn(`Account callback for unknown sub-account ${evt.accountId}`);
          return { ok: true, kind: evt.kind, matched: false };
        }
        if (evt.providerStatus) await this.merchantsService.applyAccountStatus(merchant, evt.providerStatus, evt.raw);
        return { ok: true, kind: evt.kind, matched: true };
      }
      case 'split': {
        // payment_reference_id is the invoice external_id = AcePay tx id.
        const ref = evt.paymentReferenceId && UUID_RE.test(evt.paymentReferenceId) ? evt.paymentReferenceId : null;
        let tx = ref ? await this.transactions.findOne({ where: { id: ref } }) : null;
        if (!tx && evt.paymentId) {
          tx = await this.transactions.findOne({ where: { providerTxId: evt.paymentId, provider: Provider.Xendit } });
        }
        if (!tx || !tx.merchantId) {
          this.logger.warn(`Split callback ${evt.splitId} matched no marketplace transaction`);
          return { ok: true, kind: evt.kind, matched: false };
        }
        tx.splitStatus = evt.status;
        if (evt.status === 'completed' && evt.amount != null) {
          // Record what Xendit actually routed (rounding can differ by a centavo).
          tx.platformFeeAmount = evt.amount;
          tx.merchantAmount = tx.amount - evt.amount;
        }
        tx.metadata = {
          ...(tx.metadata ?? {}),
          split: { id: evt.splitId, status: evt.status, failureCode: evt.failureCode },
        };
        await this.transactions.save(tx);
        if (evt.status === 'failed') {
          this.logger.error(`Platform fee split FAILED for tx ${tx.id}: ${evt.failureCode}`);
        }
        return { ok: true, kind: evt.kind, matched: true };
      }
      default:
        this.logger.debug(`Ignoring marketplace callback "${evt.event}"`);
        return { ok: true, kind: 'unknown' };
    }
  }
}
