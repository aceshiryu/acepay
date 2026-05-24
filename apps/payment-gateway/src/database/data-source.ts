// Load the gateway's .env explicitly. We can't use `import 'dotenv/config'`
// here because that resolves .env relative to process.cwd() — which is the
// repo root when running `npm run db:migrate`, where no .env exists.
// Pinning to __dirname makes this work regardless of cwd.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
loadEnv({ path: resolve(__dirname, '../../.env') });

import { DataSource, DataSourceOptions } from 'typeorm';
import * as Entities from './entities';

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
