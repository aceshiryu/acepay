import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import * as Entities from './entities';

// Reads .env from process.cwd(). For db:migrate, run from apps/payment-gateway/
// so cwd contains the .env there. On App Engine, cwd=/workspace.
loadEnv();

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
