import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slice 7: PayMongo as a third provider, and provider credentials editable
 * from the admin Integrations page.
 *
 * `paymongo` was in provider_enum once before (Initial) and was mapped to
 * xendit by XenditSwap. It comes back as a NEW provider: rows XenditSwap
 * converted stay xendit. ADD VALUE can't be used inside the transaction that
 * adds it, which is fine — nothing below uses it.
 *
 * Down drops the credential tables but leaves the enum value (Postgres can't
 * remove one without recreating the type, and paymongo rows may exist).
 */
export class Paymongo1747001600000 implements MigrationInterface {
  name = 'Paymongo1747001600000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TYPE "provider_enum" ADD VALUE IF NOT EXISTS 'paymongo'`);
    await q.query(`
      CREATE TABLE "provider_credentials" (
        "key" varchar(64) PRIMARY KEY,
        "provider" varchar(32) NOT NULL,
        "value_enc" text NOT NULL,
        "updated_by" varchar(320),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE TABLE "provider_credential_changes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "key" varchar(64) NOT NULL,
        "provider" varchar(32) NOT NULL,
        "action" varchar(16) NOT NULL,
        "actor" varchar(320),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX "idx_provider_credential_changes_provider" ON "provider_credential_changes" ("provider", "created_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "provider_credential_changes"`);
    await q.query(`DROP TABLE "provider_credentials"`);
  }
}
