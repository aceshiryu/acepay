import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  apiKeyPrefix, encryptSecret, generateApiKey, generateWebhookSecret, sha256,
} from '../../common/crypto';
import { BillingMode, PlanRegion, Provider } from '../../common/enums';
import { App, Plan } from '../../database/entities';
import { LemonsqueezyAdapter } from '../../payment-providers/lemonsqueezy.adapter';
import { CustomersAppService } from '../customers/customers-app.service';
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
  checkoutUrl: string;
  provider: Provider;
  customerId: string;
}

@Injectable()
export class AppsService {
  constructor(
    @InjectRepository(App) private readonly apps: Repository<App>,
    private readonly dataSource: DataSource,
    private readonly lsAdapter: LemonsqueezyAdapter,
    private readonly customersApp: CustomersAppService,
    private readonly subscriptionsApp: SubscriptionsAppService,
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
    if (dto.billingMode === BillingMode.Subscription && (!dto.plans || dto.plans.length === 0)) {
      throw new BadRequestException({
        error: 'plans_required',
        message: 'Subscription apps must register at least one plan',
      });
    }

    // Resolve each plan's authoritative price/currency/interval. For LS we
    // verify the variant id against the live store; for Xendit we trust the
    // operator-entered values (Xendit has no plan resource).
    const resolvedPlans: Array<{
      title: string; description?: string; region: PlanRegion;
      provider: Provider; providerPlanId: string;
      amount: number; currency: string; interval: string; intervalCount: number;
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
      } else {
        throw new BadRequestException({
          error: 'unsupported_provider',
          message: `Provider ${p.provider} is not supported for subscription plans`,
        });
      }
    }

    const apiKey = generateApiKey(slug, 'live');
    const webhookSecret = generateWebhookSecret();

    // Transaction: app + plans together, so a partial failure leaves no orphans.
    return this.dataSource.transaction(async (manager) => {
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
      });
      const savedApp = await manager.save(app);

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
  }

  findAll(): Promise<App[]> {
    return this.apps.find({ order: { createdAt: 'DESC' } });
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
    });
    return this.apps.save(app);
  }

  async setActive(id: string, isActive: boolean): Promise<App> {
    const app = await this.findOneOrFail(id);
    app.isActive = isActive;
    return this.apps.save(app);
  }

  async regenerateApiKey(id: string): Promise<{ app: App; apiKey: string }> {
    const app = await this.findOneOrFail(id);
    const apiKey = generateApiKey(app.slug, 'live');
    app.apiKeyPrefix = apiKeyPrefix(apiKey);
    app.apiKeyHash = sha256(apiKey);
    const saved = await this.apps.save(app);
    return { app: saved, apiKey };
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
      metadata: { sandbox: true, triggeredBy: 'admin' },
    });
    return {
      subscriptionId: result.subscription.id,
      checkoutUrl: result.checkoutUrl,
      provider: result.subscription.provider,
      customerId: customer.id,
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
