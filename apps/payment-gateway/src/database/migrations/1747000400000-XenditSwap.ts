import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replace Paymongo with Xendit as the PH-local provider.
 *  - Provider enum: 'paymongo' → 'xendit' (with USING clause for any existing rows)
 *  - Rename customers.paymongo_customer_id → customers.xendit_customer_id
 *
 * Lemon Squeezy stays as the second supported provider (international + MoR for tax).
 */
export class XenditSwap1747000400000 implements MigrationInterface {
  name = 'XenditSwap1747000400000';

  public async up(q: QueryRunner): Promise<void> {
    // 1. Rename the customers column.
    await q.query(`ALTER TABLE "customers" RENAME COLUMN "paymongo_customer_id" TO "xendit_customer_id"`);

    // 2. Recreate the provider enum with 'xendit' in place of 'paymongo'.
    await q.query(`CREATE TYPE "provider_enum_new" AS ENUM ('lemonsqueezy','xendit')`);

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
            WHEN 'paymongo' THEN 'xendit'::"provider_enum_new"
            ELSE "${column}"::text::"provider_enum_new"
          END
        )
      `);
    }

    await q.query(`DROP TYPE "provider_enum"`);
    await q.query(`ALTER TYPE "provider_enum_new" RENAME TO "provider_enum"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Rebuild old enum, map 'xendit' back to 'paymongo' for symmetry.
    await q.query(`CREATE TYPE "provider_enum_old" AS ENUM ('lemonsqueezy','paymongo')`);
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
            WHEN 'xendit' THEN 'paymongo'::"provider_enum_old"
            ELSE "${column}"::text::"provider_enum_old"
          END
        )
      `);
    }
    await q.query(`DROP TYPE "provider_enum"`);
    await q.query(`ALTER TYPE "provider_enum_old" RENAME TO "provider_enum"`);

    await q.query(`ALTER TABLE "customers" RENAME COLUMN "xendit_customer_id" TO "paymongo_customer_id"`);
  }
}
