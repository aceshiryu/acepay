import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Archived apps: "Delete app" in the admin used to only deactivate, so the
 * app stayed in every list. `archived_at` set = archived — hidden from the
 * sidebar, Apps page and every app filter, API key rejected (is_active is
 * forced false), history kept, restorable. Permanent delete removes the row
 * and is only allowed for an archived app.
 */
export class AppArchive1747001700000 implements MigrationInterface {
  name = 'AppArchive1747001700000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "apps" ADD "archived_at" timestamptz NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "apps" DROP COLUMN "archived_at"`);
  }
}
