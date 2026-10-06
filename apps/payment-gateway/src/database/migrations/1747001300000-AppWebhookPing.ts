import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The last "Send test webhook" result per app: when, whether the app answered
 * 2xx, and in a few words what happened. Shown on the app's setup checklist.
 */
export class AppWebhookPing1747001300000 implements MigrationInterface {
  name = 'AppWebhookPing1747001300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "apps" ADD "last_ping_at" timestamptz NULL`);
    await q.query(`ALTER TABLE "apps" ADD "last_ping_ok" boolean NULL`);
    await q.query(`ALTER TABLE "apps" ADD "last_ping_detail" varchar(300) NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "apps" DROP COLUMN "last_ping_detail"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "last_ping_ok"`);
    await q.query(`ALTER TABLE "apps" DROP COLUMN "last_ping_at"`);
  }
}
