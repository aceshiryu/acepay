import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import { BillingMode, Provider } from '../../common/enums';
import { App, Plan } from '../../database/entities';
import { LemonsqueezyAdapter } from '../../payment-providers/lemonsqueezy.adapter';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ListPlansDto } from './dto/list-plans.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(App) private readonly apps: Repository<App>,
    private readonly lsAdapter: LemonsqueezyAdapter,
  ) {}

  async create(dto: CreatePlanDto): Promise<Plan> {
    const app = await this.apps.findOne({ where: { id: dto.appId } });
    if (!app) {
      throw new NotFoundException({ error: 'app_not_found', message: `App ${dto.appId} not found` });
    }
    if (app.billingMode !== BillingMode.Subscription) {
      throw new BadRequestException({
        error: 'app_not_subscription',
        message: `App "${app.name}" is one-time-payment only — switch its billing mode to subscription first`,
      });
    }
    const collision = await this.plans.findOne({
      where: { appId: dto.appId, slug: dto.slug },
    });
    if (collision) {
      throw new ConflictException({
        error: 'plan_slug_taken',
        message: `App already has a plan with slug "${dto.slug}"`,
      });
    }

    // For Lemon Squeezy plans, verify the variant exists, is subscription-priced,
    // and pull authoritative amount/currency/interval from LS (so operators can't
    // type a price that mismatches what LS will actually charge).
    // For Xendit, no provider lookup — Xendit has no plan resource; AcePay
    // owns the schedule and the operator-entered values are authoritative.
    let amount = dto.amount;
    let currency = dto.currency;
    let interval = dto.interval;
    let intervalCount = dto.intervalCount ?? 1;
    let providerPlanId = dto.providerPlanId;
    if (dto.provider === Provider.Lemonsqueezy) {
      const v = await this.lsAdapter.lookupVariant(dto.providerPlanId);
      if (!v.isSubscription) {
        throw new BadRequestException({
          error: 'variant_not_subscription',
          message: `Lemon Squeezy variant ${dto.providerPlanId} ("${v.name}") is not subscription-priced`,
        });
      }
      if (!v.interval) {
        throw new BadRequestException({
          error: 'variant_unsupported_interval',
          message: `Lemon Squeezy variant ${dto.providerPlanId} has an unsupported interval`,
        });
      }
      amount = v.price;
      currency = v.currency || dto.currency;
      interval = v.interval;
      intervalCount = v.intervalCount;
    } else if (dto.provider === Provider.Xendit) {
      // Synthesize a provider plan id if the operator didn't pass one — Xendit
      // doesn't have plan objects so the value is internal-only.
      if (!providerPlanId || providerPlanId.trim() === '') {
        providerPlanId = `xendit_acepay_${dto.slug}`;
      }
    }

    let plan = this.plans.create({
      appId: dto.appId,
      name: dto.name,
      slug: dto.slug,
      description: dto.description ?? null,
      region: dto.region,
      amount,
      currency: currency.toUpperCase(),
      interval,
      intervalCount,
      provider: dto.provider,
      providerPlanId,
      isActive: dto.isActive ?? true,
    });
    plan = await this.plans.save(plan);
    return plan;
  }

  async list(filters: ListPlansDto): Promise<Paged<Plan>> {
    const qb = this.plans.createQueryBuilder('plan').leftJoinAndSelect('plan.app', 'app');
    if (filters.appId)    qb.andWhere('plan.app_id = :appId', { appId: filters.appId });
    if (filters.provider) qb.andWhere('plan.provider = :provider', { provider: filters.provider });
    if (filters.interval) qb.andWhere('plan.interval = :interval', { interval: filters.interval });
    if (filters.isActive != null) qb.andWhere('plan.is_active = :isActive', { isActive: filters.isActive });
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    qb.orderBy('plan.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return toPaged(data, total, page, pageSize);
  }

  async findOne(id: string, appId?: string): Promise<Plan> {
    const where: { id: string; appId?: string } = { id };
    if (appId) where.appId = appId;
    const plan = await this.plans.findOne({ where, relations: { app: true } });
    if (!plan) {
      throw new NotFoundException({ error: 'plan_not_found', message: `Plan ${id} not found` });
    }
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto): Promise<Plan> {
    const plan = await this.findOne(id);
    const priceFieldsChanged =
      dto.amount != null ||
      dto.currency != null ||
      dto.interval != null ||
      dto.intervalCount != null;
    if (plan.provider === Provider.Lemonsqueezy && priceFieldsChanged) {
      throw new BadRequestException({
        error: 'price_fields_immutable_for_lemonsqueezy',
        message: 'Price, currency, and interval are controlled by the Lemon Squeezy variant. Edit the variant in LS and use Verify to sync.',
      });
    }
    if (dto.name != null)          plan.name = dto.name;
    if (dto.description !== undefined) plan.description = dto.description?.trim() ? dto.description.trim() : null;
    if (dto.region != null)        plan.region = dto.region;
    if (dto.amount != null)        plan.amount = dto.amount;
    if (dto.currency != null)      plan.currency = dto.currency.toUpperCase();
    if (dto.interval != null)      plan.interval = dto.interval;
    if (dto.intervalCount != null) plan.intervalCount = dto.intervalCount;
    if (dto.isActive != null)      plan.isActive = dto.isActive;
    return this.plans.save(plan);
  }

  async deactivate(id: string): Promise<Plan> {
    const plan = await this.findOne(id);
    plan.isActive = false;
    return this.plans.save(plan);
  }

  /** Re-fetch the provider variant and update amount/currency/interval/intervalCount
   *  on the AcePay plan to match. Used by the "Verify" action in the admin UI. */
  async syncFromProvider(id: string): Promise<{ plan: Plan; variant: Awaited<ReturnType<LemonsqueezyAdapter['lookupVariant']>> }> {
    const plan = await this.findOne(id);
    if (plan.provider !== Provider.Lemonsqueezy) {
      throw new BadRequestException({
        error: 'sync_not_supported',
        message: `Sync is only supported for Lemon Squeezy plans (this plan uses ${plan.provider})`,
      });
    }
    const v = await this.lsAdapter.lookupVariant(plan.providerPlanId);
    if (!v.isSubscription) {
      throw new BadRequestException({
        error: 'variant_not_subscription',
        message: `Lemon Squeezy variant ${plan.providerPlanId} ("${v.name}") is no longer subscription-priced`,
      });
    }
    if (!v.interval) {
      throw new BadRequestException({
        error: 'variant_unsupported_interval',
        message: `Lemon Squeezy variant ${plan.providerPlanId} has an unsupported interval`,
      });
    }
    plan.amount = v.price;
    if (v.currency) plan.currency = v.currency.toUpperCase();
    plan.interval = v.interval;
    plan.intervalCount = v.intervalCount;
    const saved = await this.plans.save(plan);
    return { plan: saved, variant: v };
  }

  /** Returns the plan IF it belongs to the calling app and is active; throws otherwise. */
  async findActiveForApp(id: string, appId: string): Promise<Plan> {
    const plan = await this.findOne(id, appId);
    if (!plan.isActive) {
      throw new BadRequestException({
        error: 'plan_inactive',
        message: `Plan ${id} is inactive — re-activate or use another plan`,
      });
    }
    return plan;
  }
}
