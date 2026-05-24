import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replace plans.country (ISO-2 code, nullable) with plans.region
 * (enum: 'local' | 'international', required). Backfill: PH → local,
 * everything else (including NULL "worldwide") → international.
 *
 * customers.country and transactions.country remain untouched — those
 * are real ISO codes, not provider-routing hints.
 */
export class PlanRegion1747000700000 implements MigrationInterface {
  name = 'PlanRegion1747000700000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE "plan_region_enum" AS ENUM ('local','international')`);
    await q.query(`
      ALTER TABLE "plans"
      ADD COLUMN "region" plan_region_enum NOT NULL DEFAULT 'international'
    `);
    await q.query(`
      UPDATE "plans"
      SET "region" = 'local'
      WHERE "country" = 'PH'
    `);
    await q.query(`ALTER TABLE "plans" DROP COLUMN "country"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "plans" ADD COLUMN "country" varchar(2)`);
    await q.query(`
      UPDATE "plans"
      SET "country" = 'PH'
      WHERE "region" = 'local'
    `);
    await q.query(`ALTER TABLE "plans" DROP COLUMN "region"`);
    await q.query(`DROP TYPE "plan_region_enum"`);
  }
}
