import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1747000000000 implements MigrationInterface {
  name = 'Initial1747000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── enums ────────────────────────────────────────────────────────────────
    await q.query(`CREATE TYPE "provider_enum" AS ENUM ('stripe','paymongo')`);
    await q.query(`CREATE TYPE "source_enum" AS ENUM ('web','mobile')`);
    await q.query(`CREATE TYPE "tx_type_enum" AS ENUM ('payment','refund','subscription_payment')`);
    await q.query(`CREATE TYPE "tx_status_enum" AS ENUM ('pending','succeeded','failed','refunded')`);
    await q.query(`CREATE TYPE "sub_status_enum" AS ENUM ('active','past_due','canceled','paused','expired')`);
    await q.query(`CREATE TYPE "plan_interval_enum" AS ENUM ('weekly','monthly','yearly')`);
    await q.query(`CREATE TYPE "wh_delivery_enum" AS ENUM ('pending','delivered','failed','exhausted')`);
    await q.query(`CREATE TYPE "log_actor_enum" AS ENUM ('system','provider','app','admin')`);
    await q.query(`CREATE TYPE "log_action_enum" AS ENUM (
      'payment.created','payment.provider_sent','payment.checkout_opened',
      'payment.succeeded','payment.failed','payment.refund_requested','payment.refunded',
      'payment.webhook_received','payment.app_notified','payment.app_notify_failed','payment.app_notify_retry',
      'subscription.created','subscription.activated','subscription.payment_succeeded',
      'subscription.payment_failed','subscription.past_due','subscription.canceled',
      'subscription.paused','subscription.resumed','subscription.expired','subscription.renewed'
    )`);

    // ── apps ─────────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "apps" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" varchar(120) NOT NULL,
        "slug" varchar(80) NOT NULL UNIQUE,
        "api_key_prefix" varchar(32) NOT NULL,
        "api_key_hash" varchar(64) NOT NULL UNIQUE,
        "webhook_url" varchar(500),
        "webhook_secret_enc" text,
        "required_metadata" text[] NOT NULL DEFAULT '{}',
        "optional_metadata" text[] NOT NULL DEFAULT '{}',
        "rate_limit" int NOT NULL DEFAULT 100,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "idx_apps_api_key_prefix" ON "apps" ("api_key_prefix")`);

    // ── customers ────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "customers" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
        "external_id" varchar(200) NOT NULL,
        "email" varchar(320) NOT NULL,
        "name" varchar(200),
        "stripe_customer_id" varchar(80),
        "paymongo_customer_id" varchar(80),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_customers_app_email" UNIQUE ("app_id","email"),
        CONSTRAINT "uq_customers_app_external" UNIQUE ("app_id","external_id")
      )`);
    await q.query(`CREATE INDEX "idx_customers_app" ON "customers" ("app_id")`);

    // ── plans ────────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "plans" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
        "name" varchar(200) NOT NULL,
        "slug" varchar(200) NOT NULL,
        "amount" int NOT NULL,
        "currency" varchar(8) NOT NULL,
        "interval" plan_interval_enum NOT NULL,
        "interval_count" int NOT NULL DEFAULT 1,
        "provider" provider_enum NOT NULL,
        "provider_plan_id" varchar(200) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_plans_app_slug" UNIQUE ("app_id","slug")
      )`);
    await q.query(`CREATE INDEX "idx_plans_app" ON "plans" ("app_id")`);

    // ── subscriptions ────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "subscriptions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
        "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
        "plan_id" uuid NOT NULL REFERENCES "plans"("id") ON DELETE RESTRICT,
        "provider" provider_enum NOT NULL,
        "provider_subscription_id" varchar(200) NOT NULL UNIQUE,
        "status" sub_status_enum NOT NULL DEFAULT 'active',
        "current_period_start" timestamptz,
        "current_period_end" timestamptz,
        "cancel_at" timestamptz,
        "canceled_at" timestamptz,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "idx_sub_app" ON "subscriptions" ("app_id")`);
    await q.query(`CREATE INDEX "idx_sub_customer" ON "subscriptions" ("customer_id")`);
    await q.query(`CREATE INDEX "idx_sub_status" ON "subscriptions" ("status")`);

    // ── transactions ─────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "transactions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
        "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
        "subscription_id" uuid REFERENCES "subscriptions"("id") ON DELETE SET NULL,
        "provider" provider_enum NOT NULL,
        "provider_tx_id" varchar(200),
        "type" tx_type_enum NOT NULL,
        "status" tx_status_enum NOT NULL DEFAULT 'pending',
        "amount" int NOT NULL,
        "currency" varchar(8) NOT NULL,
        "description" varchar(500),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "idempotency_key" varchar(200),
        "source" source_enum,
        "redirect_success" varchar(500),
        "redirect_failed" varchar(500),
        "checkout_url" varchar(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "provider_created_at" timestamptz,
        "provider_completed_at" timestamptz,
        "webhook_received_at" timestamptz,
        "app_notified_at" timestamptz,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_tx_app_idem" UNIQUE ("app_id","idempotency_key")
      )`);
    await q.query(`CREATE INDEX "idx_tx_app" ON "transactions" ("app_id")`);
    await q.query(`CREATE INDEX "idx_tx_customer" ON "transactions" ("customer_id")`);
    await q.query(`CREATE INDEX "idx_tx_sub" ON "transactions" ("subscription_id")`);
    await q.query(`CREATE INDEX "idx_tx_status" ON "transactions" ("status")`);
    await q.query(`CREATE INDEX "idx_tx_provider_tx" ON "transactions" ("provider_tx_id")`);

    // ── transaction_logs ─────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "transaction_logs" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "transaction_id" uuid NOT NULL REFERENCES "transactions"("id") ON DELETE CASCADE,
        "app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
        "action" log_action_enum NOT NULL,
        "status_from" varchar(32),
        "status_to" varchar(32),
        "actor" log_actor_enum NOT NULL DEFAULT 'system',
        "provider_event_id" varchar(200),
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "ip_address" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "idx_log_tx" ON "transaction_logs" ("transaction_id")`);
    await q.query(`CREATE INDEX "idx_log_app" ON "transaction_logs" ("app_id")`);
    await q.query(`CREATE INDEX "idx_log_action" ON "transaction_logs" ("action")`);
    await q.query(`CREATE INDEX "idx_log_tx_created" ON "transaction_logs" ("transaction_id","created_at")`);

    // ── webhook_events ───────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "webhook_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
        "transaction_id" uuid REFERENCES "transactions"("id") ON DELETE SET NULL,
        "provider" provider_enum NOT NULL,
        "event_type" varchar(120) NOT NULL,
        "provider_event_id" varchar(200) NOT NULL,
        "provider_payload" jsonb NOT NULL,
        "normalized_payload" jsonb,
        "delivery_status" wh_delivery_enum NOT NULL DEFAULT 'pending',
        "attempts" int NOT NULL DEFAULT 0,
        "max_attempts" int NOT NULL DEFAULT 5,
        "next_retry_at" timestamptz,
        "first_attempt_at" timestamptz,
        "delivered_at" timestamptz,
        "last_attempt_at" timestamptz,
        "last_response_status" int,
        "last_response_body" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_webhook_provider_event" UNIQUE ("provider","provider_event_id")
      )`);
    await q.query(`CREATE INDEX "idx_wh_app" ON "webhook_events" ("app_id")`);
    await q.query(`CREATE INDEX "idx_wh_tx" ON "webhook_events" ("transaction_id")`);
    await q.query(`CREATE INDEX "idx_wh_event_type" ON "webhook_events" ("event_type")`);
    await q.query(`CREATE INDEX "idx_wh_delivery" ON "webhook_events" ("delivery_status")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "webhook_events"`);
    await q.query(`DROP TABLE IF EXISTS "transaction_logs"`);
    await q.query(`DROP TABLE IF EXISTS "transactions"`);
    await q.query(`DROP TABLE IF EXISTS "subscriptions"`);
    await q.query(`DROP TABLE IF EXISTS "plans"`);
    await q.query(`DROP TABLE IF EXISTS "customers"`);
    await q.query(`DROP TABLE IF EXISTS "apps"`);
    for (const t of [
      'log_action_enum', 'log_actor_enum', 'wh_delivery_enum', 'plan_interval_enum',
      'sub_status_enum', 'tx_status_enum', 'tx_type_enum', 'source_enum', 'provider_enum',
    ]) {
      await q.query(`DROP TYPE IF EXISTS "${t}"`);
    }
  }
}
