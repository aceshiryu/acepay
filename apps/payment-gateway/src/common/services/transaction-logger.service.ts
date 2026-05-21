import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LogAction, LogActor } from '../enums';
import { Transaction, TransactionLog } from '../../database/entities';

export interface LogEntryInput {
  transaction: Transaction;
  action: LogAction;
  actor?: LogActor;
  statusFrom?: string | null;
  statusTo?: string | null;
  providerEventId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

@Injectable()
export class TransactionLoggerService {
  constructor(
    @InjectRepository(TransactionLog) private readonly logs: Repository<TransactionLog>,
  ) {}

  async log(input: LogEntryInput): Promise<TransactionLog> {
    const row = this.logs.create({
      transactionId: input.transaction.id,
      appId: input.transaction.appId,
      action: input.action,
      actor: input.actor ?? LogActor.System,
      statusFrom: input.statusFrom ?? null,
      statusTo: input.statusTo ?? null,
      providerEventId: input.providerEventId ?? null,
      details: input.details ?? {},
      ipAddress: input.ipAddress ?? null,
    });
    return this.logs.save(row);
  }
}
