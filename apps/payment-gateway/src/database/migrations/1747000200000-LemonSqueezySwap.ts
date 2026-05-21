import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Swap Stripe out for Lemon Squeezy as the international provider.
 *  - Replace 'stripe' with 'lemonsqueezy' in the provider enum (and remap
 *    any existing rows so there's no orphan data).
 *  - Rename customers.stripe_customer_id → customers.lemonsqueezy_customer_id.
 */
export class LemonSqueezySwap1747000200000 implements MigrationInterface {
  name = 'LemonSqueezySwap1747000200000';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Rename the customers column.
    await q.query(`ALTER TABLE "customers" RENAME COLUMN "stripe_customer_id" TO "lemonsqueezy_customer_id"`);

    // 2. Recreate the provider enum with the new value set. Postgres can't
    //    drop a value from an enum, so we build a new type, migrate columns
    //    onto it (mapping 'stripe' → 'lemonsqueezy'), then swap names.
    await q.query(`CREATE TYPE "provider_enum_new" AS ENUM ('lemonsqueezy','paymongo')`);

    const tables: { table: string; column: string }[] = [
      { table: 'plans',          column: 'provider' },
      { table: 'subscriptions',  column: 'provider' },
      { table: 'transactions',   column: 'provider' },
      { table: 'webhook_events', column: 'provider' },
    ];
    for (const { table, column } of tables) {
      await q.query(`
        ALTER TABLE "${table}"
        ALTER COLUMN "${column}" TYPE "provider_enum_new"
        USING (
          CASE "${column}"::text
            WHEN 'stripe' THEN 'lemonsqueezy'::"provider_enum_new"
            ELSE "${column}"::text::"provider_enum_new"
          END
        )
      `);
    }

    await q.query(`DROP TYPE "provider_enum"`);
    await q.query(`ALTER TYPE "provider_enum_new" RENAME TO "provider_enum"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Rebuild the old enum, map 'lemonsqueezy' back to 'stripe' for symmetry.
    await q.query(`CREATE TYPE "provider_enum_old" AS ENUM ('stripe','paymongo')`);
    const tables: { table: string; column: string }[] = [
      { table: 'plans',          column: 'provider' },
      { table: 'subscriptions',  column: 'provider' },
      { table: 'transactions',   column: 'provider' },
      { table: 'webhook_events', column: 'provider' },
    ];
    for (const { table, column } of tables) {
      await q.query(`
        ALTER TABLE "${table}"
        ALTER COLUMN "${column}" TYPE "provider_enum_old"
        USING (
          CASE "${column}"::text
            WHEN 'lemonsqueezy' THEN 'stripe'::"provider_enum_old"
            ELSE "${column}"::text::"provider_enum_old"
          END
        )
      `);
    }
    await q.query(`DROP TYPE "provider_enum"`);
    await q.query(`ALTER TYPE "provider_enum_old" RENAME TO "provider_enum"`);

    await q.query(`ALTER TABLE "customers" RENAME COLUMN "lemonsqueezy_customer_id" TO "stripe_customer_id"`);
  }
}
