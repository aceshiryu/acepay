import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slice 4b follow-up — add 'canceled' to TransactionStatus.
 * When a billing cycle fires for a subscription that was canceled mid-period,
 * the worker records a Transaction with status='canceled' instead of charging.
 * This gives apps a clear audit row for "the next charge that didn't happen
 * because the customer cancelled".
 */
export class TransactionCanceledStatus1747000600000 implements MigrationInterface {
  name = 'TransactionCanceledStatus1747000600000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TYPE "tx_status_enum" ADD VALUE IF NOT EXISTS 'canceled'`);
  }

  public async down(_q: QueryRunner): Promise<void> {
    // Postgres does not support removing enum values without recreating the
    // type. Leaving the value in place is safe — nothing references it once
    // the code is reverted.
  }
}
