import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Operator-wide settings. Seeds `marketplace_defaults` — the marketplace
 * settings every newly registered app starts with (copied onto the app at
 * creation, so editing the defaults never changes existing apps). Seeded
 * "off" with no fee: the operator picks the default fee in the admin.
 */
export class PlatformSettings1747001100000 implements MigrationInterface {
  name = 'PlatformSettings1747001100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "platform_settings" (
        "key" varchar(64) PRIMARY KEY,
        "value" jsonb NOT NULL,
        "updated_by" varchar(320) NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `INSERT INTO "platform_settings" ("key", "value") VALUES ('marketplace_defaults', $1::jsonb)`,
      [JSON.stringify({ enabled: false, feePercent: null, feeMinPercent: null, feeMaxPercent: null, minPayout: 50000 })],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "platform_settings"`);
  }
}
