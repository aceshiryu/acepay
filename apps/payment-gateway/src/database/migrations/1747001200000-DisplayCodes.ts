import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Human-readable display codes ("TXN-000123") for every record the admin shows,
 * so the UI never has to print a UUID. Per table:
 *   1. a sequence `<table>_code_seq`
 *   2. a `code` column, backfilled in created_at order (oldest = 000001)
 *   3. the sequence advanced past the backfill, then used as the column default
 *   4. NOT NULL + unique
 * SQL is inlined (not imported from common/display-code.ts) so this migration
 * stays frozen even if the prefixes change later.
 */
const TABLES: [table: string, prefix: string][] = [
  ['apps', 'APP'],
  ['plans', 'PLN'],
  ['customers', 'CUS'],
  ['subscriptions', 'SUB'],
  ['transactions', 'TXN'],
  ['webhook_events', 'EVT'],
  ['merchants', 'MER'],
  ['payout_runs', 'RUN'],
  ['payouts', 'PO'],
];
const WIDTH = 6;

export class DisplayCodes1747001200000 implements MigrationInterface {
  name = 'DisplayCodes1747001200000';

  public async up(q: QueryRunner): Promise<void> {
    for (const [table, prefix] of TABLES) {
      const seq = `${table}_code_seq`;
      await q.query(`CREATE SEQUENCE "${seq}"`);
      await q.query(`ALTER TABLE "${table}" ADD COLUMN "code" varchar(20) NULL`);
      await q.query(`
        UPDATE "${table}" t
           SET "code" = '${prefix}-' || lpad(s.n::text, ${WIDTH}, '0')
          FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "${table}") s
         WHERE s."id" = t."id"`);
      // is_called=false on an empty table so the first insert gets 1.
      await q.query(`
        SELECT setval('${seq}', GREATEST(c.n, 1), c.n > 0)
          FROM (SELECT count(*)::bigint AS n FROM "${table}") c`);
      await q.query(`ALTER TABLE "${table}" ALTER COLUMN "code" SET DEFAULT '${prefix}-' || lpad(nextval('${seq}')::text, ${WIDTH}, '0')`);
      await q.query(`ALTER TABLE "${table}" ALTER COLUMN "code" SET NOT NULL`);
      await q.query(`ALTER TABLE "${table}" ADD CONSTRAINT "uq_${table}_code" UNIQUE ("code")`);
      await q.query(`ALTER SEQUENCE "${seq}" OWNED BY "${table}"."code"`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [table] of [...TABLES].reverse()) {
      // Dropping the column drops the OWNED BY sequence with it.
      await q.query(`ALTER TABLE "${table}" DROP COLUMN "code"`);
    }
  }
}
