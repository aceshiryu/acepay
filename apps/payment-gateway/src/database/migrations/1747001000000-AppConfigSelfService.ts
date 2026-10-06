import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Apps can change their own marketplace fee + minimum payout (PATCH /v1/app/config),
 * but only inside an operator-set fee range, and every change — app or admin — is
 * written to app_config_changes.
 */
export class AppConfigSelfService1747001000000 implements MigrationInterface {
  name = 'AppConfigSelfService1747001000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "apps" ADD COLUMN "marketplace_fee_min_percent" numeric(5,2) NULL`);
    await q.query(`ALTER TABLE "apps" ADD COLUMN "marketplace_fee_max_percent" numeric(5,2) NULL`);
    await q.query(`
      CREATE TABLE "app_config_changes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
        "actor" varchar(16) NOT NULL,
        "actor_ref" varchar(320) NULL,
        "field" varchar(64) NOT NULL,
        "old_value" jsonb NULL,
        "new_value" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "idx_app_config_changes_app_id" ON "app_config_changes" ("app_id")`);
    await q.query(`CREATE INDEX "idx_app_config_changes_created_at" ON "app_config_changes" ("created_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "app_config_changes"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "marketplace_fee_max_percent"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "marketplace_fee_min_percent"`);
  }
}
