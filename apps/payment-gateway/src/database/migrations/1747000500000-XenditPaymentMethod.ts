import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slice 4b — add Xendit PaymentMethod tracking to Customer.
 * Xendit recurring works by saving a PaymentMethod (reusability=MULTIPLE_USE)
 * during a "Link" flow and charging it on each cycle. We track the PM id and
 * its activation status so the subscription billing job knows whether the
 * customer has authorized auto-debit.
 */
export class XenditPaymentMethod1747000500000 implements MigrationInterface {
  name = 'XenditPaymentMethod1747000500000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE "xendit_pm_status_enum" AS ENUM ('pending','active','expired','failed')`);
    await q.query(`
      ALTER TABLE "customers"
      ADD COLUMN "xendit_payment_method_id" varchar(80),
      ADD COLUMN "xendit_payment_method_status" xendit_pm_status_enum
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "customers" DROP COLUMN "xendit_payment_method_status"`);
    await q.query(`ALTER TABLE "customers" DROP COLUMN "xendit_payment_method_id"`);
    await q.query(`DROP TYPE "xendit_pm_status_enum"`);
  }
}
