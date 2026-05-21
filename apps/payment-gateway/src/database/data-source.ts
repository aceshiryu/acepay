import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import * as Entities from './entities';

// Always load .env from the payment-gateway project root, regardless of CWD.
// (Repo-level scripts like `npm run db:migrate` run from the workspace root.)
loadEnv({ path: resolve(__dirname, '../../.env') });

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER     ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME     ?? 'acepay',
  entities: Object.values(Entities),
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  migrationsTableName: 'acepay_migrations',
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

export default new DataSource(dataSourceOptions);
