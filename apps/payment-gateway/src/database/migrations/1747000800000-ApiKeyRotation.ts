import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * B4 — API-key expiry + rotation grace.
 *
 * Adds an optional expiry to the current key and a full "previous key" slot
 * (prefix + hash + expiry) so an operator can rotate a key without instantly
 * breaking a running app: the old key keeps working until its grace expiry.
 * All columns are nullable — existing apps keep non-expiring keys unchanged.
 */
export class ApiKeyRotation1747000800000 implements MigrationInterface {
  name = 'ApiKeyRotation1747000800000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "apps" ADD COLUMN "api_key_expires_at" timestamptz NULL`);
    await q.query(`ALTER TABLE "apps" ADD COLUMN "api_key_previous_prefix" varchar(32) NULL`);
    await q.query(`ALTER TABLE "apps" ADD COLUMN "api_key_previous_hash" varchar(64) NULL`);
    await q.query(`ALTER TABLE "apps" ADD COLUMN "api_key_previous_expires_at" timestamptz NULL`);
    await q.query(`CREATE INDEX "idx_apps_api_key_previous_prefix" ON "apps" ("api_key_previous_prefix")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "idx_apps_api_key_previous_prefix"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "api_key_previous_expires_at"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "api_key_previous_hash"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "api_key_previous_prefix"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "api_key_expires_at"`);
  }
}
