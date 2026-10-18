import { normalizePaymentMethods } from '../../common/payment-methods';
import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import {
  apiKeyPrefix, encryptSecret, generateApiKey, generateWebhookSecret, sha256,
} from '../../common/crypto';
import { BillingMode, PayoutStatus, PlanInterval, PlanRegion, Provider, SubscriptionStatus } from '../../common/enums';
import { App, Payout, Plan, Subscription } from '../../database/entities';
import { PlatformSetting } from '../../database/entities/platform-setting.entity';
import { appPrefsKey } from './app-preferences.service';
import { LemonsqueezyAdapter } from '../../payment-providers/lemonsqueezy.adapter';
import { PaymongoAdapter } from '../../payment-providers/paymongo.adapter';
import { CustomersAppService } from '../customers/customers-app.service';
import { AppConfigService, snapshot } from '../marketplace/app-config.service';
import { MarketplaceDefaultsService } from '../marketplace/marketplace-defaults.service';
import { SubscriptionsAppService } from '../subscriptions/subscriptions-app.service';
import { CreateAppDto } from './dto/create-app.dto';
import { TestSubscriptionDto } from './dto/test-subscription.dto';
import { UpdateAppDto } from './dto/update-app.dto';

export interface AppWithKey {
  app: App;
  apiKey: string;
  webhookSecret: string;
  plans: Plan[];
}

export interface SandboxRunResult {
  subscriptionId: string;
  subscriptionCode: string;
  checkoutUrl: string;
  provider: Provider;
  customerId: string;
  customerCode: string;
}

@Injectable()
export class AppsService {
  private readonly logger = new Logger(AppsService.name);

  constructor(
    @InjectRepository(App) private readonly apps: Repository<App>,
    private readonly dataSource: DataSource,
    private readonly lsAdapter: LemonsqueezyAdapter,
    private readonly paymongo: PaymongoAdapter,
    private readonly customersApp: CustomersAppService,
    private readonly subscriptionsApp: SubscriptionsAppService,
    private readonly marketplaceDefaults: MarketplaceDefaultsService,
    private readonly appConfig: AppConfigService,
  ) {}

  async create(dto: CreateAppDto): Promise<AppWithKey> {
    const slug = (dto.slug ?? slugify(dto.name)).toLowerCase();
    const existing = await this.apps.findOne({ where: { slug } });
    if (existing) {
      throw new ConflictException({
        error: 'slug_taken',
        message: `An app with slug "${slug}" already exists`,
      });
    }

    if (dto.billingMode === BillingMode.OneTime && dto.plans && dto.plans.length > 0) {
      throw new BadRequestException({
        error: 'plans_not_allowed',
        message: 'One-time-payment apps cannot have subscription plans',
      });
    }
    if (dto.provider) {
      // Xendit and PayMongo apps can charge without plans (marketplace /
      // one-time payments); Lemon Squeezy only takes money through plans.
      if (dto.provider === Provider.Lemonsqueezy && (!dto.plans || dto.plans.length === 0)) {
        throw new BadRequestException({
          error: 'plans_required',
          message: `Add at least one plan — ${dto.provider} apps take payments through subscription plans`,
        });
      }
      const other = (dto.plans ?? []).find((p) => p.provider !== dto.provider);
      if (other) {
        throw new BadRequestException({
          error: 'provider_mismatch',
          message: `Every plan must use ${dto.provider}; "${other.title}" uses ${other.provider}`,
        });
      }
    }
    // Plans are optional at registration — an app can be registered first and
    // have plans added later from the Plans page.

    // Resolve each plan's authoritative price/currency/interval. For LS we
    // verify the variant id against the live store; for Xendit we trust the
    // operator-entered values (Xendit has no plan resource).
    const resolvedPlans: Array<{
      title: string; description?: string; region: PlanRegion;
      provider: Provider; providerPlanId: string;
      amount: number; currency: string; interval: string; intervalCount: number;
      /** PayMongo plan still to be created/looked up (after validation). */
      pendingPaymongo?: boolean;
    }> = [];
    for (const p of dto.plans ?? []) {
      if (p.provider === Provider.Lemonsqueezy) {
        if (!p.variantId) {
          throw new BadRequestException({
            error: 'variant_id_required',
            message: 'Lemon Squeezy plans require variantId',
          });
        }
        const v = await this.lsAdapter.lookupVariant(p.variantId);
        if (!v.isSubscription) {
          throw new BadRequestException({
            error: 'variant_not_subscription',
            message: `Lemon Squeezy variant ${p.variantId} ("${v.name}") is not subscription-priced — pick a Subscription variant or change its pricing in LS`,
          });
        }
        if (!v.interval) {
          throw new BadRequestException({
            error: 'variant_unsupported_interval',
            message: `Lemon Squeezy variant ${p.variantId} has an unsupported interval — AcePay supports weekly, monthly, yearly`,
          });
        }
        resolvedPlans.push({
          title: p.title, description: p.description, region: p.region,
          provider: Provider.Lemonsqueezy, providerPlanId: p.variantId,
          amount: v.price, currency: v.currency || 'USD',
          interval: v.interval, intervalCount: v.intervalCount,
        });
      } else if (p.provider === Provider.Xendit) {
        if (!p.amount || !p.currency || !p.interval) {
          throw new BadRequestException({
            error: 'xendit_plan_fields_required',
            message: 'Xendit plans require amount, currency, and interval (Xendit has no provider-side plan resource — AcePay manages the schedule)',
          });
        }
        // Xendit has no Plan object — synthesize a stable provider id from the title.
        const synthetic = `xendit_acepay_${slugify(p.title)}`;
        resolvedPlans.push({
          title: p.title, description: p.description, region: p.region,
          provider: Provider.Xendit, providerPlanId: synthetic,
          amount: p.amount, currency: p.currency,
          interval: p.interval, intervalCount: p.intervalCount ?? 1,
        });
      } else if (p.provider === Provider.Paymongo) {
        // Created in PayMongo below, after the slug check — the PayMongo plan
        // is a real side effect, so nothing is created if registration is
        // going to be rejected anyway. Validate the fields now for a clean 400.
        if (!p.paymongoPlanId && (!p.amount || !p.currency || !p.interval)) {
          throw new BadRequestException({
            error: 'paymongo_plan_fields_required',
            message: 'PayMongo plans need amount, currency and interval (or paymongoPlanId of a plan you already made in PayMongo)',
          });
        }
        resolvedPlans.push({
          title: p.title, description: p.description, region: p.region,
          provider: Provider.Paymongo, providerPlanId: p.paymongoPlanId ?? '',
          amount: p.amount ?? 0, currency: p.currency ?? 'PHP',
          interval: p.interval ?? PlanInterval.Monthly, intervalCount: p.intervalCount ?? 1,
          pendingPaymongo: true,
        });
      } else {
        throw new BadRequestException({
          error: 'unsupported_provider',
          message: `Provider ${p.provider} is not supported for subscription plans`,
        });
      }
    }

    // Reject before opening the transaction if two inline plans would collide
    // on the (app_id, slug) unique key. Common case: operator names two plans
    // "Pro Monthly" (one for LS / international, one for Xendit / local) —
    // both slugify to "pro-monthly". Without this check the second insert
    // explodes with a 500 and the user sees nothing useful.
    const slugCounts = new Map<string, string[]>();
    for (const rp of resolvedPlans) {
      const s = slugify(rp.title);
      const titles = slugCounts.get(s) ?? [];
      titles.push(rp.title);
      slugCounts.set(s, titles);
    }
    const collisions = [...slugCounts.values()].filter((titles) => titles.length > 1);
    if (collisions.length > 0) {
      const offenders = collisions.map((titles) => titles.map((t) => `"${t}"`).join(' / ')).join('; ');
      throw new BadRequestException({
        error: 'plan_slug_collision',
        message: `Plans would share the same slug — rename one of: ${offenders}. Tip: append the region (e.g. "Pro Monthly (PH)" vs "Pro Monthly (Global)").`,
      });
    }

    for (const rp of resolvedPlans) {
      if (!rp.pendingPaymongo) continue;
      const pm = await this.paymongo.resolvePlan({
        existingPlanId: rp.providerPlanId || null,
        name: `${dto.name} — ${rp.title}`, description: rp.description,
        amount: rp.amount, currency: rp.currency,
        interval: rp.interval as PlanInterval, intervalCount: rp.intervalCount,
      });
      Object.assign(rp, {
        providerPlanId: pm.planId, amount: pm.amount, currency: pm.currency,
        interval: pm.interval, intervalCount: pm.intervalCount, pendingPaymongo: false,
      });
    }

    const apiKey = generateApiKey(slug, 'live');
    const webhookSecret = generateWebhookSecret();

    // New apps start from the operator's marketplace defaults (a copy — later
    // edits to the defaults never change this app).
    const marketplace = await this.marketplaceDefaults.appFields();

    // Transaction: app + plans together, so a partial failure leaves no orphans.
    const created = await this.dataSource.transaction(async (manager) => {
      const app = manager.create(App, {
        name: dto.name,
        slug,
        apiKeyPrefix: apiKeyPrefix(apiKey),
        apiKeyHash: sha256(apiKey),
        webhookUrl: dto.webhookUrl ?? null,
        webhookSecretEnc: encryptSecret(webhookSecret),
        requiredMetadata: dto.requiredMetadata ?? [],
        optionalMetadata: dto.optionalMetadata ?? [],
        rateLimit: dto.rateLimit ?? 100,
        billingMode: dto.billingMode,
        isActive: dto.isActive ?? true,
        paymentMethods: dto.paymentMethods !== undefined ? normalizePaymentMethods(dto.paymentMethods) : null,
        ...marketplace,
      });
      const savedApp = await manager.save(app);
      if (dto.provider) {
        // Remember the provider the app was added under (apps have no column for it).
        await manager.save(manager.create(PlatformSetting, {
          key: appPrefsKey(savedApp.id), value: { provider: dto.provider, hiddenMenus: [] },
        }));
      }

      const savedPlans: Plan[] = [];
      for (const rp of resolvedPlans) {
        const plan = manager.create(Plan, {
          appId: savedApp.id,
          name: rp.title,
          slug: slugify(rp.title),
          description: rp.description ?? null,
          region: rp.region,
          amount: rp.amount,
          currency: rp.currency.toUpperCase(),
          interval: rp.interval as Plan['interval'],
          intervalCount: rp.intervalCount,
          provider: rp.provider,
          providerPlanId: rp.providerPlanId,
          isActive: true,
        });
        savedPlans.push(await manager.save(plan));
      }
      return { app: savedApp, apiKey, webhookSecret, plans: savedPlans };
    });

    // Record where the starting marketplace settings came from.
    await this.appConfig.record(created.app.id, 'admin', 'platform defaults', {}, snapshot(created.app));
    return created;
  }

  /** Archived apps are left out unless `archived` asks for only them. */
  findAll(opts: { archived?: boolean } = {}): Promise<App[]> {
    return this.apps.find({
      where: { archivedAt: opts.archived ? Not(IsNull()) : IsNull() },
      order: opts.archived ? { archivedAt: 'DESC' } : { createdAt: 'DESC' },
    });
  }

  async findOneOrFail(id: string): Promise<App> {
    const app = await this.apps.findOne({ where: { id } });
    if (!app) {
      throw new NotFoundException({
        error: 'app_not_found',
        message: `App ${id} not found`,
      });
    }
    return app;
  }

  async update(id: string, dto: UpdateAppDto): Promise<App> {
    const app = await this.findOneOrFail(id);
    Object.assign(app, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.webhookUrl !== undefined && { webhookUrl: dto.webhookUrl }),
      ...(dto.requiredMetadata !== undefined && { requiredMetadata: dto.requiredMetadata }),
      ...(dto.optionalMetadata !== undefined && { optionalMetadata: dto.optionalMetadata }),
      ...(dto.rateLimit !== undefined && { rateLimit: dto.rateLimit }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.paymentMethods !== undefined && { paymentMethods: normalizePaymentMethods(dto.paymentMethods) }),
    });
    return this.apps.save(app);
  }

  async setActive(id: string, isActive: boolean): Promise<App> {
    const app = await this.findOneOrFail(id);
    if (isActive && app.archivedAt) {
      throw new BadRequestException({
        error: 'app_archived',
        message: `${app.name} is archived — restore it before activating it`,
      });
    }
    app.isActive = isActive;
    return this.apps.save(app);
  }

  /**
   * Hide the app everywhere in the admin and stop its API key (is_active
   * false), keeping all its history. Reversible with `restore`.
   */
  async archive(id: string): Promise<App> {
    const app = await this.findOneOrFail(id);
    app.archivedAt ??= new Date();
    app.isActive = false;
    return this.apps.save(app);
  }

  /** Back into the lists — still deactivated, so turning it on is a separate, deliberate step. */
  async restore(id: string): Promise<App> {
    const app = await this.findOneOrFail(id);
    if (!app.archivedAt) return app;
    app.archivedAt = null;
    return this.apps.save(app);
  }

  /**
   * Remove the app and everything that belongs to it — plans, customers,
   * subscriptions, transactions and their logs, webhook events, merchants,
   * payouts, config history, admin preferences. Cannot be undone.
   *
   * Guarded so it can't strand money or customers: the app must already be
   * archived, the caller must type its exact name, and it is refused while a
   * subscription could still be billed by the provider (active / past due /
   * paused — the provider would keep charging with no AcePay record) or while
   * a payout is on its way to a merchant.
   */
  async deletePermanently(id: string, confirmName: string | undefined, actor: string | null): Promise<{ id: string; name: string }> {
    const app = await this.findOneOrFail(id);
    if (!app.archivedAt) {
      throw new BadRequestException({
        error: 'app_not_archived',
        message: `Archive ${app.name} first — only an archived app can be permanently deleted`,
      });
    }
    if ((confirmName ?? '').trim() !== app.name) {
      throw new BadRequestException({
        error: 'confirmation_mismatch',
        message: `Type the app's name exactly ("${app.name}") to confirm`,
      });
    }

    await this.dataSource.transaction(async (m) => {
      const liveSubs = await m.count(Subscription, {
        where: { appId: id, status: In([SubscriptionStatus.Active, SubscriptionStatus.PastDue, SubscriptionStatus.Paused]) },
      });
      if (liveSubs > 0) {
        throw new ConflictException({
          error: 'app_has_live_subscriptions',
          message: `${app.name} still has ${liveSubs} subscription${liveSubs === 1 ? '' : 's'} that the provider could keep billing. Cancel ${liveSubs === 1 ? 'it' : 'them'} first.`,
        });
      }
      const inFlight = await m.count(Payout, {
        where: { appId: id, status: In([PayoutStatus.Queued, PayoutStatus.Pending]) },
      });
      if (inFlight > 0) {
        throw new ConflictException({
          error: 'app_has_payouts_in_flight',
          message: `${app.name} has ${inFlight} payout${inFlight === 1 ? '' : 's'} still being sent. Wait for ${inFlight === 1 ? 'it' : 'them'} to finish.`,
        });
      }
      // Two child tables RESTRICT their parent (subscriptions → plans,
      // payouts → merchants), so delete them before the app's cascade
      // reaches those parents. Everything else cascades from apps.
      await m.delete(Subscription, { appId: id });
      await m.delete(Payout, { appId: id });
      await m.delete(PlatformSetting, { key: appPrefsKey(id) });
      await m.delete(App, { id });
    });

    this.logger.warn(`App ${app.code} "${app.name}" (${id}) permanently deleted by ${actor ?? 'unknown admin'}`);
    return { id, name: app.name };
  }

  /**
   * Rotate the app's API key.
   *
   * `graceHours` resolves a contradiction the codebase carried: CLAUDE.md and
   * api-key-match.ts describe a rotation grace window, while this endpoint
   * documented immediate revocation — and nothing ever populated the
   * api_key_previous_* columns, so the grace branch could never fire.
   *
   * Immediate revocation stays the default, because the urgent reason to rotate
   * is a leaked key and a grace window is exactly wrong there. An operator doing
   * a routine rotation can ask for a window, which keeps the outgoing key valid
   * so a running app does not break mid-deploy.
   */
  async regenerateApiKey(
    id: string,
    graceHours = 0,
  ): Promise<{ app: App; apiKey: string; previousKeyValidUntil: Date | null }> {
    const app = await this.findOneOrFail(id);

    let previousKeyValidUntil: Date | null = null;
    if (graceHours > 0) {
      previousKeyValidUntil = new Date(Date.now() + graceHours * 3_600_000);
      app.apiKeyPreviousPrefix = app.apiKeyPrefix;
      app.apiKeyPreviousHash = app.apiKeyHash;
      app.apiKeyPreviousExpiresAt = previousKeyValidUntil;
    } else {
      // Revoke outright: clear any window a previous rotation left behind.
      app.apiKeyPreviousPrefix = null;
      app.apiKeyPreviousHash = null;
      app.apiKeyPreviousExpiresAt = null;
    }

    const apiKey = generateApiKey(app.slug, 'live');
    app.apiKeyPrefix = apiKeyPrefix(apiKey);
    app.apiKeyHash = sha256(apiKey);
    const saved = await this.apps.save(app);
    return { app: saved, apiKey, previousKeyValidUntil };
  }

  async regenerateWebhookSecret(id: string): Promise<{ app: App; webhookSecret: string }> {
    const app = await this.findOneOrFail(id);
    const webhookSecret = generateWebhookSecret();
    app.webhookSecretEnc = encryptSecret(webhookSecret);
    const saved = await this.apps.save(app);
    return { app: saved, webhookSecret };
  }

  /** Operator-only: create a real subscription using the app's plan and a test
   *  customer email. Goes through the same SubscriptionsAppService.create code
   *  path that apps use via /v1/subscriptions, so we exercise the full flow
   *  (provider call, webhook delivery, billing queue). Tagged with
   *  metadata.sandbox=true so it's distinguishable from real traffic. */
  async runSandboxSubscription(id: string, dto: TestSubscriptionDto): Promise<SandboxRunResult> {
    const app = await this.findOneOrFail(id);
    if (!app.isActive) {
      throw new BadRequestException({
        error: 'app_inactive',
        message: `App "${app.name}" is deactivated. Activate it first to run a test transaction.`,
      });
    }
    const externalId = `acepay_sandbox_${Date.now()}`;
    const customer = await this.customersApp.upsert(app, {
      externalId,
      email: dto.customerEmail,
      name: dto.customerName,
      metadata: { sandbox: true },
    });
    // SubscriptionsAppService requires a redirect block. For sandbox runs the
    // operator pays via the hosted checkout, so the URLs only matter for the
    // post-pay redirect — point them at the admin dashboard.
    const adminOrigin = (process.env.CORS_ORIGINS?.split(',')[0] ?? 'http://localhost:4000').trim();
    const result = await this.subscriptionsApp.create(app, {
      planId: dto.planId,
      customerId: customer.id,
      redirect: {
        success: dto.redirect ?? `${adminOrigin}/subscriptions`,
        failed:  dto.redirect ?? `${adminOrigin}/subscriptions`,
      },
      metadata: sandboxMetadata(app, dto.metadata),
    });
    return {
      subscriptionId: result.subscription.id,
      subscriptionCode: result.subscription.code,
      checkoutUrl: result.checkoutUrl,
      provider: result.subscription.provider,
      customerId: customer.id,
      customerCode: customer.code,
    };
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Metadata for an admin test run. The app's required keys must be present
 *  (SubscriptionsAppService enforces them), so any the operator didn't give
 *  get a visible `sandbox` placeholder rather than failing the run. */
export function sandboxMetadata(app: Pick<App, 'requiredMetadata'>, given: Record<string, unknown> = {}): Record<string, unknown> {
  const filled: Record<string, unknown> = {};
  for (const key of app.requiredMetadata ?? []) filled[key] = 'sandbox';
  return { ...filled, ...given, sandbox: true, triggeredBy: 'admin' };
}
