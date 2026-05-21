import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slice 3.5 — app-level billing mode + plan/customer/transaction country.
 *  - apps.billing_mode: 'subscription' | 'one_time' (default 'one_time' for existing apps)
 *  - plans.description, plans.country
 *  - customers.country
 *  - transactions.country (for one-time payment auto-routing)
 */
export class AppBillingMode1747000300000 implements MigrationInterface {
  name = 'AppBillingMode1747000300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE "billing_mode_enum" AS ENUM ('subscription','one_time')`);
    await q.query(`
      ALTER TABLE "apps"
      ADD COLUMN "billing_mode" billing_mode_enum NOT NULL DEFAULT 'one_time'
    `);

    await q.query(`ALTER TABLE "plans" ADD COLUMN "description" varchar(500)`);
    await q.query(`ALTER TABLE "plans" ADD COLUMN "country" varchar(2)`);

    await q.query(`ALTER TABLE "customers" ADD COLUMN "country" varchar(2)`);
    await q.query(`ALTER TABLE "transactions" ADD COLUMN "country" varchar(2)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "transactions" DROP COLUMN "country"`);
    await q.query(`ALTER TABLE "customers" DROP COLUMN "country"`);
    await q.query(`ALTER TABLE "plans" DROP COLUMN "country"`);
    await q.query(`ALTER TABLE "plans" DROP COLUMN "description"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "billing_mode"`);
    await q.query(`DROP TYPE "billing_mode_enum"`);
  }
}
