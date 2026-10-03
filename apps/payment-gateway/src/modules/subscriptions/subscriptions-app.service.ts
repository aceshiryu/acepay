import {
  BadRequestException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import { BillingMode, SubscriptionStatus } from '../../common/enums';
import {
  App, Customer, Subscription,
} from '../../database/entities';
import { MetadataValidatorService } from '../../common/services/metadata-validator.service';
import { ProviderRegistry } from '../../payment-providers/provider.registry';
import { CustomersAppService } from '../customers/customers-app.service';
import { PlansService } from '../plans/plans.service';
import { CancelSubscriptionDto, CreateSubscriptionDto } from './dto/create-subscription.dto';
import { ListSubscriptionsAppDto } from './dto/list-subscriptions-app.dto';

/** Postgres unique_violation. TypeORM wraps the driver error, so check both. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; driverError?: { code?: string } })?.code
    ?? (err as { driverError?: { code?: string } })?.driverError?.code;
  return code === '23505';
}

export interface CreateSubscriptionResponse {
  subscription: Subscription;
  checkoutUrl: string;
}

@Injectable()
export class SubscriptionsAppService {
  constructor(
    @InjectRepository(Subscription) private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly plans: PlansService,
    private readonly providers: ProviderRegistry,
    private readonly customersApp: CustomersAppService,
    private readonly metadataValidator: MetadataValidatorService,
  ) {}

  async create(app: App, dto: CreateSubscriptionDto): Promise<CreateSubscriptionResponse> {
    if (app.billingMode !== BillingMode.Subscription) {
      throw new BadRequestException({
        error: 'app_not_subscription',
        message: `App "${app.name}" is one-time-payment only — use POST /v1/payments instead`,
      });
    }
    // Replay a retried call instead of creating a second subscription. A client
    // that times out cannot tell whether the request landed; without this it
    // retries and the customer gets two subscriptions and two checkout URLs.
    if (dto.idempotencyKey) {
      const existing = await this.subscriptions.findOne({
        where: { appId: app.id, idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        const meta = (existing.metadata ?? {}) as Record<string, unknown>;
        return {
          subscription: existing,
          // The original checkout URL, so the retry sends the customer to the
          // same place rather than a second, competing checkout.
          checkoutUrl: String(meta.checkoutUrl ?? ''),
        };
      }
    }

    // Enforce the app's required-metadata contract before anything is created.
    // app.requiredMetadata is operator-configured and documented as "missing keys
    // are rejected"; it was only ever wired to POST /v1/payments, which was
    // deleted in Slice 3.6, so it silently stopped being enforced anywhere.
    const metadata = this.metadataValidator.validate(app, dto.metadata);

    const plan = await this.plans.findActiveForApp(dto.planId, app.id);

    // Resolve the customer one of two ways:
    //   1. caller passed an existing AcePay customerId → look it up
    //   2. caller passed inline `customer` details → upsert (match on externalId
    //      or email; if found, return that record; otherwise create new). This
    //      lets the app skip the separate POST /v1/customers call on the first
    //      subscription, and safely re-call /v1/subscriptions on retries.
    let customer: Customer | null = null;
    if (dto.customerId) {
      customer = await this.customers.findOne({
        where: { id: dto.customerId, appId: app.id },
      });
      if (!customer) {
        throw new NotFoundException({
          error: 'customer_not_found', message: `Customer ${dto.customerId} not found`,
        });
      }
    } else if (dto.customer) {
      customer = await this.customersApp.upsert(app, dto.customer);
    } else {
      throw new BadRequestException({
        error: 'customer_required',
        message: 'Either `customerId` or `customer` (inline details) is required',
      });
    }

    // Create the AcePay subscription record up front so the app has a stable id
    // to track. status='active' + metadata.awaitingFirstPayment=true is the
    // "checkout sent, waiting for first webhook" state. The webhook handler
    // will clear awaitingFirstPayment and set the providerSubscriptionId once
    // Lemon Squeezy confirms the subscription.
    const subId = randomUUID();
    const provider = this.providers.resolve(plan.provider);

    let createResult;
    try {
      createResult = await provider.createSubscription({
        acepaySubscriptionId: subId,
        appSlug: app.slug,
        providerPlanId: plan.providerPlanId,
        redirect: dto.redirect,
        metadata: {
          ...metadata,
          // Xendit needs the plan amount/currency here since it doesn't have a
          // native Plan resource — the adapter creates a first-cycle Invoice
          // for this amount with should_save_payment_methods=true.
          plan_amount: plan.amount,
          plan_currency: plan.currency,
          plan_interval: plan.interval,
          plan_interval_count: plan.intervalCount,
        },
        customer: { email: customer.email, name: customer.name ?? undefined },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException({ error: 'provider_create_failed', message: msg });
    }

    const sub = this.subscriptions.create({
      id: subId,
      appId: app.id,
      idempotencyKey: dto.idempotencyKey ?? null,
      customerId: customer.id,
      planId: plan.id,
      provider: plan.provider,
      // Until the LS subscription_created webhook arrives, providerSubscriptionId
      // is the checkout id. It gets swapped to the real subscription id by the
      // webhook handler.
      providerSubscriptionId: createResult.providerCheckoutId,
      status: SubscriptionStatus.Active,
      metadata: {
        ...metadata,
        awaitingFirstPayment: true,
        checkoutUrl: createResult.checkoutUrl,
      },
    });
    let saved: Subscription;
    try {
      saved = await this.subscriptions.save(sub);
    } catch (err) {
      // Two requests carrying the same key raced past the read above. The unique
      // index stopped the duplicate — replay the winner rather than surfacing a
      // raw constraint violation as a 500, which is what the caller saw before.
      const replayed = dto.idempotencyKey && isUniqueViolation(err)
        ? await this.subscriptions.findOne({
          where: { appId: app.id, idempotencyKey: dto.idempotencyKey },
        })
        : null;
      if (!replayed) throw err;
      const meta = (replayed.metadata ?? {}) as Record<string, unknown>;
      return { subscription: replayed, checkoutUrl: String(meta.checkoutUrl ?? '') };
    }
    return { subscription: saved, checkoutUrl: createResult.checkoutUrl };
  }

  async findOne(app: App, id: string): Promise<Subscription> {
    const sub = await this.subscriptions.findOne({
      where: { id, appId: app.id },
      relations: { plan: true, customer: true },
    });
    if (!sub) {
      throw new NotFoundException({
        error: 'subscription_not_found', message: `Subscription ${id} not found`,
      });
    }
    return sub;
  }

  async list(app: App, q: ListSubscriptionsAppDto): Promise<Paged<Subscription>> {
    const qb = this.subscriptions.createQueryBuilder('sub')
      .leftJoinAndSelect('sub.plan', 'plan')
      .where('sub.app_id = :appId', { appId: app.id });
    if (q.customerId) qb.andWhere('sub.customer_id = :customerId', { customerId: q.customerId });
    if (q.provider)   qb.andWhere('sub.provider = :provider', { provider: q.provider });
    if (q.status)     qb.andWhere('sub.status = :status', { status: q.status });
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    qb.orderBy('sub.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return toPaged(data, total, page, pageSize);
  }

  async cancel(app: App, id: string, dto: CancelSubscriptionDto): Promise<Subscription> {
    const sub = await this.findOne(app, id);
    if (sub.status === SubscriptionStatus.Canceled) return sub;
    const provider = this.providers.resolve(sub.provider);
    const result = await provider.cancelSubscription(sub.providerSubscriptionId);
    // We deliberately do NOT drop the queued cycle for Xendit. The customer
    // keeps access through currentPeriodEnd. When that scheduled cycle fires,
    // SubscriptionBillingProcessor sees status=Canceled, records a Transaction
    // with status='canceled' (no charge), marks the sub Expired, and stops
    // scheduling further cycles. For LS, the provider handles end-of-period.
    sub.status = result.status;
    sub.cancelAt = result.cancelAt;
    sub.canceledAt = result.canceledAt ?? new Date();
    if (dto.reason) {
      sub.metadata = { ...(sub.metadata ?? {}), cancelReason: dto.reason };
    }
    return this.subscriptions.save(sub);
  }

  /** Undo a not-yet-effective cancel. Only valid while the sub is Canceled and
   *  the paid period hasn't ended. After reactivation the queued cycle (which
   *  we kept on cancel) fires normally and charges as if nothing happened. */
  async reactivate(app: App, id: string): Promise<Subscription> {
    const sub = await this.findOne(app, id);
    if (sub.status === SubscriptionStatus.Active) return sub;
    if (sub.status !== SubscriptionStatus.Canceled) {
      throw new BadRequestException({
        error: 'subscription_not_reactivatable',
        message: `Subscription is ${sub.status}; only canceled subs in their paid period can be reactivated`,
      });
    }
    if (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() <= Date.now()) {
      throw new BadRequestException({
        error: 'subscription_period_already_ended',
        message: 'Paid period has already ended — create a new subscription instead',
      });
    }
    const provider = this.providers.resolve(sub.provider);
    await provider.uncancelSubscription(sub.providerSubscriptionId);
    sub.status = SubscriptionStatus.Active;
    sub.cancelAt = null;
    sub.canceledAt = null;
    if (sub.metadata && 'cancelReason' in sub.metadata) {
      const { cancelReason: _, ...rest } = sub.metadata as Record<string, unknown>;
      sub.metadata = rest;
    }
    return this.subscriptions.save(sub);
  }

  async pause(app: App, id: string): Promise<Subscription> {
    const sub = await this.findOne(app, id);
    if (sub.status === SubscriptionStatus.Paused) return sub;
    const provider = this.providers.resolve(sub.provider);
    const result = await provider.pauseSubscription(sub.providerSubscriptionId);
    sub.status = result.status;
    return this.subscriptions.save(sub);
  }

  async resume(app: App, id: string): Promise<Subscription> {
    const sub = await this.findOne(app, id);
    if (sub.status === SubscriptionStatus.Active) return sub;
    const provider = this.providers.resolve(sub.provider);
    const result = await provider.resumeSubscription(sub.providerSubscriptionId);
    sub.status = result.status;
    return this.subscriptions.save(sub);
  }
}
