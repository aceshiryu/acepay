import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, MoreThanOrEqual, Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import { WebhookDeliveryStatus } from '../../common/enums';
import { WebhookDeliveryQueueService } from '../../common/queue/webhook-delivery-queue.service';
import { WebhookEvent } from '../../database/entities';
import { ListWebhookEventsDto, WebhookStatsDto } from './dto/list-webhook-events.dto';

@Injectable()
export class WebhookEventsAdminService {
  constructor(
    @InjectRepository(WebhookEvent) private readonly events: Repository<WebhookEvent>,
    private readonly deliveryQueue: WebhookDeliveryQueueService,
  ) {}

  async list(filters: ListWebhookEventsDto): Promise<Paged<WebhookEvent>> {
    const qb = this.buildQuery(filters);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    qb.orderBy('evt.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return toPaged(data, total, page, pageSize);
  }

  async findOne(id: string): Promise<WebhookEvent> {
    const evt = await this.events.findOne({
      where: { id }, relations: { app: true, transaction: true },
    });
    if (!evt) {
      throw new NotFoundException({
        error: 'webhook_event_not_found', message: `Webhook event ${id} not found`,
      });
    }
    return evt;
  }

  async stats(opts: WebhookStatsDto) {
    const windowHours = opts.windowHours ?? 24;
    const since = new Date(Date.now() - windowHours * 3_600_000);

    const [
      deliveredInWindow,
      pending,
      failed,
      exhausted,
      avgRow,
    ] = await Promise.all([
      this.events.count({
        where: {
          deliveryStatus: WebhookDeliveryStatus.Delivered,
          deliveredAt: MoreThanOrEqual(since),
        },
      }),
      this.events.count({ where: { deliveryStatus: WebhookDeliveryStatus.Pending } }),
      this.events.count({ where: { deliveryStatus: WebhookDeliveryStatus.Failed } }),
      this.events.count({ where: { deliveryStatus: WebhookDeliveryStatus.Exhausted } }),
      this.events.createQueryBuilder('evt')
        .select(`AVG(EXTRACT(EPOCH FROM (evt.delivered_at - evt.created_at)) * 1000)`, 'avgMs')
        .where('evt.delivery_status = :st', { st: WebhookDeliveryStatus.Delivered })
        .andWhere('evt.delivered_at IS NOT NULL')
        .andWhere('evt.delivered_at >= :since', { since })
        .getRawOne<{ avgMs: string | null }>(),
    ]);

    return {
      windowHours,
      deliveredInWindow,
      pending,
      failed,
      exhausted,
      avgDeliveryMs: avgRow?.avgMs ? Math.round(Number(avgRow.avgMs)) : null,
    };
  }

  /** Reset the event to pending and re-enqueue for the worker to retry. */
  async retry(id: string): Promise<WebhookEvent> {
    const evt = await this.findOne(id);
    if (evt.deliveryStatus === WebhookDeliveryStatus.Delivered) {
      throw new BadRequestException({
        error: 'already_delivered', message: 'Cannot retry a delivered event',
      });
    }
    evt.deliveryStatus = WebhookDeliveryStatus.Pending;
    evt.nextRetryAt = new Date();
    const saved = await this.events.save(evt);
    // Replace any existing queue job: without this the add is a no-op and the
    // event sits in `pending` with nothing delivering it.
    await this.deliveryQueue.enqueue(
      { webhookEventId: saved.id, transactionId: saved.transactionId ?? null },
      { replaceExisting: true },
    );
    return saved;
  }

  private buildQuery(filters: ListWebhookEventsDto) {
    const qb = this.events.createQueryBuilder('evt')
      .leftJoinAndSelect('evt.app', 'app')
      .leftJoinAndSelect('evt.transaction', 'tx');
    if (filters.appId)         qb.andWhere('evt.app_id = :appId', { appId: filters.appId });
    if (filters.provider)      qb.andWhere('evt.provider = :provider', { provider: filters.provider });
    if (filters.deliveryStatus)qb.andWhere('evt.delivery_status = :st', { st: filters.deliveryStatus });
    if (filters.from)          qb.andWhere('evt.created_at >= :from', { from: filters.from });
    if (filters.to)            qb.andWhere('evt.created_at <= :to', { to: filters.to });
    if (filters.search) {
      const q = `%${filters.search.toLowerCase()}%`;
      qb.andWhere(new Brackets((b) => {
        b.where('LOWER(evt.event_type) LIKE :q', { q })
          .orWhere('LOWER(evt.id::text) LIKE :q', { q })
          .orWhere('LOWER(evt.transaction_id::text) LIKE :q', { q })
          .orWhere('LOWER(evt.provider_event_id) LIKE :q', { q });
      }));
    }
    return qb;
  }
}
