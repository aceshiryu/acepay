import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slice 6 — marketplace payments + manual payout runs (Xendit xenPlatform).
 *
 *  apps                 + marketplace_enabled / _fee_percent / _min_payout (per app, no global fee)
 *  merchants            who an app collects for (e.g. BooklyPH coaches), one Owned sub-account each
 *  xendit_split_rules   cache: one Xendit split rule per fee rate
 *  transactions         + merchant split columns
 *  payout_runs          one operator click: preview → confirm → send
 *  payouts              one transfer from a merchant sub-account to their GCash / bank
 */
export class Marketplace1747000900000 implements MigrationInterface {
  name = 'Marketplace1747000900000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "apps" ADD COLUMN "marketplace_enabled" boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE "apps" ADD COLUMN "marketplace_fee_percent" numeric(5,2) NULL`);
    await q.query(`ALTER TABLE "apps" ADD COLUMN "marketplace_min_payout" int NOT NULL DEFAULT 50000`);

    await q.query(`CREATE TYPE "merchants_status_enum" AS ENUM ('pending', 'active', 'paused', 'suspended')`);
    await q.query(`
      CREATE TABLE "merchants" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
        "external_ref" varchar(200) NOT NULL,
        "name" varchar(200) NOT NULL,
        "email" varchar(320) NOT NULL,
        "status" "merchants_status_enum" NOT NULL DEFAULT 'pending',
        "xendit_account_id" varchar(64) NULL,
        "xendit_account_status" varchar(32) NULL,
        "fee_override_percent" numeric(5,2) NULL,
        "fee_override_ends_at" timestamptz NULL,
        "payout_channel_code" varchar(64) NULL,
        "payout_account_number" varchar(100) NULL,
        "payout_account_holder_name" varchar(200) NULL,
        "payout_destination_hash" varchar(64) NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_merchants_app_external_ref" UNIQUE ("app_id", "external_ref")
      )`);
    await q.query(`CREATE INDEX "idx_merchants_app_id" ON "merchants" ("app_id")`);
    await q.query(`CREATE INDEX "idx_merchants_status" ON "merchants" ("status")`);
    await q.query(`CREATE INDEX "idx_merchants_destination_hash" ON "merchants" ("payout_destination_hash")`);
    await q.query(`CREATE UNIQUE INDEX "uq_merchants_xendit_account_id" ON "merchants" ("xendit_account_id") WHERE "xendit_account_id" IS NOT NULL`);

    await q.query(`
      CREATE TABLE "xendit_split_rules" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "percent" numeric(5,2) NOT NULL,
        "currency" varchar(8) NOT NULL,
        "destination_account_id" varchar(64) NOT NULL,
        "xendit_split_rule_id" varchar(100) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_xendit_split_rules_rate" UNIQUE ("percent", "currency", "destination_account_id")
      )`);

    await q.query(`ALTER TABLE "transactions" ADD COLUMN "merchant_id" uuid NULL REFERENCES "merchants"("id") ON DELETE SET NULL`);
    await q.query(`ALTER TABLE "transactions" ADD COLUMN "provider_account_id" varchar(64) NULL`);
    await q.query(`ALTER TABLE "transactions" ADD COLUMN "platform_fee_percent" numeric(5,2) NULL`);
    await q.query(`ALTER TABLE "transactions" ADD COLUMN "platform_fee_amount" int NULL`);
    await q.query(`ALTER TABLE "transactions" ADD COLUMN "merchant_amount" int NULL`);
    await q.query(`ALTER TABLE "transactions" ADD COLUMN "split_rule_id" varchar(100) NULL`);
    await q.query(`ALTER TABLE "transactions" ADD COLUMN "split_status" varchar(16) NULL`);
    await q.query(`CREATE INDEX "idx_transactions_merchant_id" ON "transactions" ("merchant_id")`);

    await q.query(`CREATE TYPE "payout_runs_status_enum" AS ENUM ('building', 'build_failed', 'draft', 'queued', 'processing', 'completed', 'completed_with_failures', 'discarded')`);
    await q.query(`
      CREATE TABLE "payout_runs" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "app_id" uuid NULL REFERENCES "apps"("id") ON DELETE SET NULL,
        "status" "payout_runs_status_enum" NOT NULL DEFAULT 'building',
        "currency" varchar(8) NOT NULL DEFAULT 'PHP',
        "total_amount" int NOT NULL DEFAULT 0,
        "payout_count" int NOT NULL DEFAULT 0,
        "excluded" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "error_message" varchar(500) NULL,
        "created_by" varchar(320) NULL,
        "built_at" timestamptz NULL,
        "confirmed_by" varchar(320) NULL,
        "confirmed_at" timestamptz NULL,
        "completed_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "idx_payout_runs_app_id" ON "payout_runs" ("app_id")`);
    await q.query(`CREATE INDEX "idx_payout_runs_status" ON "payout_runs" ("status")`);

    await q.query(`CREATE TYPE "payouts_status_enum" AS ENUM ('draft', 'queued', 'pending', 'succeeded', 'failed', 'canceled', 'reversed', 'skipped')`);
    await q.query(`
      CREATE TABLE "payouts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "run_id" uuid NULL REFERENCES "payout_runs"("id") ON DELETE SET NULL,
        "merchant_id" uuid NOT NULL REFERENCES "merchants"("id") ON DELETE RESTRICT,
        "app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
        "amount" int NOT NULL,
        "currency" varchar(8) NOT NULL,
        "balance_at_build" int NULL,
        "description" varchar(500) NULL,
        "status" "payouts_status_enum" NOT NULL DEFAULT 'draft',
        "channel_code" varchar(64) NULL,
        "account_number" varchar(100) NULL,
        "account_holder_name" varchar(200) NULL,
        "xendit_account_id" varchar(64) NULL,
        "xendit_payout_id" varchar(100) NULL,
        "provider_status" varchar(32) NULL,
        "failure_code" varchar(64) NULL,
        "failure_message" varchar(500) NULL,
        "retry_of" uuid NULL,
        "estimated_arrival_at" timestamptz NULL,
        "sent_at" timestamptz NULL,
        "completed_at" timestamptz NULL,
        "raw" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "idx_payouts_run_id" ON "payouts" ("run_id")`);
    await q.query(`CREATE INDEX "idx_payouts_merchant_id" ON "payouts" ("merchant_id")`);
    await q.query(`CREATE INDEX "idx_payouts_app_id" ON "payouts" ("app_id")`);
    await q.query(`CREATE INDEX "idx_payouts_status" ON "payouts" ("status")`);
    await q.query(`CREATE UNIQUE INDEX "uq_payouts_xendit_payout_id" ON "payouts" ("xendit_payout_id") WHERE "xendit_payout_id" IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "payouts"`);
    await q.query(`DROP TYPE "payouts_status_enum"`);
    await q.query(`DROP TABLE "payout_runs"`);
    await q.query(`DROP TYPE "payout_runs_status_enum"`);
    await q.query(`DROP INDEX "idx_transactions_merchant_id"`);
    for (const col of [
      'split_status', 'split_rule_id', 'merchant_amount', 'platform_fee_amount',
      'platform_fee_percent', 'provider_account_id', 'merchant_id',
    ]) {
      await q.query(`ALTER TABLE "transactions" DROP COLUMN "${col}"`);
    }
    await q.query(`DROP TABLE "xendit_split_rules"`);
    await q.query(`DROP TABLE "merchants"`);
    await q.query(`DROP TYPE "merchants_status_enum"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "marketplace_min_payout"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "marketplace_fee_percent"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "marketplace_enabled"`);
  }
}
