import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * POST /v1/subscriptions had no idempotency protection: an app retrying a
 * timed-out request got a second subscription and a second checkout URL.
 * Mirrors uq_tx_app_idem on transactions. A plain unique constraint is enough:
 * Postgres treats NULLs as distinct, so any number of rows may omit the key.
 */
export class SubscriptionIdempotency1747000900000 implements MigrationInterface {
  name = 'SubscriptionIdempotency1747000900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "idempotency_key" character varying(200)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_sub_app_idem" ON "subscriptions" ("app_id", "idempotency_key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_sub_app_idem"`);
    await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "idempotency_key"`);
  }
}
