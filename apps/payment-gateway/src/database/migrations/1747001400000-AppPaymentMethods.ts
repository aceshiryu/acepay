import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which payment methods an app's checkouts offer (Xendit codes). NULL keeps
 * today's behaviour: every method the Xendit account has switched on.
 * Per app because Xendit's dashboard setting does not reach sub-accounts.
 */
export class AppPaymentMethods1747001400000 implements MigrationInterface {
  name = 'AppPaymentMethods1747001400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "apps" ADD "payment_methods" text[] NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "apps" DROP COLUMN "payment_methods"`);
  }
}
