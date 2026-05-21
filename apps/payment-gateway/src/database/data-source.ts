import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import * as Entities from './entities';

// Try every plausible .env location — dotenv silently skips missing files
// and a subsequent load won't overwrite already-set vars. Covers:
//   * ts-node from source (db:migrate): __dirname=src/database, .env at ../../.env
//   * webpack-built local dev: __dirname=dist, .env at ../.env (project root)
//   * App Engine (flat /workspace): __dirname=/workspace, .env at .env (same dir)
loadEnv({ path: resolve(__dirname, '../../.env') });
loadEnv({ path: resolve(__dirname, '../.env') });
loadEnv({ path: resolve(__dirname, '.env') });

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
