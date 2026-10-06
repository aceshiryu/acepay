import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How a payment was paid (Xendit's channel: QRPH, GCASH, CREDIT_CARD, …),
 * recorded when it succeeds. Apps need it: Xendit cannot refund QR Ph or
 * over-the-counter payments online, so those are refunded by hand.
 */
export class TransactionPaymentChannel1747001500000 implements MigrationInterface {
  name = 'TransactionPaymentChannel1747001500000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "transactions" ADD "payment_channel" varchar(40) NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "transactions" DROP COLUMN "payment_channel"`);
  }
}
