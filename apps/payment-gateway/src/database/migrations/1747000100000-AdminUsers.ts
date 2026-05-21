import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminUsers1747000100000 implements MigrationInterface {
  name = 'AdminUsers1747000100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "admin_users" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "email" varchar(320) NOT NULL UNIQUE,
        "password_hash" text NOT NULL,
        "name" varchar(120),
        "is_active" boolean NOT NULL DEFAULT true,
        "last_login_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "admin_users"`);
  }
}
