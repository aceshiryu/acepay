import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Paged, toPaged } from '../../common/dto/pagination.dto';
import { TransactionLog } from '../../database/entities';
import { ListActivityLogsDto } from './dto/list-activity-logs.dto';

@Injectable()
export class ActivityLogsAdminService {
  constructor(
    @InjectRepository(TransactionLog) private readonly logs: Repository<TransactionLog>,
  ) {}

  async list(filters: ListActivityLogsDto): Promise<Paged<TransactionLog>> {
    const qb = this.logs.createQueryBuilder('log')
      .leftJoinAndSelect('log.app', 'app')
      .leftJoinAndSelect('log.transaction', 'tx');

    if (filters.appId)         qb.andWhere('log.app_id = :appId', { appId: filters.appId });
    if (filters.transactionId) qb.andWhere('log.transaction_id = :txId', { txId: filters.transactionId });
    if (filters.actor)         qb.andWhere('log.actor = :actor', { actor: filters.actor });
    if (filters.actionPrefix)  qb.andWhere('log.action::text LIKE :pref', { pref: `${filters.actionPrefix}%` });
    if (filters.from)          qb.andWhere('log.created_at >= :from', { from: filters.from });
    if (filters.to)            qb.andWhere('log.created_at <= :to', { to: filters.to });
    if (filters.search) {
      const q = `%${filters.search.toLowerCase()}%`;
      qb.andWhere(new Brackets((b) => {
        b.where('LOWER(log.action::text) LIKE :q', { q })
          .orWhere('LOWER(log.provider_event_id) LIKE :q', { q })
          .orWhere('LOWER(log.transaction_id::text) LIKE :q', { q });
      }));
    }

    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    qb.orderBy('log.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return toPaged(data, total, page, pageSize);
  }
}
